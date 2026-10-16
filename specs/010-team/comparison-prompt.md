# Comparison prompt — Team + AITalk Storybook (010 T024, R-TEAM-25)

One identical packet for three candidates: **Sol 6.1** (OpenCode), **Opus 5.5** (OpenCode), **Argon High**
(`agy`, `gemini-4-argon-high`). Each runs in its own git worktree from the same frozen commit. Only the model differs.
Status: **draft, waiting for the reviewer's approval** before any launch.

---

## Packet (sent verbatim to each candidate)

**Objective.** Rebuild the Team prototype in Storybook so it looks and behaves like the AskAway sidebar the reviewer
already uses. It is a Storybook-only change: no production extension code changes. The reviewer approves the look
here before production work starts.

**Read first (do not paste, read):** `GOALS.md` section 4 entries 2026-10-15 and 2026-10-16;
`docs/adr/0021-aitalk-actor-framework.md`; `docs/adr/0023-agy-first-team-members.md`;
`tasksync-chat/docs/requirements/team.md` rows R-TEAM-04, 08, 09, 11, 13–15, 19–24; `tasksync-chat/docs/requirements/aitalk.md`.

### 1. The format to follow: the existing Storybook, not a web page
- Reference stories: `AITalk/Talk` (`storybook/stories/Talk.stories.js`: FullConversation, LiveSimulation,
  WebexDraftApproval), `AITalk/Trace tab` (`Trace.stories.js`), `AITalk/Availability` (`Presence.stories.js`).
- They mount the **production widget** through `storybook/prototypes/mount.js` → `createTalkController`
  (`media/aitalk/talkController.js`), styled by `media/main.css` + `media/aitalk/talk.css` + `VSCODE_DARK_THEME`
  (`storybook/kit.js`), and driven by simulated actors (`storybook/prototypes/simulatedActors.js`) with a timed
  `live.script`. Production render blocks are pulled from `media/webview.js?raw` by `kit.js` (see `buildTraceKit`).
- The production tab strip is `webviewProvider.ts:5224-5228`: **AITalk · Specs · Trace · Workers · Settings**. The
  Team story shows that same strip with **Workers renamed Team**; no other tab or button is added.
- Remove from the current prototype (`storybook/prototypes/team.js`, `storybook/stories/Team.stories.js`,
  `media/team/team.css`): the extra AITalk/Team navigation buttons, the top summary pills/chips, the persona and
  skills editors, and the end-of-turn member cost rollup and tip panel (story `EndOfTurnCostRollup` goes).
- Stories live under `AITalk/…` next to the others (e.g. `AITalk/Team tab`), dark default plus one light story.

### 2. Names (visible) and members
Participant names are simple first names. Role is a separate field shown only in the Team tab. No "Build",
"Reviewer", "Manager" prefixes anywhere in AITalk. The user shows as their own name and photo (fixture name
"Machs", fixture image under `storybook/fixtures/`, never the real `~/.askaway/profile/avatar.png`), not "CPO".

| Member | Role | Backed by | Default model · effort |
|---|---|---|---|
| Mahesh | Orchestrator | native agent AA.Orchestrator | (main chat model) |
| Bhaskar | Tech Lead | native agent AskAway Build | (main chat model) |
| Priya | Product Owner | Validator (always pinned first) | Validator's model |
| Anika | Architect | `build` profile | `github-copilot/claude-opus-5.5` · high |
| Diego | Developer | `build`/`code` profiles | `agy/gemini-4-argon-high` · high |
| Tara | Test Engineer | `test`/`verify` | `github-copilot/gpt-6-luna` · low |
| Pavel | Performance Analyst | `perf` | `agy/gemini-4-argon-high` · high |
| Rhea | Rules Expert | `review`/`quality` | `github-copilot/gpt-6-luna` · low |
| Paolo | Pipeline Expert | `gradle` | `github-copilot/gpt-6-luna` · low |
| Sana | Researcher | `explore`/`research` | `github-copilot/gpt-6-luna` · low |
| Shreya | Root-Cause Analyst | `rca` | `agy/gemini-4-argon-high` · high |
| Cathy | Webex Chatter | `webex` | `agy/gemini-4-argon-high` · high |

- The selected native agent owns the main identity: AA.Orchestrator → Mahesh, AskAway Build → Bhaskar, an unknown
  agent → its actual display name with initials (R-TEAM-13).
- Every member has a stable id; `@Bhaskar`, `@Diego`, … autocomplete shows face + name + role, inserts the name and
  routes by id. Inactive members are not suggested; two members with the same first name show their role to choose.
