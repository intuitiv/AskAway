# ADR 0004: Delegate to reusable parallel workers

- Status: Proposed
- Date: 2026-10-08
- Goal: G5 in [GOALS.md](../../GOALS.md)

## Context

Putting every detail in the main conversation bloats its context and makes the reviewer pay for that data again. He wants multiple workers that are optimal and reusable. Quality and other non-functional work should not leave the main agent idle.

## Decision

Delegate detail work to multiple reusable workers instead of carrying all its data in the main conversation. Keep workers optimal and reuse them. Run quality and other non-functional work in parallel so the main agent stays busy while it delegates.

> Delegate things to multiple and reusable workers so that we dont just bloat the same conversation with all the data, and pay that cost. (2026-10-08)

> Do much work in parallel, like quality and other non functionals so that main agent is busy when it delegates tasks to workers. (2026-10-08)

> Workers should be optimal. (2026-10-08)

> Reuse workers. (2026-10-08)

## Consequences

- Detail work belongs with workers rather than bloating the main conversation.
- Existing workers are reused rather than needlessly recreated.
- Quality and other non-functional work run in parallel where independent.
- The main agent continues useful work while workers handle delegated tasks.
- Worker activity remains visible in the shared banner and Telegram.

## Related

- [Worker tool requirements](../../tasksync-chat/docs/requirements/worker-tool.md)
- [Workers tab requirements](../../tasksync-chat/docs/requirements/workers-tab.md)
- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
- [001 Async subagent runner](../../specs/001-async-subagent-runner/spec.md)

## Open question

**Keep-alive count (G5).** Does "keep workers alive for 3-4 times" mean at most 3–4 pings per idle worker (about one prompt-cache window each), after which it may expire?
