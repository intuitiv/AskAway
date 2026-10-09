# Feature Specification: Harness Benchmark

**Feature Branch**: `008-harness-benchmark`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "is there any standard simulated workspace, with specs and all, and create some task and run with all agents, and different prompts and see how we can solve the problem with less cost?"; "I want some number to show how efficiently the harness ran."; "For single model, it is model price, but in harness we use combination right". Binding inputs: [Goal.md](Goal.md) and [Rules.md](Rules.md).

## Clarifications

- **Score revision 2026-10-10 (proposed, pending reviewer veto)**: Score = round(100 × CacheHit × ContextFactor × PriceFactor), 0–100. CacheHit = cached / total input (main + workers); ContextFactor = 64000 / max(64000, average prompt tokens across ALL main-agent requests, excluding child rows); PriceFactor = min(1, 0.30 / (turn dollars / ((total input + output) / 1e6))). The $0.30 reference is calibrated from observed well-cached main turns (~$0.31/1M), to be revised by benchmark data. The old cumulative-cost/request formula fell as turns grew at unchanged efficiency. Missing/zero input or cost shows '–'; timer and Score lead the existing shared summary. Guard: test-efficiency-score.cjs EV-EFFICIENCY-SCORE.

### Reviewer decision 2026-10-07

- Reviewer: "We want to reuse efficeicy score. In benchmark we know workc opleteion and effieniyc score we should use it."
- The scoreboard reuses the SAME Efficiency score as the shared banner: the same formula and the same render component, per AGENTS.md consistent experience. Show it together with work completion (accepted tasks / fixed task count); $ and tokens remain raw columns. This replaces the agent-defined $ per accepted task score and 80% quality bar.
- More benchmark input from the reviewer is pending.

### Reviewer input 2026-10-07 (2) — supersedes the block above

- Reviewer: "benchamrk is, comeup with number of effective utilisation of agentic framework. and comeup with some formula, it should have total cost, cache %, cache misses, total input tokens, total output tokens, requests and more importantly context length of main agent."
- Reviewer: "run the benchmark, this is where we know exactly what does it mean by task is complete. So, we optimise orchetsration, tools, workers models and so on to increase the efficiency score at the end of benchmark task completion. This is where we do agentic loop. ... we can have different level of tasks, complex, simple, medium and 1 task and 20 tasks in one message and so on."
- Reviewer: "for efficiency, we should consider number of requests compete also. More requests will have more context and more cost. I want score live for every change in shared banner. So i see score going up and down."
- Score = 1000 × CacheHit × ContextFactor × RequestFactor ÷ Cost($). CacheHit = cached input ÷ total input (main + workers); ContextFactor = 64K ÷ max(64K, average main-agent prompt tokens per main request); RequestFactor = 10 ÷ max(10, total requests, main + workers). Cost is turn dollars (main + workers). Benchmark scoring still gates on every hidden check passing (otherwise "incomplete k/n", no score); the live banner shows it ungated on every metrics update, with '–' when cost or input is zero. Cost, cache hit, cache misses, input, output, requests and main context use the banner's turn-totals source and appear in its tooltip.
- Levels proposed: simple (1 small task), medium (multi-file change), complex (spec-bearing feature with tests), batch (20 small tasks in one message).

### Reviewer input 2026-10-07 (3) — what the benchmark is, and score principles

- Reviewer: "The benchmakr is more like integration level eval with all main agents and sub agents and so on. Its some offline command whcih runs with all the setup. We can run against different models, different main agent (Orchestrator or Build). We observe the pattern and tune our agent prompts accordingly."
- Reviewer score principles: "if main agent has more context or wokers are not being used efficiently, score shoudl be less; if there are many cache misses, score should be less; if cost to token ratio is score is less, as cost is more for less tokens."
- Reviewer sequencing: "finsih 005, 006 and 007 before starting this." The formula is revised against these principles when 008 starts; until then the live banner keeps the current Score.

## User Scenarios & Testing *(mandatory)*

Each story is an independently testable slice, delivered in priority order. Comparisons use one fixed simulated workspace and task set, not different problems for different agents.

### User Story 1 - Run the same benchmark across configurations (Priority: P1)

The reviewer selects agent prompt × harness × model mix combinations and runs the fixed task set against a fresh copy of the same simulated workspace, including specs and seeded bugs. A hidden grader judges task acceptance independently of the agent's claims.

**Why this priority**: Comparable accepted work is the foundation for any efficiency claim.

**Independent Test**: Run two configurations on the same benchmark; confirm identical starting workspace and tasks, separate results, and rejection of a fix that passes visible checks but fails hidden checks.

**Acceptance Scenarios**:

1. **Given** two selected configurations, **When** the benchmark runs, **Then** each receives the same starting workspace, task set and acceptance rules, with no edits carried between runs.
2. **Given** an agent reports success but a hidden check fails, **When** graded, **Then** the task is not accepted and the failure appears in its result.
3. **Given** a completed configuration, **When** the reviewer repeats it, **Then** the same benchmark and configuration identities are recorded without overwriting the earlier result.

