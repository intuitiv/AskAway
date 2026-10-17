#!/usr/bin/env python3
import pexpect
import sys

MODEL = "gemini-4-argon-medium"
PROMPT = "List all folders in the home directory."

child = pexpect.spawn(
    "agy",
    ["--model", MODEL],
    encoding="utf-8",
    timeout=None,
    dimensions=(40, 120),
)

# Display agy's terminal output in your terminal.
child.logfile_read = sys.stdout

# Wait for the interactive prompt, then send the task.
child.expect([r"(?i)how can I help", r"(?i)enter.*message", pexpect.TIMEOUT], timeout=5)
child.sendline(PROMPT)

while True:
    try:
        index = child.expect(
            [
                r"(?i)allow once",
                r"(?i)allow",
                pexpect.EOF,
            ],
            timeout=None,
        )

        if index == 0:
            # Select the first approval option.
            child.send("1\r")
        elif index == 1:
            # Generic Allow prompt: inspect before automating this case.
            print("\nDetected Allow prompt; not auto-approving blindly.")
            child.interact()
            break
        else:
            break

    except KeyboardInterrupt:
        child.close(force=True)
        break

child.close()
