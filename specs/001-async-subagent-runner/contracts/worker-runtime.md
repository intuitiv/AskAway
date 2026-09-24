# Worker Runtime Contract

## Orchestrator Profile Contract

The parent uses a non-coding orchestrator profile. Its allowlist contains planning/specification, the eight worker-control operations below, skill and memory, internet research, SharePoint, architecture MCPs, and read-only evidence/status verification. Its denylist contains implementation-code read, search, navigation, edit, patch, create, delete, rename, build, test execution, and arbitrary terminal execution. A deterministic policy test must prove representative implementation tools are denied and every retained capability class is allowed. Workers, not the orchestrator, perform detailed code investigation and implementation.

## Parent Operations

This is the complete Spec 001 control surface. No other operation, including `worker_ask` or `worker_respond`, is part of this feature.

| Operation | Input | Observable result |
|---|---|---|
| `worker_start` | `profileId`, allowed model/thinking selection, bounded request, workspace path | Returns `{ workerId, runId, openCodeSessionId, effectiveAdapter, effectiveModel, effectiveThinking, state: STARTING }` before terminal completion, or an explicit unavailable/ineligible result |
| `worker_submit` | selected eligible `workerId`, allowed model/thinking selection, request | Returns fresh `runId` handle with the effective selection or explicit `RETIRED`/unavailable/ineligible result |
| `worker_list` | workspace identity | Current workspace workers, server health, state, metrics, and session-open action |
| `worker_status` | `workerId` | Current state, last update, retirement/blocker reason, and metrics |
| `worker_wait` | `workerId` | Declared evidence or explicit terminal failure |
| `worker_cancel` | `workerId` | Cancellation requested and terminal event when received |
| `worker_resume` | `workerId` | Only allowed for supported non-retired recovery; otherwise explicit fresh-submission requirement |
| `worker_logs` | `workerId` | Lifecycle/observability facts, not a duplicate OpenCode transcript |

## Orchestrator Input Budget Contract

The parent's context must stay small and must not grow with the amount of delegated work. The orchestrator sends packets out and takes summaries back: it never pulls worker transcripts, tool output, file contents, or logs into its own context. `worker_status`, `worker_wait`, and `worker_logs` return bounded fact records, not conversation text. Each worker result returns as a bounded synthesis plus evidence references; the orchestrator re-reads the referenced artifact only when acceptance requires it. Decomposition therefore splits goals into the smallest independently acceptable units, so each packet is self-contained and no single result forces a large read-back.

## Execution Tier Contract

The parent and the workers run different models by design. The parent runs the strongest available reasoning model, while workers run cheaper execution models. Each mode declares its allowed provider/model and thinking options; the current defaults are a lightweight tier and a mid tier for workers, with the parent tier reserved for orchestration. An unavailable selection fails explicitly with no fallback.

## Bounded Status Wait Contract

Until the Spec 003 side channel exists, the parent polls. `worker_wait` accepts a bounded wait with a hard ceiling of 240 seconds total per call. When the ceiling is reached without a terminal state, it returns an explicit `STILL_RUNNING` result carrying the worker/run identity and last known state, so the parent can end its turn and check again later. Reaching the ceiling is a normal result, not an error or a failure.

## Queue Contract

Work may be queued against a worker before it is idle. Each worker has one serial queue; queued entries are visible with their position and are cancellable before they start. Queueing never reorders around an active run and never cancels running work.

## Server Contract

Runtime-facing lifecycle contracts are adapter-neutral. OpenCode is the only current adapter; future external agentic platforms may implement the same contracts. For OpenCode, `ensureSharedServer()` returns the single existing healthy server process or starts it. Exactly one OpenCode server serves every workspace on the machine, so opening more workspaces never adds server processes. Every launch and session-open action uses that one endpoint. Reload reconnects to it when it remains live. A second concurrent OpenCode server started by AskAway is a contract failure. Workers remain workspace-bound records on that shared server: each worker carries its canonical workspace path, and the Workers view is global but filters by the current workspace by default.

## Routing And Queue Contract

`worker_start` first resolves the globally defined, user-extensible mode/profile. Every mode/profile declares its adapter/platform, allowed provider/model options, and allowed thinking budget/tier options suitable for its task type. The user or orchestrator selects among those options. Dispatch must resolve the selection exactly: unavailable or ineligible selections return an explicit result, and fallback to another primary agent, adapter, model, or thinking option is a contract failure. AskAway filters workers by matching profile and effective-selection compatibility and canonical workspace path, then offers existing/new selection. A selected existing worker is reusable only if it is not `RETIRED`, its cache is fresh, its consumed context is <=300000, and estimated serial-queue wait is <=120 seconds. Otherwise AskAway creates an ad hoc workspace-bound worker. Multiple workers may use one mode. Each submission creates a separate `runId` and is serialized per worker. Changing model or thinking budget/tier is a cache boundary and does not preserve cache continuity from the prior selection.

