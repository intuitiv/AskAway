#!/usr/bin/env python3
"""AskAway approval wrapper for agy: same arguments as agy, removable by clearing askaway.workers.agyCommand.

Headless `agy --print` auto-denies every command under an org review policy. This runs the same task in agy's
interactive mode inside a PTY, answers each shell command prompt from an allow-list (ASKAWAY_AGY_ALLOW,
comma-separated command prefixes), answers each file prompt (any question line ending in "?") yes inside the working directory or an
--add-dir directory and no elsewhere, denies everything else, and prints stream-json events the AskAway runtime reads.
A run that passes --dangerously-skip-permissions (explicit packet opt-in) is not interactive: agy gets the original args.
"""
import fcntl, json, os, pty, re, select, shlex, signal, struct, subprocess, sys, termios, time

DEFAULT_ALLOW = "node,npm,npx,rtk,git status,git diff,git log,git show,ls,cat,head,tail,wc,grep,rg,pwd,echo,cd"
ALLOW = [p.strip() for p in os.environ.get("ASKAWAY_AGY_ALLOW", DEFAULT_ALLOW).split(",") if p.strip()]
AGY = os.environ.get("ASKAWAY_AGY_BIN", "agy")
IDLE_DONE_SECONDS = float(os.environ.get("ASKAWAY_AGY_IDLE_SECONDS", "20"))
HEARTBEAT_SECONDS = 20
ANSI = re.compile(r"\x1b\[[0-9;?<>=]*[A-Za-z~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|[\x08]")
# A "Requesting permission for:" block, a blank line, then any question line ending in "?" (wording varies by tool).
PROMPT = re.compile(r"Requesting permission for:[ \t]*\n(?P<cmd>(?:[ \t]*\S[^\n]*\n)+)[ \t]*\n[ \t]*(?P<ask>\S[^\n]*\?)[ \t]*\n")
RAN = re.compile(r"● (?P<verb>[A-Z][a-z]+) \((?P<what>[^\n]*?)\)(?: \(ctrl\+o)")
RESUME = re.compile(r"agy --conversation=([0-9a-f-]{36})")
DOWN, ENTER = b"\x1b[B", b"\r"


