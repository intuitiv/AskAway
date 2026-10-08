# ADR 0005: Keep warm workers alive

- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G5 in [GOALS.md](../../GOALS.md)

## Context

Expiring a worker loses context that could be reused. Recreating that worker repeats work and cost. The reviewer wants a cheap ping to keep warm workers available.

## Decision

Keep warm workers alive with a cheap message such as "reply ok" so their context can be reused instead of expiring and being recreated. Each idle worker gets at most 4 pings; after that it may expire.

> Keep workers alive for 3-4 times, by pinging some message, like "reply ok" and all so that we can reuse the context instead of expiring it and recreating them again. (2026-10-08)

> 4 pings per worker (2026-10-08)

## Consequences

- Warm workers remain available for context reuse through cheap pings.
- Expiration and recreation must not be the default when context can be reused.
- A keep-alive message asks for a minimal reply, not new detail work.
- After the fourth unused ping an idle worker may expire.

## Related

- [Worker tool requirements](../../tasksync-chat/docs/requirements/worker-tool.md)
- [Workers tab requirements](../../tasksync-chat/docs/requirements/workers-tab.md)
- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
- [001 Async subagent runner](../../specs/001-async-subagent-runner/spec.md)

## Answered

**Keep-alive count (G5):** 4 pings per worker (reviewer, 2026-10-08).
