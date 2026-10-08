# ADR 0002: Every ask is a tracked task

- Status: Proposed
- Date: 2026-10-08
- Goal: G3 in [GOALS.md](../../GOALS.md)

## Context

The reviewer may give several asks in one message or add more during a conversation. None may disappear when the agent moves on to other work. He needs to know what was completed and what is still waiting.

## Decision

Track every ask in every message in Spec Kit tasks or the backlog. Close it with evidence, or report that it is waiting and why. Never silently drop an ask.

> Never miss any task I ask for, use speckit tasks to track them if needed. (2026-10-08)

## Consequences

- Every ask has a tracked task or backlog entry.
- Later messages add to the tracked work rather than replacing unfinished asks.
- Completion requires evidence visible to the reviewer.
- Waiting work remains visible with its reason.

## Related

- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
