---
name: sk-tasks
description: "Generate compact executable tasks and navigable task details for the active spec."
disable-model-invocation: true
---
# /sk.tasks

Require a resolved Decision Register and Cloud Worker Packet. Generate tasks executable by a fresh local or cloud worker without chat history. Follow .specify/templates/tasks-template.md: Setup, Foundational, one phase per [USn] with Independent Test + Checkpoint, then Polish. Mark independent parallel work [P]. Use short plain-language task titles; put execution details in task-details.md rather than repeating the template.

Mark [direct-agent-ready] only for self-contained work with satisfied prerequisites and applicable cloud context. Exclude manual, reviewer-owned, destructive, security-sensitive, unresolved, and externally blocked work. Eligibility is not approval. Use /sk.check for analysis before implementation.

Cloud eligibility: tag every task after its task ID with [cloud] only when it is self-contained, estimated well inside ~45 minutes, has no open questions and needs no local services. Otherwise use [local: <reason>] with the applicable reason: local service, open question, > 45 min, or not self-contained. Keep these tags separate from [direct-agent-ready]. For example: T001 [cloud] [US1] Validate a pure parser; T002 [local: local service] [US1] Verify against a local service. Eligibility only exposes a Queue in cloud affordance; cloud tasks start only on an explicit reviewer request. Never automatically queue eligible tasks or launch them on startup, polling or schedules.


**Task budget (reviewer, 2026-09-28: "speckit goes crazy and creates 100s of tasks").** Generate only the next increment: at most 12 open tasks in the spec and at most 6 per cycle. One task = one outcome the reviewer can see, with its own test; merge rows that share a file and a test, and never emit a task per class, per file, or per checklist item. Work beyond the increment goes into `plan.md` under `## Later` as one-line bullets, not tasks. After `speckit.tasks` returns, run `node tasksync-chat/tools/task-budget.cjs` (active spec). On FAIL, merge or move rows to `## Later` yourself and rerun until it prints PASS; report the PASS line. Never raise the limits unless the reviewer asks.
