# Contract — Orchestrator dispatch packet and admission

A `build` or `verify` worker run started by the orchestrator carries a packet (worker `start` input `prompt` begins with this front matter):

```yaml
---
spec: 005-speckit-guided-flow      # track (D-10); omitted → _default
story: US1
task: T012
allowedPaths: ["tasksync-chat/src/specs/staleness.ts", "tasksync-chat/test-spec-staleness.cjs"]
base: 308d65b                      # commit the worker starts from
verify: "cd tasksync-chat && npm run test:workers"
expect: "0 failed"
---
```

## Admission (`workerRouter.ts`)

- `build` runs on the same track: at most 2 RUNNING. A third is queued (state `waiting: track-cap`) and started when one finishes.
- A `build` run whose `allowedPaths` overlap a RUNNING build run's `allowedPaths` on the same track is queued (`waiting: overlap <paths>`), never run in parallel.
- `start` always returns `{ runId }` immediately (no blocking; FR-023).
- Missing `allowedPaths` on a `build` run → refused with `allowedPaths required for build runs`.

## Acceptance (orchestrator)

A worker change is accepted only when all three hold, recorded in the run record:
1. **Scope check**: `git diff --name-only <base>..<head>` ⊆ `allowedPaths` (else rejected, listing out-of-scope paths).
2. **Integrated gate**: `verify` command run once on the integrated branch; output contains `expect`.
3. **Named evidence**: test name(s) and the pass line quoted.
