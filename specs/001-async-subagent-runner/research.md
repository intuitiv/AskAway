# Research: Async Sub-agent Runner

## Resolved Technical Context

All plan-time questions are resolved. The system is a TypeScript VS Code extension plus a runtime-neutral worker adapter boundary; OpenCode is the only current adapter. Cloud packets use the plan's explicit immutable base revision rather than deriving one at dispatch, and server identity derives from `realpath(workspaceFolder)`.

## Runtime Ownership

**Decision**: Use native VS Code Copilot Chat as parent orchestrator and a runtime-neutral adapter contract, currently implemented only by named OpenCode sessions.

**Rationale**: The approved boundary preserves Copilot as the main experience while OpenCode supplies a complete live worker conversation and native approval surface. The native-LM Explorer spike creates VS Code host permission prompts and is not the target architecture.

**Alternatives considered**: AskAway-owned VS Code Language Model loop (rejected as target); separate process per worker (rejected because viewer and command would not share live state).

## Server and Viewer Attachment

**Decision**: Own exactly one reusable local OpenCode server shared by all workspaces; both worker commands and the viewer attach to it. Workers stay workspace-tagged records, and the global Workers view filters by the current workspace.

**Rationale**: This is required for live conversation updates and deterministic session opening, and it keeps process count constant as more workspaces are opened.

**Alternatives considered**: Server per worker (rejected: fragments sessions and breaks the required live-viewer contract); server per workspace (rejected by the reviewer: adds a process per open workspace for no functional gain); polling copied transcripts (rejected: duplicates UI and loses the native approval surface).

## Herdr Adapter Evaluation

Herdr (Apache 2.0) is an agent runtime that owns persistent terminal panes for coding agents, including OpenCode, and reports `working`, `blocked`, `done`, `idle`, or `unknown` per agent. Evaluated against this feature's contract before building further session-lifetime code.

| Capability | Support | Evidence | Source |
|---|---|---|---|
| `worker_start` | Supported | `herdr agent start <name> --kind opencode --pane <id>` returns only after the agent is detected and ready; requires an existing shell pane | https://herdr.dev/docs/agent-automation/ |
| `worker_submit` | Supported | `herdr agent prompt <name>` submits text plus Enter and can prompt an already-working agent; returns `agent_blocked` instead of sending input when blocked | https://herdr.dev/docs/agent-automation/ |
| `worker_list` | Unknown | Sidebar rolls state up across workspaces/tabs/panes, but no list command appears in the pages read; the CLI reference was not fetched, so this is unverified rather than absent | https://herdr.dev/docs/cli-reference/ |
| `worker_status` | Supported | `herdr agent get <target>` resolves the live agent; lifecycle states are `working`, `blocked`, `done`, `idle`, `unknown`, with `herdr agent explain` showing matched rule and evidence | https://herdr.dev/docs/agents/ |
| `worker_wait` | Supported | `herdr agent wait <name> --until idle --until done --until blocked --timeout <ms>`; returns immediately when the state already matches | https://herdr.dev/docs/agent-automation/ |
| `worker_cancel` | Partial | No first-class cancel; interruption is terminal input such as `herdr agent send-keys <name> ctrl+c`, so cancellation is not an observable lifecycle result | https://herdr.dev/docs/agent-automation/ |
| `worker_resume` | Supported | Native agent session restore is on by default and resumes OpenCode with `opencode --session <id>` from an integration-reported session reference | https://herdr.dev/docs/session-state/ |
| `worker_logs` | Partial | `herdr agent read --source recent-unwrapped --lines N` returns rendered terminal text, which is a copied transcript rather than the fact-only lifecycle records this contract requires | https://herdr.dev/docs/agent-automation/ |
| Session persistence across disconnect | Supported | Normal detach keeps the server running and pane processes never stop; reattach with `herdr` | https://herdr.dev/docs/session-state/ |
| Reload and restart recovery | Supported | Snapshot restore rebuilds workspaces/tabs/panes/cwd; `[session] resume_agents_on_restore` defaults to true; stale or missing references restore as plain shells | https://herdr.dev/docs/session-state/ |
| Blocked-state detection | Supported | Lifecycle hooks are authoritative when installed; otherwise strict screen manifests classify blocked, falling back to `idle` as `default_known_agent_idle_fallback` when no rule matches | https://herdr.dev/docs/agents/ |
| Per-run token, cost, and cache usage | Unsupported | Integrations report lifecycle state as semantic state only; no provider `step_finish` token, cache, or cost fields exist, so budget attribution cannot come from Herdr | https://herdr.dev/docs/agents/ |

Herdr solves process lifetime, restart recovery, and blocked detection, which are exactly the concerns behind T005, T006, T018, and part of T014. It does not supply usage or cost facts, and its logs are terminal text, so the ledger, packet validation, and dispatch-turn attribution in CY-004 remain ours regardless. Its state model is also pane-and-agent centric, with no workspace-scoped worker/run identity, so `runId`, cache freshness, and retirement stay in AskAway.

