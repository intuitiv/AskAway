# Research: Harness Benchmark

| ID | Decision | Rationale | Alternatives rejected |
|---|---|---|---|
| D1 | Hidden checks in `tasksync-chat/evals/benchmark/hidden/`, run after the agent finishes from a separate temp dir against a read-only copy of the agent's result. | FR-004: agents never see hidden checks; mirrors the existing `math.js` hidden-check pattern in `run-evals.cjs`. | Checks inside the fixture with a "do not read" note: leaks answers. |
| D2 | Score from `efficiencyScore` in `media/webview.js`, loaded in a `vm` context by `scoreboard.cjs`. | One formula (FR-006/FR-009, constitution II); the webview tests already load functions this way. | Copy of the formula in `.cjs`: can drift; moving it to a shared module would touch `webview.js` structure for no user value now. |
| D3 | Usage = sum of `step_finish` tokens/cost from the main OpenCode session and every worker session started during the run, split into input, output, reasoning, cache read, cache write; requests = `step_finish` count; tool calls counted separately. | FR-007; same fields the Workers ledger already records. | Copilot debug logs: the main agent is not Copilot Chat here. |
| D4 | Spend cap checked after each `step_finish`; at ≥ $2 the run's process tree is killed and the row is `interrupted` with observed spend. | FR-011; reviewer "spending limit per benchmark run is 2$". | Pre-estimating cost: inaccurate; a hard stop is simple and safe. |
| D5 | Banner shape at the boundary: `{ dollars, cacheInput, lastCached, averagePrompt (main-agent requests only), turnOut, requests, cacheMisses, mainContext: true, workers: { workers, requests, dollars } }`. | The scoreboard reuses `usageBannerHtml(b)` unchanged (constitution II). | A new scoreboard widget: second look-alike. |
| D6 | Score gate: shown only when every task is accepted; otherwise "incomplete k/n" and no score. | Spec Clarifications 2026-10-07 (2) gate, kept 2026-10-10. | Ungated score: cheap failed runs would look efficient (FR-010). |
| D7 | Fixture version = sha256 of `fixture/`, `tasks.json` and `hidden/`; stored in every row. | FR-010: unlike runs are flagged, not compared. | Manual version number: easy to forget. |
| D8 | Batch level is one message containing 20 small tasks, graded per task (accepted k/20). | FR-012 "20 tasks in one message". | 20 separate runs: tests a different thing. |
