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

## Creating A Cycle

Use `/cycle create` while a feature is active. The agent inspects the unchecked tasks and proposes a
small group with a reason for grouping them. It does not change files until the reviewer approves
the proposed membership.

Examples:

- `/cycle create` — propose a useful group from the active feature's unchecked tasks.
- `/cycle create T014 T015 T021` — propose a cycle containing those tasks.
- `/cycle add CY-002 T025` — add another approved task to an existing cycle.
- `/cycle remove CY-002 T021` — remove an unstarted task without changing the task itself.

The next ID is the highest existing cycle number plus one. IDs belong to the workspace, not to one
feature, so a cycle may intentionally contain tasks from more than one spec.

## Storage

Task membership remains authoritative in each feature's `tasks.md` through `[CY-NNN]` tags. Optional
cycle-level metadata lives in `.specify/cycles.md`, one compact row per cycle:

```markdown
| Cycle | Title | Intent | Shared verification |
|---|---|---|---|
| CY-002 | Resolution confidence | Test and fix the three resolution modes | ForgePipelineIntegrationTest |
```

The metadata file does not store task status or copy task text. That information is always derived
from the tagged task lines, which prevents the cycle view and task list from disagreeing.

Creating the example above makes these two edits only:

1. Add `[CY-002]` to the approved task lines in their existing `tasks.md` files.
2. Add the optional title, intent, and shared-verification row to `.specify/cycles.md`.

## Execution Rules

- Start long-running verification early when another approved item can progress independently.
- Never edit the same ownership area concurrently from two workers.
- Do not invent work merely to keep a Gradle build or subagent company.
- A waiting or failed item remains visible; completing another item never hides it.
- A cycle may pause, accept another related item, or continue in another conversation.
- Work requiring a reviewer decision still stops at that decision.
- Handoff records state only. It does not finish code, tests, task logs, or documentation.

## Cycle States

- **Ready** — every tagged task is unchecked.
- **Running** — at least one tagged task is complete and at least one remains unchecked.
- **Complete** — every tagged task is complete.

These states are derived from `tasks.md`, just like spec progress. **Waiting** is transient execution
information shown while `/implement CY-002` is running; it is not persisted as cycle metadata.

## Specs Tab

Expanding a spec shows a **Cycles** section above its phase list. Each cycle is a compact row rather
than a nested card:

```text
CY-002  Resolution confidence       1/3  Running    [Implement cycle]
        T014 done · T015 next · T021 queued
```

The row shows:

- cycle ID and title;
- completed/total task count across every participating spec;
- derived state;
- the next unchecked task in plain words;
- an **Implement cycle** button that places `/implement CY-002` in the VS Code chat input without
  sending it.

If a cycle spans specs, the same cycle row appears in each participating spec with a small
`2 specs` label. Expanding the row shows all member tasks grouped by spec. A **Create cycle** action
appears only on the active spec and places `/cycle create` in the chat input without sending it.

Completed cycles are hidden with completed specs unless the existing **Completed** toggle is on.
Tasks without a cycle remain visible and continue to use `/implement T014` normally.

## Open Decisions

1. How many items should a cycle normally hold before coordination costs exceed the saved waiting
  time? Start with a recommendation of two to five, not a hard limit.
2. Should a failed item halt `/implement CY-002`, or should independent items continue?
3. What progress can a subprocess-backed subagent expose without requiring frequent polling?