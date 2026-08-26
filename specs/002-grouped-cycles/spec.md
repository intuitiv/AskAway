# Cycles and Grouped Execution

A cycle is a small, approved batch of work that gives the agent several useful things to do.
It replaces strict task-by-task execution when the items can share setup, verification, or waiting
time. A cycle is not tied to a day, sprint, or deadline.

## Example

A cycle contains three tasks: add a failing test, implement the shared fix, and update a benchmark.
The agent starts the Gradle test for the first task, analyzes the second while Gradle runs, and can
delegate a repository search for the benchmark to a subagent. When one activity is waiting, another
approved item moves forward instead of the agent polling or inventing busywork.

## Goals

- Keep a small queue of approved work available to the agent.
- Keep tasks as the smallest unit of work and group them by assigning a cycle ID.
- Overlap independent analysis, Gradle runs, and future subprocess-backed subagents.
- Group tasks that share setup, context, or verification.
- Keep each item understandable and reviewable inside the batch.
- Run expensive verification at the best boundary instead of repeating it mechanically per task.
- Produce one commit per completed cycle, with the commit log as the durable record.
- Allow a command such as `/implement CY-002` to execute an approved batch.

## Task Membership

Tasks remain in the feature's `tasks.md`; a cycle does not copy or replace them. A task joins a
cycle through a tag:

```markdown
- [ ] T014 [CY-002] Add the failing resolution-mode tests
- [ ] T015 [CY-002] Implement the shared resolution fix
- [ ] T021 [CY-002] Update the benchmark evidence
```

The two execution forms are:

- `/implement T014` — execute and verify only the resolution-mode test task.
- `/implement CY-002` — execute the unchecked tasks tagged `[CY-002]` as one approved work batch.

Cycle execution does not merge the tasks into one opaque job. Each task keeps its own status,
evidence, and implementation-log row. The cycle controls scheduling: it decides which independent
item can progress while another waits, and it provides the shared verification and commit boundary.

## Execution Rules

- Start long-running verification early when another approved item can progress independently.
- Never edit the same ownership area concurrently from two workers.
- Do not invent work merely to keep a Gradle build or subagent company.
- A waiting or failed item remains visible; completing another item never hides it.
- A cycle may pause, accept another related item, or continue in another conversation.
- Work requiring a reviewer decision still stops at that decision.
- Handoff records state only. It does not finish code, tests, task logs, or documentation.

## Cycle States

- **Ready** — items are approved and their dependencies are understood.
- **Running** — at least one item is actively progressing.
- **Waiting** — remaining progress depends on verification, a subagent, or a reviewer decision.
- **Complete** — every item is verified or explicitly recorded as skipped/blocked, and the cycle is
  committed.

## Open Decisions

1. Where should optional cycle-level metadata such as title, intent, and shared verification live?
2. How many items should a cycle normally hold before coordination costs exceed the saved waiting
   time?
3. Should a failed item halt `/implement CY-002`, or should independent items continue?
4. What progress can a subprocess-backed subagent expose without requiring frequent polling?
5. What is the smallest useful cycle view in the Specs tab?