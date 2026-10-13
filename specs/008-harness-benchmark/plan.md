# Implementation Plan: Harness Benchmark

**Branch**: `008-harness-benchmark` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-harness-benchmark/spec.md`

## Summary

An offline, integration-level benchmark: a fixed, versioned, spec-bearing simulated workspace with four task levels (simple, medium, complex, batch of 20) and hidden checks. Each selected configuration (main agent prompt Build/Orchestrator × harness × model mix) runs headless in OpenCode against a fresh copy of the same workspace. A hidden grader decides acceptance. Whole-harness usage (main agent + workers, retries, failed work) is converted at the data boundary into the shared banner's input shape, so the scoreboard shows work completion next to the SAME Efficiency score function and render component as the live banner. Each run stops at $2. The benchmark extends the existing `tasksync-chat/evals/` runner and graders; no second eval system.

## Technical Context

**Language/Version**: Node.js CommonJS (`.cjs`) for the runner and graders, as in `tasksync-chat/evals/`; TypeScript only where the extension shows the scoreboard.

**Primary Dependencies**: OpenCode CLI/server (headless main agent and workers, `step_finish` usage events), existing `evals/graders.cjs` (`parseEvents`), `src/workers/turnBudget.ts` (`turnTotals`), `media/webview.js` (`efficiencyScore`, `usageBannerHtml`).

**Storage**: Append-only JSONL result rows (location: open question Q5); fixture and hidden checks checked into `tasksync-chat/evals/benchmark/`.

**Testing**: Caller-view `tasksync-chat/test-benchmark-*.cjs` with a fake OpenCode spawner (no provider requests), registered in `npm run test:workers`. One explicit live smoke run, under $2, outside the suite.

**Target Platform**: macOS developer machine (reviewer's), Node 20+.

**Project Type**: CLI suite inside the existing VS Code extension repo.

**Performance Goals**: A full four-level run fits under $2 per configuration (FR-011); the offline suite adds under 10 s to `test:workers`.

**Constraints**: Hidden checks and expected answers never enter the agent's workspace (FR-004). No secrets in results or transcripts (constitution V). Per-workspace observability (VI). Copilot Chat cannot be scripted, so the main agent is OpenCode (FR-013).

**Scale/Scope**: 1 benchmark version, 4 levels (23 tasks: 1 + 1 + 1 + 20), 2–4 configurations per comparison.

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I Caller-view tests | Pass | Every story ships `test-benchmark-*.cjs` driving the CLI/runner from outside with a fake spawner. |
| II Consistent experience | Pass | The scoreboard converts runs into the banner's `b` shape and reuses `efficiencyScore` and `usageBannerHtml`; tests assert the output contains the shared component's output. |
| III Worker runtime boundary | Pass | OpenCode owns the conversation; the benchmark only spawns `opencode run` and reads events. |
| IV Shared tools at MCP | Pass | No new tool; agents use their normal MCP surface. |
| V No secrets | Pass | Result rows hold ids, hashes and usage only; prompts are stored as hashes. |
| VI Per-workspace observability | Pass | Benchmark runs in temporary copies; rows name the benchmark version and configuration, never mix workspace logs. |
| VIII Portable profiles | Pass | Configurations reference existing profile and agent files by name and hash. |

Re-check after design: no violations, no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/008-harness-benchmark/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── result-row.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
tasksync-chat/
├── evals/
│   ├── run-evals.cjs            # add --suite benchmark (dry listing without --live)
│   ├── graders.cjs              # add gradeBenchmark (hidden checks → outcomes)
│   └── benchmark/
│       ├── benchmark.json       # id, version, levels, task ids, pricing basis, spend cap
│       ├── tasks.json           # level → prompts (visible fixture only)
│       ├── fixture/             # spec-bearing workspace: specs/, src/, test/ (visible), seeded bugs
│       ├── hidden/              # hidden checks per task; never copied before the agent finishes
│       ├── runner.cjs           # isolation, headless spawn, cap, outcomes, rows
│       ├── usage.cjs            # step_finish → whole-harness totals
│       └── scoreboard.cjs       # run → banner `b` shape + completion; score via shared function
├── src/webview/webviewProvider.ts   # scoreboard state message (US2, after Q1)
├── media/webview.js                 # scoreboard rows via usageBannerHtml (US2, after Q1)
└── test-benchmark-{fixture,runner,scoreboard}.cjs
```

**Structure Decision**: Everything lives beside the existing evals in `tasksync-chat/evals/`, run through `run-evals.cjs --suite benchmark`. The extension only reads result rows and renders them with the shared banner component.

## Design decisions

See [research.md](research.md). Key points:

- D1 Hidden checks live in `evals/benchmark/hidden/` and are run against the agent's finished copy from a separate directory; the agent's workspace never contains them.
- D2 One Score function: the runner loads `efficiencyScore` from `media/webview.js` in a `vm` context (as the webview tests already do), so the scoreboard and the banner cannot drift.
- D3 Usage includes every `step_finish` of the main session and every worker session in the run; a missing cost marks the total unavailable, never zero.
- D4 The $2 cap is checked after every `step_finish`; reaching it kills the run tree and records `interrupted` with observed spend.
- D5 Repeats are separate rows keyed by `runId`; comparisons only group rows with the same `benchmarkVersion` and pricing basis.

## Open questions

Each has a recommendation. None blocks Setup, Foundational or US1; Q1 blocks T014, Q6 blocks T018.

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | Where does the scoreboard show? | (a) CLI report only; (b) CLI + a Benchmark section in the Workers tab rendered with `usageBannerHtml`; (c) CLI + Specs tab card | (b): the reviewer already reads worker cost there, and it reuses the banner component |
| Q2 | Is $2 per configuration run (all 23 tasks) or per whole comparison? | (a) per configuration run; (b) per comparison | (a): matches "per benchmark run"; a comparison of two configurations can cost up to $4 |
| Q3 | The 20-task batch may not fit in $2 with the complex level. Keep all levels in one run? | (a) one run of all four levels; (b) one run per level, $2 each | (a) first, and let the cap mark it interrupted; switch to (b) if the first data shows the cap is always hit |
| Q4 | First comparison configurations? | e.g. Orchestrator vs Build, both Sol 6.1 with default worker profiles | Orchestrator vs Build on Sol 6.1, default workers; one repeat each |
| Q5 | Where are result rows stored? | (a) existing `~/.askaway/evals/results.jsonl` with `suite: "benchmark"`; (b) workspace `.askaway/benchmark/runs.jsonl` | (a): reuses the evals store, the benchmark is not workspace work |
| Q6 | When the first data arrives, who revises `SCORE_REF_USD_PER_MTOK` ($0.30/1M)? | (a) agent proposes a new value with the data, reviewer approves; (b) keep $0.30 | (a) |

## Complexity Tracking

None.
