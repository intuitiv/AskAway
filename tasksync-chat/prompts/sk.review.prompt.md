---
agent: AskAway Build
description: Review measured cost, AI time, requests, and delivered outcomes for a spec.
---

# /sk.review

Review the selected spec ($ARGUMENTS, else the active feature) without changing product code.

Evidence to read: the spec's cost ledger under ~/.askaway/spec-cost for this workspace, the .askaway/specs folder for the spec, implementation-log.md, tasks.md, and the Specs tab figures (provider cost, AI time, requests).

Report:
1. Measured provider cost, AI time and request count, split by stage (specify, check, plan, tasks, implement, converge) and by main agent versus workers.
2. Separate productive work, research, rework (tasks redone or reverted) and human waiting.
3. Delivered outcomes: stories whose Checkpoint passed, tasks done, and what remains.
4. Cost per delivered outcome and where it was highest.
5. Two or three concrete changes that would cut cost or time without losing quality.

Do not treat lower cost alone as higher value. Say plainly when a figure is missing.
