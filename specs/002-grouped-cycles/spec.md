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

## Creating Cycles Automatically

Cycles are generated as part of `/tasks`; the reviewer does not need to build them by hand. After
Spec Kit produces the dependency-ordered tasks, the agent groups related tasks and writes the cycle
tags and metadata in the same operation.

Tasks belong together when at least one of these is true:

- one task produces the behavior or evidence another task consumes;
- they touch the same feature boundary and can share setup or context;
- they use the same narrow verification command or test fixture;
- one can make useful progress while another waits for Gradle, an external service, or a subagent.

Tasks do **not** belong together merely because they are adjacent in `tasks.md`. Do not group tasks
that would make two workers edit the same ownership area concurrently. Keep a standalone task when
no useful relationship exists; automatic grouping must not create artificial work.

Prefer two to five tasks per cycle. Use more only when they form one indivisible verification batch.
The next ID is the highest existing workspace cycle number plus one. A later `/tasks` run preserves
existing tags and assigns IDs only to new or ungrouped tasks.

Manual adjustment remains available for exceptions:

- `/cycle add CY-002 T025` — add another approved task to an existing cycle.
- `/cycle remove CY-002 T021` — remove an unstarted task without changing the task itself.

## Storage

Task membership remains authoritative in each feature's `tasks.md` through `[CY-NNN]` tags. Optional
cycle-level metadata lives in `.specify/cycles.md`, one compact row per cycle:

```markdown
| Cycle | Title | Description | Shared verification |
|---|---|---|---|
| CY-002 | Resolution modes | Adds failing coverage for all three modes, implements the shared resolver fix, and records passing integration-test evidence | ForgePipelineIntegrationTest |
```

The description must say exactly what will exist when the cycle is complete. Use concrete verbs and
name the behavior, artifact, or evidence. For example, "Improve resolution confidence" is too vague;
"Adds failing coverage for all three modes, fixes the shared resolver, and records passing integration
tests" is acceptable.

The metadata file does not store task status or copy task text. That information is always derived
from the tagged task lines, which prevents the cycle view and task list from disagreeing.

Creating the example above makes these two edits only:

1. Add `[CY-002]` to the approved task lines in their existing `tasks.md` files.
2. Add the title, exact outcome description, and shared-verification row to `.specify/cycles.md`.

## Execution Rules

- `/implement CY-NNN` resolves every unchecked tagged task across all specs, loads the exact cycle
  outcome and shared verification, and pitches the whole batch once before making changes.
- The orchestrator builds a schedule from task dependencies, touched files, and verification. It
  invokes `speckit.implement` separately for each ready task; no child receives the whole cycle.
- Start long-running verification early when another approved item can progress independently.
- Never edit the same ownership area concurrently from two workers.
- Do not invent work merely to keep a Gradle build or subagent company.
- A waiting or failed item remains visible; completing another item never hides it.
- A failed item blocks its dependents but does not stop tasks proven independent. The final cycle
  result lists completed, failed, blocked, and skipped items explicitly.
- Every task is verified, demonstrated, checked off, and logged separately. The cycle adds one
  shared verification and one commit; it never collapses task evidence into a single result.
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
`2 specs` label. Expanding the row shows its exact outcome description and all member tasks grouped
by spec.

Completed cycles are hidden with completed specs unless the existing **Completed** toggle is on.
Tasks without a cycle remain visible and continue to use `/implement T014` normally.

## Open Decisions

1. How many items should a cycle normally hold before coordination costs exceed the saved waiting
  time? Start with a recommendation of two to five, not a hard limit.
2. What progress can a subprocess-backed subagent expose without requiring frequent polling?