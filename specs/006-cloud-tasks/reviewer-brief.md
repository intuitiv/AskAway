# Reviewer brief — 006 Cloud Tasks

## What you asked for
- 2026-09-30, Goal/Rules (005): "Work continues while the reviewer is offline." A flagged task has a button; the extension polls; the same branch (the active PR) is updated; the model should be selectable; the message states stage, task and what to do.
- 2026-09-30, spec Clarifications: block merging the active PR while a cloud task is Working; Actions run on cloud pushes: "GitHub Actions automatically will run on any PR. No much choice here."
- 2026-10-06, today: "I want to implement a user story in github. Once the spec is in implement phase, we merge them to the branch and run it in github actions. Thats my ultimate goal."
- 2026-10-06, today: "61 minutes is okay. I think it is reasonable to have cap on time."

## The design in short
- `/sk.tasks` marks a task `[cloud]` or `[local: reason]`; eligible tasks get a "Queue in cloud" button.
- Pressing it writes one packet file (nine fields) and pushes it to the active PR branch.
- It then posts one short `@copilot` comment (≤5 lines) that points at the packet. No new branch, PR or issue.
- The extension polls the PR every ~3 min with `gh`: reactions, timeline, commits, check runs, comments.
- States: Held → Queued → Working → Pushed → Checks passed/failed → Needs review → Accepted/Returned; also Timed out and No response (10 min).
- Limits: one Working task per PR; each run capped (default 50 min, max 59, FR-024); no secrets in packet or comment.
- A local verify worker pulls the branch, runs the packet's commands, checks allowed paths; only then the task is ticked.
- Spec and plan stage output stays a draft; no approval gate is passed offline.
- Status shows on the task row, the Workers feed (shared trace row) and Telegram, plus a morning digest. Duration and model only, never a price.
- US1 is a live proof first (T004); nothing is built on the route until it says go.
- Later US6: a whole story delegated to GitHub once the spec is in implement.

## Decisions taken today
- F9: constitution filled (v1.0.0) from AGENTS.md and copilot-instructions.md; plan uses it as the gate.
- F11: plan approved after a check (HIGH findings Fixed, no open clarification, plan matches tasks).
- F13: "Sure" — the model fallback to the PR default is accepted.
- F22: story-level delegation added as Later US6.
- Time cap: FR-024 and Rules.md; T004 budget 61 min.

## Remaining questions
- **F7 — merge block scope.** Today the plan posts a required status on every PR head. Options: (a) block merge on all PRs; (b) only PRs that have a cloud task. Recommend (b): fewer surprises, same safety where it matters; it needs the extension to post `success` on other PRs only when a task exists.
- **F21 — go/no-go.** T004 measures what GitHub really does when the extension posts a comment: same-branch push, which model ran and whether we could choose it, which signals appear and in what order, whether Actions ran or waited for approval, whether two comments run two sessions at once, and the duration. Criteria: same branch (must), signals observable (must), Actions behaviour (known, may be limit), model selectable (nice), concurrency (nice). Go: US2 starts. No-go: we stop and bring you the evidence. Option (a): go only if model is selectable and concurrency is yes; (b): go on any working route and record gaps as limits. Recommend (b); the model fallback is already accepted (F13) and one-at-a-time is the default.
- **F18 — tags on 006's own tasks.** Options: (a) tag `[cloud]`/`[local: reason]` when the `/sk.tasks` asset ships; (b) tag now by hand. Recommend (a): the tag format is defined by that asset.
- **T004 prerequisites (yours).** Options per item; recommend all four before the run: (1) name an open PR to post on (a throwaway PR is safest); (2) confirm the Copilot cloud agent is enabled for the repo; (3) turn off "Require approval for workflow runs" (Settings → Copilot → Cloud agent), or leave on and record the held state; (4) name the model to request in the model-probe comment, or accept the PR default.
