# Goal — 006 Cloud Tasks

Inherits the 005 outcome "Work continues while the reviewer is offline" (`specs/005-speckit-guided-flow/Goal.md`).

## Ultimate outcome (reviewer, 2026-10-06)
"I want to implement a user story in github. Once the spec is in implement phase, we merge them to the branch and run it in github actions. Thats my ultimate goal."

## Outcomes that define done
- **Per-task first.** Flagged tasks are queued to the Copilot cloud agent on the active PR's branch, polled, shown, and accepted only after local verification.
- **Then whole stories.** A whole user story is delegated to GitHub (cloud agent in Actions) on the active PR branch once the spec is in implement (Later US6).
- **Bounded.** Every cloud run has a wall-clock cap (Rules.md).