- Creative statuses per role, working / idle, e.g. Diego "Shipping code…" / "Coffee break", Tara "Breaking
  things…" / "All green", Paolo "Waiting on CI…" / "Pipes clear", Priya "Thinking like you…" / "On call",
  Mahesh "Splitting the work…" / "Plan ready", Bhaskar "Wiring it up…" / "Reviewing diffs".
- Faces: use the portrait fixtures in `storybook/fixtures/avatars/` if present, otherwise initials. Real portraits are
  a separate task (010 T005); keep one `avatarFor(memberId)` lookup so swapping images is a one-file change. The same
  face appears in AITalk bubbles, the AITalk header, join notices and the Team row.

### 3. AITalk changes (same widget, simulated)
- Header lists the simple names of who is present; no pills.
- Join and leave notices read exactly `Bhaskar joined`, `Diego left`.
- The main agent joins at turn start. A member joins when the main agent assigns it a task, shows typing while it
  works, and leaves when its task ends and its messages are answered (ADR 0023 supersedes post-only joins).
- When the main agent asks Priya, the question shows as Bhaskar's (or Mahesh's) bubble first, then Priya's typing,
  then her reply quoting it.
- Clicking a participant name or avatar switches to the Team tab and scrolls to and highlights that member row.

### 4. Team tab: one row per member (reviewer's mockup)
```
┌──────────┬───────────────────────────┬──────────────────────────────────────┐
│          │ Diego · Developer         │ [2 tasks ▸]                          │
│  photo   │ ● Shipping code…          │  (collapsed by default; click opens  │
│ (~72px)  │ Profile: build            │   the task cards below, click closes)│
│          │ Model [agy/gemini-4-arg ▾]│                                      │
│          │ Thinking [high ▾]         │                                      │
│          │ Agent file ↗              │                                      │
└──────────┴───────────────────────────┴──────────────────────────────────────┘
```
- Portrait left, slightly bigger than today's card avatar (~72px, stable size). Middle: `Name · Role`, status,
  profile, Model dropdown, Thinking dropdown, "Agent file" link. Right: the counted `n tasks` pill; clicking it
  expands/collapses that member's task cards; the open/closed state survives re-renders.
- Only members active in the current turn are shown; Priya is pinned first among them.
- Model dropdown lists the available models, OpenCode and agy together: `github-copilot/claude-opus-5.5`,
  `github-copilot/claude-sonnet-5.5`, `github-copilot/gpt-6.1-sol`, `github-copilot/gpt-6-luna`,
  `agy/gemini-4-argon-{high,medium,low}`, `agy/gemini-3.8-flash-{high,medium,low}`, `agy/gemini-3.1-pro-{high,low}`.
  Thinking offers only the efforts that model supports; for agy the effort is the model suffix, so changing one
  updates the other. Changing them posts an intent (`setMemberModel`) in the story; existing tasks keep the model
  they ran on.
- "Agent file" posts an `openAgentFile` intent with the member's profile path (the extension will open it for editing).
- A member edit view (opened from the row) asks only: display name, role, model, thinking effort, agent file link.
- **Task cards reuse the existing Workers card** (pure render block `// ── Workers tab: pure render` in
  `media/webview.js`, extracted the way `kit.js` extracts trace rows). Same lines as today: `runtime · model ·
  effort`; `Score · reqs · $ · last in / turn out · cache`; `Age … · pinged …`; the italic last message; buttons
  `Open in VS Code`, `Terminal app`, `Trace (n)`. Do not build a second look-alike card. For agy tasks: no ping,
  cache age or warmth (R-TEAM-19), and cost shows "unreported", never $0.
- User-visible "worker" wording becomes "task" inside the Team tab; internal ids stay `worker…`.

### 5. Scenarios (stories)
1. `ActiveTurn` (dark, live script, ~40 s): Bhaskar joined → asks Priya a question → Priya typing → reply →
   Anika joined (design task) → Diego joined (two tasks) → Team shows Priya, Bhaskar, Anika, Diego `2 tasks` →
   user types `@Di` → picks Diego → asks a question → Diego answers → Tara joined (verify) → "All green" →
   Anika left, Diego left, Tara left. AITalk and Team panes visible together in the story canvas, side by side,
   both inside the same tab shell.
2. `OrchestratorSelected`: same turn with AA.Orchestrator, so Mahesh replaces Bhaskar everywhere.
3. `UnknownAgent`: a custom agent shows its actual name with initials.
4. `MemberEdit`: edit view open on Diego, model dropdown open with agy and OpenCode models.
5. `NameClickOpensProfile`: click Priya in AITalk → Team tab, Priya's row highlighted.
6. `LightTheme`.
- A GIF of `ActiveTurn` for GitHub and the Marketplace: extend `storybook/tools/capture-readme.cjs` (Playwright) to
  write `.askaway/storybook-review/team-active-turn.gif`, ≤ 8 s loop, ≤ 3 MB.

