# Rules — 008 Harness Benchmark

Reviewer requirements captured for this draft (2026-10-07). Change a rule only when the reviewer changes it; recommendations are not decisions.

- Reuse the evals harness `tasksync-chat/evals/run-evals.cjs` and the fixture/grading resources in `tasksync-chat/evals/`; do not create a competing eval system.
- Benchmark scope: one fixed simulated workspace with specs, seeded bugs and a hidden grader, and one fixed task set. The requested complex fixture must be confirmed before planning: the checked-in fixture currently contains a small math workspace and hidden checks.
- Run each selected agent prompt × harness × model mix against the same starting state and acceptance rules; isolate task runs and preserve repeat results.
- Hidden grading decides acceptance, not an agent's report; hidden checks and expected answers stay unavailable to agents.
- Scoreboard: pass rate, total $, requests, tokens and the harness-efficiency number, identified by benchmark and configuration.
- Account for the entire model combination, including all agents, retries and failed work; distinguish model requests from tool calls and expose missing accounting data.
- Efficiency formula is OPEN in spec.md: (a) prompt tokens processed per output token (context amplification, price-independent), (b) $ per accepted task on the benchmark, or (c) both, with (a) live in the banner and (b) on the scoreboard. Recommend (c); do not treat it as approved.
- Undefined ratios, incomplete runs and incompatible benchmark versions must be visible, never presented as cheap successful work.
- Specify stage only: Draft spec, Goal and Rules; no implementation plan, live paid runs or benchmark implementation in this packet.
