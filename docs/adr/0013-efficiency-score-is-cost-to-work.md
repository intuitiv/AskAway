# ADR 0013: Efficiency score is cost to work
- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G13 in [GOALS.md](../../GOALS.md)

## Context
The reviewer wants one number to judge how efficiently each turn ran. Task success is a different question from cost to work. A long turn should not excuse a low score.

## Decision
Use an outcome-independent efficiency score per turn, with higher values meaning better efficiency. It reflects cost, input tokens, workers, requests, cache misses and output tokens. Use it in the shared banner, in the benchmark to tune tools and prompts, and in Telegram and other observability. Keep task completion as a separate benchmark check; the reviewer judges live turns.

> - Efficiency score: This is like a number which can tell how well a turn was done, irrespective of outcome. Higher the number better it is. It will include cost, input tokens, workers, requests, cache miss, output token (2026-10-08)

> - Score should be always high. No matter how long it ran. If it drops that means we are doing something unoptimal. It's more like cost to work. (2026-10-08)

> - Benchmark will tell whether it completed the required task or not. And I'll decide whether it did well on live turns. (2026-10-08)

## Consequences
- Each turn has one efficiency number, independent of its outcome.
- Higher scores are better; a drop signals work that is not optimal.
- Duration does not excuse low efficiency.
- The shared banner helps the reviewer see what can improve.
- The benchmark uses the score to improve tools and prompts and checks completion separately.
- Telegram and other observability expose the score for remote monitoring.

## Related
- [Efficiency score requirements](../../tasksync-chat/docs/requirements/efficiency-score.md)
- [Harness benchmark spec](../../specs/008-harness-benchmark/spec.md)
