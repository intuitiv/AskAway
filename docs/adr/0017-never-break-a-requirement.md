# ADR 0017: Never break a requirement

- Status: Proposed
- Date: 2026-10-08
- Goal: G17 in [GOALS.md](../../GOALS.md)

## Context

The reviewer uses what is built here every day. A change that silently breaks one of his stated requirements breaks his work, and he finds out late. His requirements are now written down in one place, and the validator will decide from them.

## Decision

Every change keeps the reviewer's stated requirements true. A change that would contradict a requirement or a decision waits for his new words; when he gives them, the documents change in the same turn. The documents stay accurate because the validator decides from them.

> Update current repos AGENTS.md  file or anything so that we dont break any requirements. And ultimately this will go to validator agent. (2026-10-08)

> Remember validator is not a simple memory tool. It is a decisioning engine, with memory. (2026-10-08)

## Consequences

- Agents read the goal, decision and requirement rows of an area before changing it.
- A requirement is never rewritten to fit the code; only the reviewer's new words change it.
- Superseded rows and decisions are kept, struck through or superseded, with the date.
- A requirement with no test is a known risk; touching its area adds the test.
- A wrong or stale requirement becomes a wrong validator decision.

## Related

- [AGENTS.md](../../AGENTS.md)
- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
- [Availability and validator requirements](../../tasksync-chat/docs/requirements/availability-and-validator.md)
- [ADR 0010](0010-validator-agent-learns-the-reviewer.md)
