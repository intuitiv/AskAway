---
agent: AskAway Build
description: Resume the active Spec Kit feature and pitch its next eligible task.
---

# /sk.continue

Resume the active feature in .specify/feature.json. If the file is missing, say to run /sk.start NNN and stop.

Steps:
1. Read implementation-log.md before tasks.md: what is done, the evidence, what is blocked and why.
2. Build the candidate list from unchecked tasks whose prerequisites are done. Exclude manual, reviewer-owned, blocked, moved, and deferred work. Prefer the earliest user story (P1 first); take a [P] task only when its files are independent of work in flight.
3. If no task is eligible, say why and route: open questions go to /sk.check, a missing plan to /sk.plan, missing tasks to /sk.tasks, everything done to /sk.check for convergence.
4. Pitch exactly one task with Task (ID and title), Plan (three to five steps and the files), Value (what the reviewer can see), and Demo (the command and its expected result). Stop for approval; once approved, continue with /sk.implement.
