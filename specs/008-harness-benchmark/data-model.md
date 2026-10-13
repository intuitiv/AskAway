# Data Model: Harness Benchmark

## Benchmark (`tasksync-chat/evals/benchmark/benchmark.json`)
- `id`: `"harness-benchmark"`; `version`: sha256 of fixture + tasks + hidden (D7)
- `levels`: `simple | medium | complex | batch`, each with task ids
- `pricingBasis`: label of the price source used for cost (e.g. `"opencode step_finish cost"`)
- `spendCapUsd`: `2`

## Task (`tasks.json`)
- `id`, `level`, `prompt` (refers only to visible fixture files), `hiddenCheck` (file name in `hidden/`, never sent to the agent)

## Configuration
- `mainAgent`: `build | orchestrator`; `promptHash`
- `harness`: e.g. `opencode`
- `modelMix`: `{ main: modelId, workers: { profile: modelId } }`
- `configId`: sha256 of the above

## Run (result row; see [contracts/result-row.md](contracts/result-row.md))
- `runId`, `benchmarkVersion`, `configId`, `configuration`, `startedAt`, `status`: `completed | interrupted | skipped`
- `tasks[]`: `{ id, level, outcome: accepted | failed | skipped | interrupted, failedChecks[] }`
- `usage`: `{ requests, toolCalls, input, output, reasoning, cacheRead, cacheWrite, dollars | null, mainAveragePrompt, workers: { workers, requests, dollars } }`
- `stopReason`: e.g. `"spend cap $2"`, `"model unavailable"`

## Scoreboard row (derived, not stored)
- `completion`: `accepted / fixed task count`
- `banner`: banner `b` shape (research D5) fed to `efficiencyScore` and `usageBannerHtml`
- `score`: number, or `"incomplete k/n"`, or `"–"` when cost or input is unavailable
- `comparable`: false when `benchmarkVersion` or `pricingBasis` differs from the group

State: Run `started → completed | interrupted | skipped`; never edited after it is written; repeats add rows.
