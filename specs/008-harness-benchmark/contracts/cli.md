# Contract: benchmark CLI

Entry point: the existing runner, `node tasksync-chat/evals/run-evals.cjs --suite benchmark ...`.

| Invocation | Behaviour |
|---|---|
| `--suite benchmark` | Dry listing: benchmark version, levels, task count, configurations that would run. Zero provider requests. |
| `--suite benchmark --config <file\|name> [--config ...] [--level l] [--repeat n] --live` | Runs each configuration on a fresh copy of the fixture, grades with hidden checks, appends one row per run. Stops a run at $2. |
| `--suite benchmark --scoreboard [--version v]` | Prints one row per run: configuration, model mix, completion k/n, Score (or `incomplete k/n` / `–`), $, requests, input, output, cache hit, main context; marks non-comparable rows. Zero provider requests. |

Exit code: 0 when the command ran (failed tasks are results, not errors); non-zero only for invalid input or a broken fixture.

Output lines (stable, used by tests):
- `BENCHMARK <version> config=<configId> status=<status> accepted=<k>/<n> cost=$<d|unavailable> score=<s>`
- `BENCHMARK done runs=<r> cost=$<total> results=<path>`
