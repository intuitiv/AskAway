---
description: "Tasks for 008 Harness Benchmark"
---

# Tasks: Harness Benchmark

**Input**: Design documents from `/specs/008-harness-benchmark/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Every task ships or extends a caller-view test (constitution I). Offline tests use a fake OpenCode spawner and make zero provider requests.

## Format: `[ID] [P?] [cloud|local: reason] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[cloud]**: eligible for the GitHub cloud agent (self-contained, ≤ ~45 min, no open question, no local service); `[local: reason]` otherwise
- Paths are under `tasksync-chat/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Benchmark manifest and the dry CLI entry

- [x] T001 [cloud] Create `evals/benchmark/benchmark.json` (id, levels, task ids, pricing basis, `spendCapUsd: 2`) and add `--suite benchmark` dry listing to `evals/run-evals.cjs` (version, 4 levels, 23 tasks, zero provider requests). Test: new `test-benchmark-runner.cjs` runs the CLI without `--live` and asserts the listing line and that no spawner is called. Done: also `totalSpendCapUsd: 5` (plan Q2); guarded by `test-benchmark-runner.cjs` EV-BENCHMARK-RUNNER (dry listing, stub `opencode` never called).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The fixed workspace, task set, hidden checks and usage accounting every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] [cloud] Build the spec-bearing fixture in `evals/benchmark/fixture/` (`specs/001-*/spec.md` + `tasks.md`, small `src/` app, visible `test/`, seeded bugs per level). Test: new `test-benchmark-fixture.cjs` copies the fixture to a temp dir, runs its visible tests and asserts the seeded failures are present. Done: `test-benchmark-fixture.cjs` EV-BENCHMARK-FIXTURE (copies under `build/`, 23 seeded failures).
- [x] T003 [P] [cloud] Add hidden checks `evals/benchmark/hidden/<task>.cjs` with reference solutions under `evals/benchmark/hidden/solutions/`, and `gradeBenchmark` in `evals/graders.cjs`. Test (`test-benchmark-fixture.cjs`): reference solutions are accepted; a "visible tests only" hack passes visible tests but is not accepted. Done: EV-BENCHMARK-FIXTURE (23/23 solutions accepted; hack rejected naming `percent(1,3) is 33`).
- [x] T004 [cloud] Write `evals/benchmark/tasks.json`: simple (1), medium (1 multi-file), complex (1 spec-bearing feature with tests), batch (20 small tasks in one message). Test (`test-benchmark-fixture.cjs`): every prompt names only visible fixture paths; no prompt contains a hidden path or expected answer (FR-004, FR-012). Done: EV-BENCHMARK-FIXTURE.
- [x] T005 [P] [cloud] Implement `evals/benchmark/usage.cjs`: sum `step_finish` input/output/reasoning/cache read/write/cost across the main session and every worker session; count requests and tool calls separately; any missing cost → `dollars: null`. Test: `test-benchmark-runner.cjs` feeds recorded event fixtures (main + 2 workers + a failed retry) and asserts totals, request/tool-call split and `null` on missing cost (FR-007, FR-008). Done: EV-BENCHMARK-RUNNER with `evals/benchmark/events/main-2-workers-retry.jsonl`.

**Checkpoint**: Fixture, hidden grader, task set and usage totals ready - user stories can begin

---

## Phase 3: User Story 1 - Run the same benchmark across configurations (Priority: P1) 🎯 MVP

**Goal**: Each selected configuration runs headless on an identical fresh workspace; hidden checks decide acceptance; repeats are kept.

**Independent Test**: Run two configurations on the same benchmark; confirm identical starting workspace and tasks, separate results, and rejection of a fix that passes visible checks but fails hidden checks.

- [x] T006 [US1] Implement isolation in `evals/benchmark/runner.cjs`: per run, copy `fixture/` to a temp dir, `git init`, no `hidden/` present, nothing carried between runs. Test (`test-benchmark-runner.cjs`): two configurations receive byte-identical start trees; an edit in run 1 is absent in run 2; the agent dir never contains `hidden/`. Done: EV-BENCHMARK-RUNNER.
- [x] T007 [US1] Configuration identity and headless main agent in `evals/benchmark/runner.cjs`: `mainAgent` Build/Orchestrator, prompt hash, harness, model mix, `configId`; spawn `opencode run --agent <main>` attached to the shared server with the level prompt. Test: fake spawner receives the agent, model and prompt; row carries `configId` and identities (FR-003, FR-013). Done: EV-BENCHMARK-RUNNER (`--attach` passed when given; live install of an `aa-orchestrator` OpenCode agent is left to T011).
- [x] T008 [US1] Grade after the run in `evals/benchmark/runner.cjs` using `gradeBenchmark` from a separate dir; outcomes accepted/failed/skipped/interrupted; agent success text ignored. Test: fake agent claims "Result: PASS" with a visible-only fix → task `failed` with the hidden check named (FR-004, FR-005, SC-002). Done: EV-BENCHMARK-RUNNER.
- [x] T009 [US1] Spend cap and unavailable models in `evals/benchmark/runner.cjs`: after each `step_finish`, stop at ≥ $2 and record `interrupted` with observed spend; unavailable model → `skipped` with reason. Test: fake events crossing $2 kill the run tree and the row keeps the spend; missing tasks are not accepted (FR-011, edge cases). Done: EV-BENCHMARK-RUNNER; also the $5 per-invocation cap (plan Q2): the run that reaches it is `interrupted` ("total spend cap $5"), later ones `skipped`; callers cannot raise either cap.
- [x] T010 [local: open question Q5] [US1] Append rows per `contracts/result-row.md` to the store chosen in plan Q5 from `evals/benchmark/runner.cjs`; repeats add rows. Test: running one configuration twice yields two rows with distinct `runId` and the same `configId` and `benchmarkVersion`; rows contain no prompt or transcript text. Done: Q5 (a) `~/.askaway/evals/results.jsonl` with `suite: "benchmark"` for `--live`; EV-BENCHMARK-RUNNER writes to a `build/` fixture store and asserts the real store is untouched.
- [ ] T011 [local: local service] [US1] Live smoke run: one configuration, simple level, under $2, with real OpenCode; record the `BENCHMARK` line in `specs/008-harness-benchmark/quickstart.md`. Not part of `test:workers`.

**Checkpoint**: US1 works on its own: two configurations, same start state, hidden grading, separate rows

---

## Phase 4: User Story 2 - Compare quality and whole-harness spend (Priority: P2)

**Goal**: A scoreboard per configuration: work completion next to the SAME Efficiency score and component as the banner, with raw $ and tokens.

**Independent Test**: Compare a single-model run with a mixed-model run containing a failed task; confirm scoreboard totals match all recorded usage and pass rates match grader outcomes.

- [x] T012 [P] [cloud] [US2] Implement `evals/benchmark/scoreboard.cjs`: convert a row to the banner `b` shape (research D5) and completion k/n; Score from `efficiencyScore` loaded from `media/webview.js` in `vm`; show the score only when all tasks are accepted, else `incomplete k/n`; `–` when cost/input unavailable. Test: new `test-benchmark-scoreboard.cjs` asserts the score equals the banner's `efficiencyScore(b).value` for the same input, totals reconcile with usage including failed work, and gating/unavailable labels (FR-006, FR-009, SC-003, SC-004). Done: `test-benchmark-scoreboard.cjs` EV-BENCHMARK-SCOREBOARD; the row→`b` conversion and gate live beside `usageBannerHtml` in `media/webview.js` (`benchmarkBanner`, `benchmarkScoreLabel`) and `scoreboard.cjs` loads them in `vm`, so CLI, runner line and Workers tab share one conversion.
- [x] T013 [US2] Add `--scoreboard` to `evals/run-evals.cjs` per `contracts/cli.md`: one line per run with model mix, completion, Score, $, requests, input, output, cache hit, main context; rows with a different `benchmarkVersion` or pricing basis marked not comparable. Test (`test-benchmark-scoreboard.cjs`): single-model vs mixed-model rows from fixtures print the expected lines; an older version row is flagged (FR-010, SC-005). Done: EV-BENCHMARK-SCOREBOARD (`--results <file>` selects the store for tests).
- [x] T014 [local: open question Q1] [US2] Show the scoreboard in the extension surface chosen in plan Q1 (recommended: Benchmark section in the Workers tab): `src/webview/webviewProvider.ts` sends the rows (keep CRLF), `media/webview.js` renders each with `usageBannerHtml(b)` plus completion. Test (`test-benchmark-scoreboard.cjs`): the rendered row contains the exact `usageBannerHtml(b)` output (constitution II); `node --check media/webview.js` passes. Done: EV-BENCHMARK-SCOREBOARD (Q1 (b); incomplete rows void the banner's ungated Score via CSS, leaving the shared output byte-identical); R-WORKERS-25.

**Checkpoint**: US1 and US2 both work independently

---

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T015 [P] [cloud] Register `test-benchmark-fixture.cjs`, `test-benchmark-runner.cjs`, `test-benchmark-scoreboard.cjs` in `package.json` `test:workers` (one-line edit) and keep the suite green. Done.
- [x] T016 [P] [cloud] Guard R-SCORE-05 and R-SCORE-07 in `docs/requirements/efficiency-score.md` with the new test ids; update `docs/goals-coverage.md` G13 rows (repo root). Test: `test-requirements-docs.cjs` and `test-goals-docs.cjs` pass. Done: R-SCORE-05 → EV-BENCHMARK-SCOREBOARD, R-SCORE-07 → EV-BENCHMARK-RUNNER/FIXTURE; both docs tests pass. Open: `docs/goals-coverage.md` G13 was outside this packet's file scope.
- [ ] T017 [local: local service] Run quickstart steps 1–4 with the first comparison from plan Q4; attach the scoreboard to the spec PR.
- [ ] T018 [local: open question Q6] Propose a revised `SCORE_REF_USD_PER_MTOK` in `media/webview.js` from the first run's data, for reviewer approval; update R-SCORE-08 wording only with his words. Test: `test-efficiency-score.cjs` updated to the approved value.

---

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002–T005; T002, T003, T005 in parallel; T004 after T002) → US1 (T006 → T007 → T008 → T009 → T010 → T011) → US2 (T012 can start after T005; T013 after T010 and T012; T014 after T013 and Q1) → Polish.
- US2 is independently testable from recorded row fixtures; it needs only Foundational, not a live US1 run.

## Parallel Example

```text
Foundational: T002 fixture  |  T003 hidden checks  |  T005 usage totals
After Foundational: US1 runner (T006–T010)  |  US2 scoreboard builder (T012)
```

## Implementation Strategy

1. MVP: Setup + Foundational + US1, checkpoint, merge the story PR.
2. US2: scoreboard CLI first (T012–T013); the UI section (T014) after the reviewer answers Q1.
3. No paid run outside T011/T017; each live run is capped at $2.