---

### User Story 2 - Compare quality and whole-harness spend (Priority: P2)

The reviewer reads a scoreboard per configuration showing pass rate, total $, requests, tokens and a harness-efficiency number. Spend includes every participating agent and model, including unsuccessful work, so a cheap single model cannot hide an expensive combination.

**Why this priority**: The reviewer needs evidence of lower cost without mistaking lower quality for efficiency.

**Independent Test**: Compare a single-model run with a mixed-model run containing a failed task; confirm scoreboard totals match all recorded usage and pass rates match grader outcomes.

**Acceptance Scenarios**:

1. **Given** a mixed-model run, **When** its row is displayed, **Then** the model mix is identified and $, requests and tokens include all participating agents and models.
2. **Given** accepted and failed tasks, **When** results are summarised, **Then** pass rate shows accepted tasks over the fixed task count and spend includes failed attempts.
3. **Given** shared-banner Efficiency and benchmark task outcomes, **When** results are displayed, **Then** the scoreboard uses the same Efficiency formula and render component as the shared banner alongside work completion (accepted tasks / fixed task count); $ and tokens remain raw columns.

---

### Edge Cases

- No accepted tasks or no output tokens: retain raw totals and show the affected ratio as undefined, never as zero efficiency cost.
- Interrupted, skipped or unavailable-model runs: show their status and observed spend; do not count missing tasks as accepted or present incomplete rows as comparable completed runs.
- Missing usage or price data: mark affected totals and efficiency as unavailable, not free.
- Changed workspace, tasks, grading rules or pricing basis: identify the change rather than silently compare unlike runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST use one fixed, versioned simulated workspace containing specs and seeded bugs, with a fixed task set and hidden acceptance grader.
- **FR-002**: System MUST evaluate every selected agent prompt × harness × model mix combination against the same benchmark, restoring its starting state for each task run.
- **FR-003**: System MUST identify the benchmark, task set, prompt, harness and model mix for each run and retain repeated runs separately.
- **FR-004**: Task acceptance MUST come from the hidden grader, not the agent's success claim; agents MUST NOT receive hidden checks or expected answers.
- **FR-005**: System MUST record task outcomes and run completion status, distinguishing accepted, failed, skipped and interrupted work.
- **FR-006**: The scoreboard MUST show work completion (accepted tasks / fixed task count) together with the SAME Efficiency score as the shared banner, using the same formula and render component, for each configuration. Total $, model requests and token usage MUST remain raw columns; unavailable data MUST be explicit.
- **FR-007**: Usage totals MUST include every participating agent and model, retries and failed work; token usage MUST distinguish input, output, reasoning and cache usage, and model requests MUST be distinct from tool calls.
- **FR-008**: Cost MUST identify its pricing basis and aggregate the actual model mix; missing cost data MUST NOT be reported as zero.
- **FR-009**: Harness Efficiency MUST reuse the shared banner's formula and render component, per AGENTS.md consistent experience (reviewer 2026-10-07), with a visible formula and units. It MUST be shown alongside work completion, not replaced by $ per accepted task or an agent-defined 80% ranking bar. More benchmark input from the reviewer is pending.
- **FR-010**: Results MUST make incomplete runs, incompatible benchmark versions and undefined ratios explicit so they cannot masquerade as efficiency improvements.

### Key Entities

- **Benchmark**: fixed workspace, specs, seeded bugs, task set, hidden acceptance rules and version.
- **Configuration**: a particular agent prompt, harness and model mix, with identities sufficient to repeat the comparison.
- **Run**: a configuration's benchmark attempt, task outcomes, status and whole-harness usage.
- **Scoreboard row**: a run's pass rate, $, requests, tokens and labelled efficiency measure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of selected configurations receive the identical benchmark starting state, task set and acceptance rules in a comparison.
- **SC-002**: 100% of tasks claiming success while failing a hidden check are recorded as not accepted.
- **SC-003**: Every completed scoreboard row contains work completion (accepted tasks / fixed task count), $, requests, tokens and the SAME Efficiency score as the shared banner, rendered by the same component with the same formula; missing data is explicitly labelled in 100% of affected rows.
- **SC-004**: For a recorded mixed-model comparison, scoreboard usage and spend reconcile with all participating agents' records within displayed rounding, including failed work.
- **SC-005**: The reviewer can compare at least two configurations on the same benchmark and identify whether lower spend preserves or reduces pass rate, without consulting agent transcripts.

## Assumptions

- The existing evals capability is reused, not replaced by a second evaluation system; the benchmark is simulated and does not modify real workspaces.
- The requested complex workspace must be confirmed before planning: the currently checked-in eval fixture is a small seeded-bug workspace with hidden checks, not yet a complex workspace with specs.
- Prompt, harness and model-mix choices are fixed for a comparison; expanding the task corpus, automated prompt optimisation and claiming a universal best harness are out of scope.
- Efficiency reuses the shared banner's formula and render component (reviewer 2026-10-07); more benchmark input from the reviewer is pending. This draft does not impose a target improvement or select a winning configuration.
