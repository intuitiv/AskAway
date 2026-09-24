# Data Model: Async Sub-agent Runner

## WorkspaceServer

| Field | Type | Rules |
|---|---|---|
| `canonicalWorkspacePath` | string | `realpath(workspaceFolder)`; unique server and reuse key |
| `serverId` | string | Stable registry identity for the active server |
| `serverEndpoint` | string | One active endpoint per workspace |
| `health` | enum | `STARTING`, `HEALTHY`, `UNHEALTHY`, `STOPPED` |
| `startedAt` | timestamp | Set when the shared server starts |

Relationship: one shared server manages many workspace-bound `Worker` records. There is exactly one active server process for all workspaces, and each worker carries the canonical workspace path used to filter the Workers view.

## Worker

| Field | Type | Rules |
|---|---|---|
| `workerId` | string | AskAway stable identity |
| `profileId` | string | Must resolve to an approved portable profile |
| `openCodeSessionId` | string | Stable OpenCode session identifier; unique within workspace |
| `state` | enum | `STARTING`, `RUNNING`, `WAITING_APPROVAL`, `COMPLETED`, `FAILED`, `CANCELLED`, `RETIRED`, `ORPHANED` |
| `contextTokens` | number | Retire when greater than 300000 |
| `cacheFreshness` | enum | `FRESH`, `EXPIRED`, `UNKNOWN`; expired retires worker |
| `retirementReason` | string? | Required for `RETIRED` |
| `sourceRevision` | string | Captured at dispatch/checkpoint |
| `lastUpdateAt` | timestamp | Updated from OpenCode lifecycle events |
| `serialQueue` | `WorkerRun[]` | One-at-a-time execution; estimated wait controls reuse |
| `archiveRef` | string? | Set only after inactive, empty-queue prune |
| `adapterType` | string | Runtime-neutral adapter discriminator; currently `opencode` |

State transitions: `STARTING -> RUNNING`; `RUNNING -> WAITING_APPROVAL|COMPLETED|FAILED|CANCELLED|RETIRED`; `WAITING_APPROVAL -> RUNNING|CANCELLED|FAILED`; reload probes the server and transitions to `RUNNING` when live, otherwise `ORPHANED`. Cache expiry or context >300000 transitions eligible workers to `RETIRED`. Prune is legal only for inactive workers with an empty `serialQueue`; it archives records and never cancels/deletes active work.

## WorkerProfile

| Field | Type | Rules |
|---|---|---|
| `profileId` | string | Primary profile must be directly launchable or declare parent delegation |
| `role` | enum | Explorer, coder, reviewer, RCA, profiler, Prometheus, test analyst, test planner |
| `adapterPlatform` | string | Required adapter/platform suitable for this task type; currently `opencode` |
| `modelOptions` | `{ providerId, modelId }[]` | Non-empty allowed set for this mode; proven option is `github-copilot` / `github-copilot/gpt-5.6-luna` |
| `thinkingOptions` | `{ kind: budget\|tier, value }[]` | Non-empty allowed thinking budgets/tiers suitable for this task type |
| `toolPolicyId` | string | Resolves at MCP/broker boundary |
| `allowedFiles` | string[] | Enforced by tool policy |
| `stopCondition` | string | Required bounded completion condition |
| `evidenceContract` | string | Requires facts, hypotheses, unresolved decisions, validation evidence |
| `mode` | string | User-selected routing label; multiple workers may share it |

## OrchestratorProfile

| Field | Type | Rules |
|---|---|---|
| `profileId` | string | Stable non-coding orchestrator profile identity |
| `allowedCapabilities` | string[] | Planning/specification, eight worker controls, skill/memory, internet, SharePoint, architecture MCP, and evidence/status verification |
| `deniedCapabilities` | string[] | Implementation-code read/search/navigation, edit/patch/create/delete/rename, build, test execution, and arbitrary terminal execution |
| `durableCapturePolicy` | enum map | `SKILL`, `MEMORY`, `ADR_USER_APPROVED`, or `OPERATIONAL_PRODUCT_DOC`; implementation detail is not an ADR source |
| `verificationAuthority` | enum | `INDEPENDENT`; worker completion claims do not satisfy acceptance without mapped evidence |

## TaskGraph and TaskNode

A `TaskGraph` has `graphId`, `orchestratorTurnId`, a finite set of nodes, dependency edges, and graph-level elapsed/run/cost limits. It must be acyclic and bounded; a node becomes dispatchable only when all dependencies have accepted evidence.

Each `TaskNode` records `nodeId`, mode/profile, selected adapter/provider/model/thinking budget, objective, self-contained context sources/content, constraints, acceptance criteria, evidence contract, stop policy, allowed file scope, and state. Node states are `BLOCKED`, `READY`, `DISPATCHED`, `EVIDENCE_INSUFFICIENT`, `VERIFYING`, `ACCEPTED`, `FAILED`, or `STOPPED_BUDGET`. `EVIDENCE_INSUFFICIENT` may add bounded research/data-collection nodes; their synthesized findings become explicit context for downstream nodes. Cycles, unbounded additions, or dispatch without a complete packet are invalid.

## CloudWorkerPacket

| Field group | Required content |
|---|---|
| Identity | Packet version, canonical workspace, immutable base revision, orchestrator turn, graph/node/task, worker/run/session IDs |
| Routing | Worker mode/profile, adapter, provider/model, thinking budget/tier, resolved worker tool policy |
| Work | Self-contained context sources/content, objective, constraints, allowed files, acceptance criteria, evidence assertions/commands |
| Bounds | Stop condition, maximum elapsed time, maximum runs, maximum provider cost; live-test budget when applicable |
| Observability | Dispatching turn equal to orchestrator turn, provider `step_finish` usage source, attribution fields |

Validation rejects missing fields, placeholders, unresolved decisions, credentials, selections outside profile options, references that are neither embedded nor immutable/worker-accessible, and live-test nodes without a complete live budget.

## WorkerRun and Event

Each submission produces a new `WorkerRun` with `runId`, `dispatchingMainAgentTurnId`, explicit immutable `baseRevision`, `effectiveAdapterPlatform`, `effectiveProviderId`, `effectiveModelId`, `effectiveThinkingKind`, and `effectiveThinkingValue`, plus bounded task/acceptance/evidence/stop contracts, queue timestamps, per-run `startedAt`/`finishedAt`/elapsed time/cost, and terminal result. The effective selection must belong to the resolved profile's allowed options. An unavailable or ineligible configured selection produces an explicit terminal result and never substitutes another primary agent or model. Historical and cached input context belongs to the reusable `Worker` and remains visible; elapsed time and cost belong to the `WorkerRun` and reset for every new `runId`. A model or thinking selection change is a cache boundary and cannot reuse the prior selection's cache continuity. Events include `start`, `message_update`, `before_tool`, `after_tool`, `checkpoint`, `stop`, and `error`. A terminal `step_finish` event stores the provider-returned input, output, reasoning, cache read/write, and cost fields without replacing them with estimates, attributed by canonical workspace path, worker, run, adapter session, dispatching main-agent turn, and effective adapter/model/thinking selection for reproducibility, observability, and trace display.

Messages and steering payloads are intentionally absent: Spec 003 owns `worker_ask`, `worker_respond`, and central main-agent/worker/human routing. Spec 001 exposes only extensible lifecycle facts/interfaces. Transcript compaction and indefinite retention are not modeled.