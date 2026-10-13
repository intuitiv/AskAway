# Quickstart: Harness Benchmark

1. Offline checks (no provider requests): `rtk npm --prefix tasksync-chat run test:workers` includes `test-benchmark-fixture.cjs`, `test-benchmark-runner.cjs`, `test-benchmark-scoreboard.cjs`.
2. Dry listing: `rtk node tasksync-chat/evals/run-evals.cjs --suite benchmark` shows version, 4 levels, 23 tasks.
3. Live comparison (spends up to $2 per configuration run): `node tasksync-chat/evals/run-evals.cjs --suite benchmark --config orchestrator --config build --live`.
4. Scoreboard: `rtk node tasksync-chat/evals/run-evals.cjs --suite benchmark --scoreboard` — completion k/n next to the same Score as the banner; `incomplete k/n` when any hidden check fails.
5. Validate: an agent that edits only visible tests to pass is shown as not accepted; totals include worker spend and failed tasks.
