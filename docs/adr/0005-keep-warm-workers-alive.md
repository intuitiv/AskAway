# ADR 0005: Keep warm workers alive

- Status: Proposed
- Date: 2026-10-08
- Goal: G5 in [GOALS.md](../../GOALS.md)

## Context

Expiring a worker loses context that could be reused. Recreating that worker repeats work and cost. The reviewer wants a cheap ping to keep warm workers available.

## Decision

Keep warm workers alive with a cheap message such as "reply ok" so their context can be reused instead of expiring and being recreated. The reviewer calls for 3-4 times; what that count limits remains an open question.

> Keep workers alive for 3-4 times, by pinging some message, like "reply ok" and all so that we can reuse the context instead of expiring it and recreating them again. (2026-10-08)

## Consequences

- Warm workers remain available for context reuse through cheap pings.
- Expiration and recreation must not be the default when context can be reused.
- A keep-alive message asks for a minimal reply, not new detail work.
- The meaning of the 3-4 count needs the reviewer's answer, not an agent's assumption.

## Related

- [Worker tool requirements](../../tasksync-chat/docs/requirements/worker-tool.md)
- [Workers tab requirements](../../tasksync-chat/docs/requirements/workers-tab.md)
- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
- [001 Async subagent runner](../../specs/001-async-subagent-runner/spec.md)

## Open question

**Keep-alive count (G5).** Does "keep workers alive for 3-4 times" mean at most 3–4 pings per idle worker (about one prompt-cache window each), after which it may expire?