def emit(event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def step(index, name, params, state="DONE"):
    emit({"event": "step_update", "step_update": {"step_index": index, "state": state, "step_type": "tool",
          "tool_name": name, "tool_info": {"name": name, "parameters": params}}})


def send(fd, data):
    try:
        os.write(fd, data)
    except OSError:
        pass


SEPARATORS = {"&&", "||", ";", "|"}


def escapes_ok(command):
    """Rejects every backslash outside single quotes, except one inside double quotes that is not followed by a quote
    character (grep "a\\|b" keeps working); also rejects substitution, a carriage return and unbalanced quotes."""
    if "\r" in command or "$(" in command or "${" in command or "`" in command:
        return False
    # $'...' and $"..." quoting lets a backslash close the quote early in bash/zsh, which shlex does not model.
    if "$'" in command or '$"' in command:
        return False
    quote = ""
    for i, ch in enumerate(command):
        if quote == "'":
            quote = "" if ch == "'" else quote
        elif quote == '"':
            if ch == "\\" and command[i + 1:i + 2] in ("", '"', "'"):
                return False
            quote = "" if ch == '"' else quote
        elif ch == "\\":
            return False
        elif ch in "'\"":
            quote = ch
    return quote == ""


def allowed(command):
    if "\n" in command.strip() or not escapes_ok(command):
        return False
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split, lex.commenters = True, ""
        tokens = list(lex)
    except ValueError:
        return False
    segments, current = [], []
    for token in tokens:
        if all(c in "();<>|&" for c in token):
            # A quoted operator also lands here: it only ever makes the check stricter.
            if token not in SEPARATORS:
                return False
            segments.append(current)
            current = []
        else:
            current.append(token)
    segments = [" ".join(s) for s in [*segments, current] if s]
    return bool(segments) and all(any(s == p or s.startswith(p + " ") for p in ALLOW) for s in segments)


def add_dirs(argv):
    """Directories the agy session may read and write besides its working directory (--add-dir=X or --add-dir X)."""
    found = []
    for i, arg in enumerate(argv):
        if arg.startswith("--add-dir="):
            found.append(arg.split("=", 1)[1])
        elif arg == "--add-dir" and i + 1 < len(argv):
            found.append(argv[i + 1])
    return found


def path_allowed(target, dirs):
    """A file prompt is answered yes only for an absolute path (no ~ or $) whose realpath is inside the working directory or an --add-dir directory."""
    if not target.startswith("/") or "~" in target or "$" in target:
        return False
    target = os.path.realpath(target)
    for base in [os.getcwd(), *dirs]:
        base = os.path.realpath(base)
        if target == base or target.startswith(base.rstrip(os.sep) + os.sep):
            return True
    return False


FILE_PROMPT = re.compile(r"(Read|Write|Edit|Create|View|List|Delete)( (file|directory|dir))?:? (?P<path>/[^\s;&|<>`$()'\"\\]+)")


def decide(body, dirs, ask=""):
    """Only one line that is exactly a known file verb and one absolute path is a file prompt; everything else is a shell command."""
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    file_prompt = FILE_PROMPT.fullmatch(lines[0]) if len(lines) == 1 and ask != "Run this command?" else None
    if file_prompt:
        return path_allowed(file_prompt.group("path"), dirs)
    return allowed("\n".join(lines))


def split_args(argv):
    """Turns the runtime's print-mode arguments into interactive ones; returns (interactive args, prompt, recap args)."""
    prompt, keep = None, []
    skip_next = False
    for i, arg in enumerate(argv):
        if skip_next:
            skip_next = False
            continue
        if arg.startswith("--print=") or arg.startswith("--prompt="):
            prompt = arg.split("=", 1)[1]
        elif arg in ("-p", "--print", "--prompt") and i + 1 < len(argv):
            prompt, skip_next = argv[i + 1], True
        elif arg.startswith("--output-format") or arg in ("--disable-slash-commands", "--dangerously-skip-permissions"):
            if arg == "--output-format":
                skip_next = True
        else:
            keep.append(arg)
    model = [a for a in keep if a.startswith("--model")]
    return keep, prompt, model


def main():
    keep, prompt, model = split_args(sys.argv[1:])
    dirs = add_dirs(sys.argv[1:])
    if prompt is None or "--dangerously-skip-permissions" in sys.argv[1:]:
        os.execvp(AGY, [AGY, *sys.argv[1:]])
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(AGY, [AGY, *keep, "-i", prompt])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 1000, 0, 0))
    emit({"event": "step_update", "step_update": {"step_index": 0, "state": "ACTIVE", "step_type": "planner_response"}})
    screen, scanned, index, last_out, last_beat, exiting = "", 0, 1000, time.time(), time.time(), 0
    answered, answered_at = None, 0.0
    while True:
        ready, _, _ = select.select([fd], [], [], 1)
        now = time.time()
        if ready:
            try:
                data = os.read(fd, 65536).decode("utf-8", "replace")
            except OSError:
                break
            if not data:
                break
            screen += ANSI.sub("", data).replace("\r", "")
            last_out = now
        if ready:
            fresh = screen[scanned:]
            ends = []
            for ran in RAN.finditer(fresh):
                index += 1
                step(index, "run_command" if ran.group("verb") == "Ran" else ran.group("verb").lower(), {"CommandLine": ran.group("what")})
                ends.append(ran.end())
            prompt_match = PROMPT.search(fresh)
            command = prompt_match and " ".join(line.strip() for line in prompt_match.group("cmd").splitlines() if line.strip())
            if prompt_match and command == answered and now - answered_at < 1.5:
                # The TUI redraws the prompt it just answered; skip that redraw.
                scanned = len(screen)
            elif prompt_match:
                ok = decide(prompt_match.group("cmd"), dirs, prompt_match.group("ask"))
                index += 1
                step(index, "askaway_approval", {"CommandLine": command, "decision": "allow" if ok else "deny"})
                sys.stderr.write(f"[askaway-agy-approve] {'allow' if ok else 'deny'}: {command}\n")
                send(fd, ENTER if ok else DOWN * 3 + ENTER)
                scanned, answered, answered_at = len(screen), command, now
            else:
                # Keep an unfinished permission prompt in view until it is complete.
                pending = fresh.rfind("Requesting permission for:")
                scanned += pending if pending >= 0 else max(ends, default=0)
        if now - last_beat >= HEARTBEAT_SECONDS:
            emit({"event": "step_update", "step_update": {"step_index": 0, "state": "ACTIVE", "step_type": "planner_response"}})
            last_beat = now
        # Done when the TUI has been silent (no spinner, no prompt) for a while: leave with ctrl+d twice.
        if now - last_out >= IDLE_DONE_SECONDS and exiting < 2 and not PROMPT.search(screen[scanned:]):
            send(fd, b"\x04")
            exiting += 1
            last_out = now - IDLE_DONE_SECONDS + 2
        elif exiting >= 2 and now - last_out >= 15:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            break
    _, status = os.waitpid(pid, 0)
    found = RESUME.findall(screen)
    if not found:
        emit({"event": "result", "result": {"conversation_id": "", "status": "ERROR", "response": "",
              "error": f"agy interactive session ended without a conversation id (exit {os.waitstatus_to_exitcode(status)})"}})
        return 1
    # The final answer and usage come from a print-mode recap of the same conversation (no tools needed).
    recap = subprocess.run([AGY, f"--conversation={found[-1]}", *model, *[f"--add-dir={d}" for d in dirs], "--output-format=stream-json", "--disable-slash-commands",
                            "--print=Repeat your final report from the previous turn verbatim. Do not use any tools."],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    sys.stdout.write(recap.stdout)
    sys.stdout.flush()
    return recap.returncode


if __name__ == "__main__":
    sys.exit(main())
