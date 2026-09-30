# Data Model — 005 Spec Kit Guided Flow

## Stage

Ordered list (Spec Kit names): `specify` → `clarify` → `plan` → `checklist` → `tasks` → `analyze` → `implement` → `converge`.

| Stage (last completed) | Next step shown | Stage button |
|---|---|---|
| specify | `/sk.check` (clarify) | Plan |
| clarify | `/sk.plan` | Plan |
| plan | `/sk.check` (checklist) | Tasks |
| checklist | `/sk.tasks` | Tasks |
| tasks | `/sk.check` (analyze) | Implement |
| analyze | `/sk.implement` | Implement |
| implement | `/sk.check` (converge) | Implement (while tasks open) |
| converge | done, or next story's `/sk.implement` | — |

`/sk.check` is always shown.

## Run Record — `.askaway/specs/<slug>/runs/<endedAt ISO, colons→dashes>-<6 hex>.json`

One file per run, written once, never edited. Schema: [contracts/run-record.schema.json](contracts/run-record.schema.json).

| Field | Type | Notes |
|---|---|---|
| `v` | 1 | schema version |
| `slug` | string | spec directory name |
| `kind` | `chat` \| `worker` \| `checkpoint` \| `converge` \| `import` | what produced it |
| `command` | string | e.g. `/sk.plan`, `worker:build` |
| `stageBefore` / `stageAfter` | Stage \| null | `stageAfter` null when the run did not move the stage |
| `branch` | string | checked-out branch at run end |
| `pr` | string | PR URL or `""` |
| `startedAt` / `endedAt` | ISO string | |
| `agentMs` | number | wall-clock |
| `cost` | `{ nanoAiu: number, requests: number }` | Copilot credits / OpenCode cost; never RTK |
| `tokens` | `{ input, output, reasoning, cacheRead, cacheWrite }` | optional |
| `story` | `USn` \| `""` | for checkpoint runs |
| `checkpoint` | `{ result: PASS\|FAIL\|BLOCKED, independentTest: string, scs: {id,result,evidence}[] }` | checkpoint runs only |
| `readiness` | ReadinessResult | converge runs only |
| `workerId` / `runId` | string | worker runs only |

## Spec Facts (derived, not stored)

`storedStage` (newest record with non-null `stageAfter`), `impliedStage`, `mismatch`, `stale[]`, `branch` (newest record), `activePr` (D-12), `costNanoAiu` (sum), `agentMs` (sum), `runs` (count), `skippedRecords`, `lastReadiness`, `stories[]` progress.

## User Story (parsed from tasks.md / spec.md)

`id` (`US1`), `title`, `priority` (`P1`), `independentTest` (from spec.md), `tasks[]` (tasks tagged `[USn]` or under the `Phase N: User Story N` heading), `done/total`, `scs[]` (SC IDs whose `Verified by:` includes the story), `checkpoint` (last checkpoint record).

## Task (scanner)

Existing fields + `tags: string[]` (every `[...]` marker after the ID, e.g. `P`, `US1`, `cloud`, `local:needs mesh`), `story: string`.

## Readiness Result

```json
{ "checks": [{ "name": "tests", "status": "PASS|FAIL|BLOCKED|N/A", "reason": "", "evidence": "" }],
  "openFindings": ["..."], "residualRisk": ["..."] }
```

A check without evidence cannot be `PASS` (writer downgrades it to `BLOCKED` with reason "no evidence").

## Staleness Entry

`{ artifact, upstream, reason: "upstream-newer" | "upstream-dirty", upstreamRank, artifactRank }`.