**Recommendation:** Defer adoption for this feature and keep the shared OpenCode server as the primary adapter, because Herdr cannot supply the `step_finish` usage/cost facts that CY-004 acceptance depends on; revisit it as an optional second adapter for persistence and blocked detection once the ledger is proven, and verify `worker_list` against the CLI reference before any adoption.

## Reuse Inventory

Deferring Herdr does not mean building from zero. The reusable pieces are already in this repo and in OpenCode itself, and they cover the parts Herdr could not.

| Need | Already exists | Where | Remaining work |
|---|---|---|---|
| Real provider token/cost facts | OpenCode plugin already POSTs `step.input`, `step.output`, `step.cost`, retained as `pluginStats` | `tasksync-opencode/src/server.ts` `apiPluginStats` | Key the existing records by worker/run/workspace and attribute to the dispatching turn |
| Session identity and history | `SessionManager` creates sessions, stores history, aggregates token usage, exposes `/api/tokens` | `tasksync-opencode/src/sessionManager.ts` | Add workspace tag and `runId`; do not write a new session store |
| Shared server and endpoint | `ensureGlobalServer` returns one server for all workspaces | `tasksync-opencode/src/server.ts` | None for T004 |
| Live client updates | Relay registry plus `broadcastToUI` | `tasksync-opencode/src/server.ts` | Reuse for Workers state; do not add a second channel |
| Session resume | OpenCode natively resumes with `opencode --session <id>` | OpenCode CLI | Call it directly; this is the same mechanism Herdr wraps |
| Per-turn cost aggregation | AskAway turn metrics and the spec cost ledger already parse and upsert measured usage | `tasksync-chat/src/specs/specCostLedger.ts`, webview provider turn metrics | Reuse the pattern for worker rows |

The conclusion that matters for scope: Herdr's unique contribution is keeping TUI agents alive in terminal panes, which this feature does not need because it drives OpenCode's server and plugin directly. The facts it cannot provide are already arriving through `apiPluginStats`.

## Profiles and Execution Selection

**Decision**: Launch profiles through an AskAway primary profile adapter. Every mode/profile declares its adapter/platform plus allowed provider/model and thinking budget/tier options suitable for its task type. The user or orchestrator selects from those options for each run; baseline proven provider/model is GitHub Copilot OAuth with `github-copilot/gpt-5.6-luna`.

**Rationale**: Task types need controlled execution choices without losing reproducibility. Persisting the effective adapter/model/thinking selection makes runs observable and traceable. OpenCode’s `explore` is a subagent and falls back when requested as a primary agent, so Explorer requires a primary AskAway profile or deliberate parent delegation. If any configured selection is unavailable or ineligible, dispatch returns that explicit result; silently selecting another primary agent, adapter, model, or thinking option would violate the contract. Model or thinking changes are cache boundaries.

**Alternatives considered**: Direct `--agent explore` (rejected due fallback); one fixed model/thinking pair for every task type (rejected because modes require task-suitable choices); automatic fallback to an available primary agent/model (rejected because it hides the effective execution contract); unverified headless Copilot/Claude paths (deferred adapters).

## Portable Tool and Hook Boundary

**Decision**: Expose AskAway capabilities through MCP or a local broker, and apply policy/observability from OpenCode lifecycle events.

**Rationale**: VS Code `LanguageModelChatTool` objects are process-local and native hooks do not run for OpenCode. The portable boundary centralizes policy, telemetry, and secret handling.

**Alternatives considered**: Passing VS Code tool objects to worker processes (unsupported); assuming native hooks fire (false).

## Orchestrator Profile And Tool Policy

**Decision**: Define the parent as a non-coding orchestrator profile. Deny implementation-code read, search, navigation, edit, patch, file-mutation, build, and execution tools. Allow planning/specification, the eight worker controls, skill and memory, internet research, SharePoint, architecture MCPs, and read-only evidence/status verification.

**Rationale**: The orchestrator must retain product and architecture intent while workers own detailed investigation and implementation. Capability-based allow/deny policy makes that boundary testable rather than relying on prompt wording.

**Alternatives considered**: Giving the parent read-only source access (rejected because it encourages detailed implementation context to accumulate); prompt-only prohibition (rejected because it is not enforceable); removing verification tools (rejected because worker claims require independent acceptance checks).

## Decomposition, Research, And Acceptance

**Decision**: Represent each goal as a finite acyclic task graph. Route every ready node with an explicit worker mode/profile, adapter, model, thinking budget, and self-contained packet containing context, objective, constraints, acceptance criteria, evidence, and bounded stop/cost policy. If evidence is insufficient, dispatch bounded research or data-collection nodes, synthesize their high-level findings, and only then route downstream work. Independently verify returned evidence against acceptance criteria.

