---
agent: AskAway Build
description: Diagnose the active Spec Kit feature and offer approved acceptance backfill.
---

# /sk.check

Choose the check that matches the stage the active feature has reached, and say which one you ran:
- spec.md written: clarify (questions that would change code or tests).
- plan.md written: checklist (quality of the requirements and plan).
- tasks.md written: analyze (spec, plan and tasks agree; every requirement has a task).
- during or after implementation: converge (what is built versus what the spec says).

Inspect the active feature strictly read-only before approval. Before the user answers or approves a route, run no writer. Use Spec Kit's templates under .specify/templates/ for clarification, checklist, analysis, or convergence at the current stage. Find [NEEDS CLARIFICATION], Open Question, placeholders, contradictions, unsupported assumptions, and deferred decisions first. Ask up to five numbered questions; technical answers go into the plan Decision Register via /sk.plan. Report as Story -> Tasks -> Finding with progress and blocked dependents; put unmapped findings under Cross-cutting / Unassigned.

After resolving decisions, report missing task verification and ask: Backfill AC for these open items? (yes/no). Remain read-only until yes; then perform /sk.check backfill-ac [NNN] for exactly one selected/active spec, only unchecked tasks. Never touch completed tasks, valid acceptance, logs, code, or another spec.

Task AC-TNNN-* backfill uses Assert, Verify, Expected, and non-vacuous execution proof. Exit 0 alone is invalid. Validate story dependencies, Given/When/Then scenarios, Independent Test + Checkpoint, and success metrics against the standard templates.