Before dispatch, the orchestrator creates a finite acyclic task graph and selects a ready node. Each selected node records worker mode/profile, exact adapter/provider/model/thinking budget, and a self-contained packet with immutable context sources or embedded content, objective, constraints, acceptance criteria, evidence requirements, and stop/time/run/cost limits. Routing the same valid graph, availability set, and policy inputs must produce the same selected node and execution selection. Ties use a documented stable key; workers do not silently choose their own mode, model, thinking budget, scope, or acceptance criteria.

When required evidence is absent, the node enters `EVIDENCE_INSUFFICIENT`. The orchestrator may add only bounded research/data-collection nodes, dispatches them under the same packet rules, synthesizes their high-level findings into explicit downstream context, and re-evaluates readiness. A cycle, unbounded expansion, or unresolved evidence gap stops routing. Worker-reported completion is not acceptance: the orchestrator independently verifies mapped evidence before marking a node `ACCEPTED`.

Every submission requires the immutable base revision `2eaeba0d3f45e8ee191f6b802cc30bbda1df3941`, orchestrator turn ID, graph/node identity, bounded objective, self-contained context, constraints, allowed file scope, acceptance/evidence contract, and stop policy. Packet validation rejects missing fields, placeholders, unresolved decisions, credentials, inaccessible mutable references, and out-of-profile selections. A reused worker retains visible historical/cached input context, while elapsed time and cost reset for the fresh `runId`. Transcript compaction and indefinite worker retention are outside this contract.

## Lifecycle, Budget, And Telemetry Contract

The adapter converts runtime events to AskAway lifecycle records: `start`, `message_update`, `before_tool`, `after_tool`, `checkpoint`, `stop`, and `error`. OpenCode `step_finish` records real provider-returned input, output, reasoning, cache read, cache write, and cost fields. Live budget calculations consume those fields directly and must not substitute token estimates, price tables, fixture defaults, or RTK savings. Records are scoped to the canonical workspace and carry worker, run, adapter session, dispatching main-agent turn, and effective adapter/model/thinking selection. The existing expandable trace retains that effective selection with per-run time, cost, input, and output for reproducibility and observability; all worker usage belongs to the dispatching main-agent turn. On reuse, historical input remains displayed, but the new run's elapsed and cost counters begin at zero.

## Test Contract

Deterministic no-network tests cover graph bounds and acyclicity, stable routing, exact mode/adapter/model/thinking selection, orchestrator tool policy, packet completeness/rejection, research-loop transitions, independent acceptance, attribution, and reused-run counter reset. Fixed inputs must yield fixed outputs and require no credentials.

Live OpenCode E2E tests are separate and opt-in. Before dispatch they require an explicit enable flag, installed/reachable OpenCode runtime, authenticated provider, primary worker profile, and externally configured cheaper model that is allowed and available. Missing prerequisites produce an explicit skip before any provider request; a failure after dispatch is a test failure. Credentials remain in provider/runtime configuration and never enter source, fixtures, logs, or packets. Each live case permits one worker and one run, enforces configured wall-clock and provider-cost ceilings, cancels when either is reached, records `STOPPED_BUDGET`, and never falls back. Pass evidence includes a non-terminal handle, terminal real `step_finish`, calculation from its returned usage/cost fields, and attribution to the dispatching main-agent turn.

## UI Contract

AskAway Workers displays workspace server health, worker state, last update, retirement reason, and per-worker metrics. Its session action opens the matching OpenCode conversation attached to the same server. It must not render a competing full transcript or approval controls.

## Security and Boundary Contract

Tools are invoked through AskAway MCP/local broker policy. For the OpenCode adapter, `/tmp` read/write and explicitly safe commands are allow-all. Every other action requires OpenCode approval and produces an AskAway pending-approval notification. A record or packet must never include secrets, credentials, or approval decisions. The runtime adapter remains the approval authority. This feature exports extensible lifecycle facts/interfaces only. Spec 003 owns `worker_ask`, `worker_respond`, and central routing among the main agent, worker, and human; Spec 001 implements no messaging.

## Durable Capture Contract

After independent verification, the orchestrator may capture a repeatable procedure or domain pattern as a skill, a concise verified fact as memory, a durable decision as an ADR only when the user approved that decision, or operational/product behavior as documentation. It must not derive an ADR from implementation details or mark an unapproved decision durable.