**Rationale**: Deterministic routing and complete packets prevent hidden context dependencies, while a research loop prevents guesses from becoming implementation instructions. Independent verification keeps completion authority with the orchestrator.

**Alternatives considered**: Free-form recursive delegation (rejected as unbounded); workers selecting their own model or scope (rejected as irreproducible); accepting worker-declared success (rejected because evidence can be incomplete).

## Context, Reuse, And Bounded Work

**Decision**: Do not implement transcript compaction or indefinite worker retention. Use short jobs with explicit stop/evidence contracts. A reused worker keeps historical/cached input context visible, while each new `runId` resets elapsed time and cost.

**Rationale**: The product requires transparent freshness and bounded context, not speculative replacement of provider compaction.

**Alternatives considered**: Automatic transcript compaction and long-lived retention (deferred); hidden cache retry (rejected because it obscures worker validity).

## Observability

**Decision**: Store worker ID, adapter session ID, lifecycle facts, and adapter usage fields in current-workspace observability records. Live accounting uses the real fields returned by provider `step_finish`, including input, output, reasoning, cache read/write, and cost; it does not infer cost from local estimates. Attribute each run's time, cost, input, and output to the dispatching main-agent turn and retain them in the existing expandable trace. Reused-worker historical input remains visible, but elapsed time and cost reset for the new run.

**Rationale**: This supports control-plane metrics and preserves the workspace isolation rule.

**Alternatives considered**: Run-local JSONL attribution only (insufficient for persistent OpenCode sessions); cross-workspace totals (prohibited).

## Deterministic And Live Test Boundary

**Decision**: Test graph routing, exact selection, packet completeness/rejection, tool policy, and attribution deterministically without network access. Keep a separate bounded OpenCode E2E suite that is explicitly enabled, receives a cheaper model through external configuration, uses real provider `step_finish` usage/cost, permits one worker/run, and cancels at configured timeout or cost limits. Credentials are never stored in source. Missing pre-dispatch prerequisites skip explicitly; failures after dispatch fail.

**Rationale**: Contract logic remains fast and reproducible while the live suite proves the provider boundary and accounting fields that fixtures cannot establish.

**Alternatives considered**: Mock-only provider testing (rejected because it cannot prove returned usage/cost); always-on live tests (rejected because credentials, network, and spend are environmental); silent live-test omission (rejected because prerequisite status must be visible).

## Durable Pattern Capture

**Decision**: Capture repeatable procedures or domain knowledge as skills, concise verified facts as memory, user-approved durable decisions as ADRs, and operational/product behavior as documentation. Do not create an ADR from implementation details or an unapproved design inference.

**Rationale**: Durable artifacts should preserve stable intent at the correct scope without turning transient implementation choices into governance.

**Alternatives considered**: Recording every implementation choice as an ADR (rejected); retaining all findings only in worker transcripts (rejected because proven reusable knowledge would be lost).

## Control And Messaging Boundary

**Decision**: Spec 001 owns exactly eight control operations: `worker_start`, `worker_submit`, `worker_list`, `worker_status`, `worker_wait`, `worker_cancel`, `worker_resume`, and `worker_logs`. It exports extensible lifecycle facts/interfaces only. Spec 003 owns `worker_ask`, `worker_respond`, and central sender/recipient routing among main agent, worker, and human.

**Rationale**: Separating lifecycle control from messaging keeps this contract complete without pre-empting Spec 003's routing and security design.

**Alternatives considered**: Adding ask/respond operations here (rejected as duplicate ownership); implementing partial routing through lifecycle logs (rejected because logs are not a message channel).

## Routing, Recovery, And Approval

**Decision**: Profiles are globally user-editable; mode selection filters compatible workers in the same canonical workspace, then selects existing or new. Every worker has a serial queue. Reuse requires a compatible worker with estimated wait at most two minutes; otherwise create an ad hoc worker. Extension reload reconnects only when the path-keyed server remains live. Prune archives only inactive workers with empty queues.

**Rationale**: This retains warm context only when it is useful and prevents queue blocking, cross-workspace leakage, and accidental cancellation during cleanup.

**Alternatives considered**: One worker per mode (rejected: multiple workspace workers per mode are required); immediate reuse regardless of queue (rejected: violates bounded wait); deleting/pruning live workers (rejected: destroys active work).

**Decision**: `/tmp` reads/writes and explicitly safe commands are allow-all. Other actions are approved in OpenCode and notify AskAway without copying an approval surface.

**Rationale**: The policy preserves OpenCode as the authority while giving the parent operational awareness.

**Alternatives considered**: AskAway approval controls (rejected: duplicate authority); permissive non-safe tools (rejected: bypasses approval).