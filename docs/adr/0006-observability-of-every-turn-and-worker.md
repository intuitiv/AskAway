# ADR 0006: Observability of every turn and worker

- Status: Proposed
- Date: 2026-10-08
- Goal: G6 in [GOALS.md](../../GOALS.md)

## Context

The reviewer needs to see what each turn costs and how much workers contribute to it. Cost alone does not show requests, token use, cache use or efficiency. He wants worker details visible both at his desk and remotely.

## Decision

Show each turn's cost and the workers' share, requests, input tokens, output tokens, cache percent, number of workers, their details and the efficiency score. Make this observability available in the shared banner and Telegram.

> - Observability is very important to me. How much cost a turn incurred. How much workers share (2026-10-08)

> - Requests, input tokens, output tokens, cache percent, number of workers and their details and efficiency score. (2026-10-08)

> Observability of workers should be visible to me in shared banner and telegram. (2026-10-08)

## Consequences

- Each turn exposes its cost and the workers' share of that cost.
- Requests, input and output tokens, and cache percent are visible.
- Worker count and worker details accompany the turn's efficiency score.
- The shared banner and Telegram both provide this visibility.

## Related

- [Observability requirements](../../tasksync-chat/docs/requirements/observability.md)
- [Chat banner requirements](../../tasksync-chat/docs/requirements/chat-banner.md)
- [Metrics tab requirements](../../tasksync-chat/docs/requirements/metrics-tab.md)
