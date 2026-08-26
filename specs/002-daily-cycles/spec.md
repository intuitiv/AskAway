# Daily Cycles and Grouped Execution

A cycle is a soft daily batch of related work. It creates a useful boundary for planning,
review, verification, and one git commit without pretending every day has fixed capacity.

## Example

A cycle might contain three tasks from two specs: add a failing test, implement the shared fix,
and update the benchmark. If the first task starts a Gradle run, the agent analyzes the second
while Gradle works. The cycle can spill into tomorrow or accept another task.

## Goals

- Group two or more related tasks when they share setup or verification.
- Keep each task understandable and reviewable inside the batch.
- Run expensive verification once at the best boundary instead of repeating it per task.
- Produce one commit per completed cycle, with the commit log as the durable record.
- Estimate completion from review/testing size and active-day history, not implementation effort.
- Allow a command such as `/implement CY-002` to execute an approved batch.

## Constraints

- A cycle is not a deadline and does not count leave days as zero velocity.
- A failed or blocked task stays visible; it is never hidden by completing the rest of the batch.
- Work requiring a reviewer decision still stops at that decision.
- Handoff records state only. It does not finish code, tests, task logs, or documentation.

## Open decisions

1. Store cycles as files, derive them from task metadata, or both?
2. Size work as small/medium/large review surface or use observed review minutes?
3. Should a failed item halt `/implement CY-002`, or should the cycle continue and report it?
4. What is the smallest useful cycle view in the Specs tab?