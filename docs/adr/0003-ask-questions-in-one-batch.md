# ADR 0003: Ask questions in one batch

- Status: Proposed
- Date: 2026-10-08
- Goal: G4 in [GOALS.md](../../GOALS.md)

## Context

Repeated questions interrupt the reviewer. He wants to answer the agent's questions in one shot. Those answers should also help the validator learn what he needs over time.

## Decision

Collect the agent's questions and ask them together in one message. Let the reviewer answer the whole batch at once. Use his answers to help the validator learn his requirements.

> And when agent has questions, it should ask me in bulk so that I'll respond to all in one shot. This is also for reducing my interruption and Validator agent will know my requirements and it will learn what I need over time. (2026-10-08)

## Consequences

- Known questions are presented together, not one interruption at a time.
- The reviewer can answer the batch in one response.
- Answers inform the work and the validator's understanding of the reviewer.

## Related

- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