### 6. Tests and constraints
- Allowed files: `tasksync-chat/storybook/stories/Team.stories.js`, `tasksync-chat/storybook/prototypes/team.js`,
  new files under `tasksync-chat/storybook/prototypes/` and `tasksync-chat/storybook/fixtures/`,
  `tasksync-chat/media/team/team.css`, `tasksync-chat/storybook/tools/capture-readme.cjs`,
  `tasksync-chat/test-team-storybook.cjs`. Read anything; edit nothing else (no `media/webview.js`, no `src/`).
- `test-team-storybook.cjs` asserts from the caller's view: shell has exactly AITalk/Specs/Trace/Team/Settings and no
  extra nav buttons; no pills; no persona/skills/rollup; join/leave text exact; header names simple; user name not
  "CPO"; only active members; Priya first; pill count = cards; pill toggles and state survives a re-render; task card
  HTML contains the shared Workers render output; model and effort dropdown options; `@Di` → Diego id; name click →
  Team row; agy card shows no ping/age-warmth and "unreported" cost.
- Must stay green: `node tasksync-chat/test-team-storybook.cjs`, `node tasksync-chat/test-aitalk-ui.cjs`,
  `npm --prefix tasksync-chat/storybook run build-storybook`.
- No commit, no push, no deletes, no network calls other than the local Storybook. Stop after 30 steps; report what
  is left.

**Verification command:** `node tasksync-chat/test-team-storybook.cjs` — expected: all PASS lines, exit 0.

**Report (under 1500 chars):** each of sections 1–6 → done / partial / not done; files changed; tests run with their
PASS lines; anything you could not do and why.

---

## How the comparison runs (orchestrator side, not sent to candidates)
- Reviewer 2026-10-16: "Run with agy once, before Opus. Dont do with Sol," — Sol is dropped; Argon runs first,
  Opus after from the same base.
- Freeze: branch `cmp-base` in worktree `../TaskSync-cmp-argon` holds the current tree as one commit; Opus later gets
  `../TaskSync-cmp-opus` from `cmp-base`. `main` is not touched; `node_modules` are linked.
- Launch: Sol 6.1 and Opus 5.5 as `build` workers, Argon High via `runtime: agy`, `agyPermissions: skip`; each with
  `workspacePath` on its own worktree and this packet unchanged. At most two OpenCode build workers at once.
- Score: the same checks in each worktree, plus a blind side-by-side of the six stories and the GIF for the
  reviewer. Record per candidate: acceptance items met, steps, active minutes, tokens, cost (OpenCode reported;
  agy "unreported", never $0), orchestration and verification cost kept separate.
- The reviewer picks the winner; only that worktree's diff comes back to `main`.

---

## Round 2 packet (Argon only, same worktree) — reviewer review 2026-10-16
Argon's round 1 is accepted as the base ("They look okay to me"). Change only these, in the same allowed files:
1. **Separate tabs.** AITalk and Team are two tabs of the one tab strip; only one panel is visible at a time (no side-by-side
   or merged canvas). Clicking a name or avatar in an AITalk bubble/notice switches the strip to Team and highlights that
   member row (R-TEAM-28). The `ActiveTurn` story plays the turn in AITalk; a story control or the script switches tabs.
2. **AITalk header:** under the room name, a plain comma list of present names; no images there (R-TEAM-27).
3. **User photo:** the user's avatar is the fixture `storybook/fixtures/avatars/user.png` (a stand-in for
   `~/.askaway/profile/avatar.png`; never copy the real file). Member faces stay as they are.
4. **Cost per member in Team:** each member row shows its cost for the turn and month (moved from the Trace tab's
   category table). agy cost is $0 for now, shown as `$0`, replacing "unreported" (R-TEAM-29, R-TEAM-30).
5. **Validator trace in Team:** Priya's row expands to her trace rows (shared `traceRowsHtml`); the Trace tab story shows
   the main agent only (R-TEAM-29).
- Update `test-team-storybook.cjs` from the caller's view for 1–5; keep checks 1–11 green except where 4 replaces the
  "unreported" wording. Verification: `node tasksync-chat/test-team-storybook.cjs`, `node tasksync-chat/test-aitalk-ui.cjs`,
  `npm --prefix tasksync-chat/storybook run build-storybook`. Commands now run through the AskAway approval wrapper.
