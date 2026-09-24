# Implementation Plan: Async Sub-agent Runner

**Feature slug**: `001-async-subagent-runner` | **Current repository branch**: `main` | **Artifact branch provenance**: `001-async-subagent-runner` (reported by `setup-plan.sh`) | **Target work branch**: `001-async-subagent-runner` | **Date**: 2026-09-03 | **Spec**: [spec.md](spec.md)

## Summary

Build an AskAway worker control plane behind a runtime-neutral adapter contract. VS Code Copilot Chat remains a non-coding parent orchestrator: it decomposes goals into a bounded task graph, routes self-contained packets, commissions research when evidence is insufficient, synthesizes results, and independently verifies acceptance. OpenCode is the only current adapter and owns its conversations, tool calls, and approval UI. Future external agentic platforms may add adapters without changing the eight public control operations. AskAway owns workspace-scoped registry, serial queues, polling, per-dispatch-turn telemetry, Workers control-plane state, and links to the adapter session. The current OpenCode adapter uses exactly one shared server process for all workspaces and the portable AskAway MCP surface.

## Identity And Provenance

| Identity | Value | Derivation rule |
|---|---|---|
| Feature slug | `001-async-subagent-runner` | Active feature directory and spec path |
| Current repository branch | `main` | `git branch --show-current` on 2026-09-03 |
| Artifact branch provenance | `001-async-subagent-runner` | `setup-plan.sh --json` `BRANCH` value; provenance only, not the checked-out branch |
| Target work branch | `001-async-subagent-runner` | Feature implementation branch selected by this plan |
| Cloud base revision source | Git commit at plan creation | `git rev-parse HEAD` from repository root |
| Cloud base revision value | `2eaeba0d3f45e8ee191f6b802cc30bbda1df3941` | Immutable result of that command |
| Canonical workspace path | Realpath of the workspace root | `realpath(workspaceFolder)`; server keys and reuse comparisons use this value, never display labels |

## Technical Context

**Language/Version**: TypeScript in `tasksync-chat/` (VS Code extension) and `tasksync-opencode/` (local OpenCode relay).

**Primary Dependencies**: VS Code extension API, local OpenCode server/CLI, GitHub Copilot OAuth with `github-copilot/gpt-5.6-luna`, AskAway MCP service/broker.

**Storage**: Workspace-scoped extension state and observability records; registry mappings and archive records remain isolated by canonical workspace path.

**Testing**: Deterministic, no-network contract tests for routing and packet validation; Node behavior/integration scripts; and separately gated, bounded OpenCode live E2E tests using an explicitly configured cheaper model and real provider `step_finish` usage/cost fields.

**Target Platform**: VS Code extension host on macOS, Linux, or Windows with a local OpenCode runtime.

**Project Type**: VS Code extension plus local worker relay/service.

**Performance Goals**: `worker_start`/`worker_submit` return a run handle before worker completion; polling lets the parent continue; exactly one OpenCode server process runs for all workspaces; compatible warm reuse has estimated queue wait <= 2 minutes.

**Constraints**: No VS Code `LanguageModelChatTool` crosses process boundaries. The orchestrator profile excludes implementation-code inspection and mutation tools while retaining planning, worker control, skill/memory, internet, SharePoint, architecture MCP, and evidence-verification capabilities. The active runtime adapter owns transcripts and approval prompts; for OpenCode, `/tmp` read/write and explicitly safe commands are allow-all and every other action is approved in OpenCode and notified to AskAway. Exactly eight operations are exposed: `worker_start`, `worker_submit`, `worker_list`, `worker_status`, `worker_wait`, `worker_cancel`, `worker_resume`, and `worker_logs`. Spec 003 owns all messaging and central sender/recipient routing. No transcript compaction or indefinite retention is introduced. Every graph and job has a bounded stop, cost, acceptance, and evidence contract. Credentials never enter source or serialized packets.

**Scale/Scope**: Globally user-extensible profile definitions; multiple workspace-bound workers per mode; each worker has a serial queue and a stable AskAway worker ID mapped to one OpenCode session ID.

## Constitution Check

The repository constitution is an unfilled template, so it creates no enforceable principles. Requirement-derived gates pass by design: runtime ownership, per-workspace isolation, portable MCP boundary, OpenCode approval authority, telemetry completeness, and explicit exclusion of feature 003 routing. Phase gates below are mandatory before implementation moves forward. Post-design check: PASS; no complexity exception or ADR is required.

## Decision Register

| Decision | Status | Resulting rule |
|---|---|---|
| Adapter architecture | Decided | Runtime-facing contracts are platform-neutral. OpenCode is the only current adapter; future external agentic platforms may add adapters without changing the public lifecycle contract. |
| Control surface | Decided | Spec 001 exposes exactly `worker_start`, `worker_submit`, `worker_list`, `worker_status`, `worker_wait`, `worker_cancel`, `worker_resume`, and `worker_logs`; it exposes no `worker_ask` or `worker_respond`. |
| Parent experience | Decided | VS Code Copilot orchestrates, analyzes, defines bounded evidence, understands and verifies results, and reports high-level outcomes. Worker modes/profiles perform implementation work. |
| Orchestrator tool policy | Decided | The orchestrator cannot read, search, navigate, edit, patch, create, delete, rename, build, or execute implementation code. It retains planning/spec tools, worker lifecycle controls, skill and memory tools, internet and SharePoint research, architecture MCPs, and read-only evidence/status verification. |
| Decomposition and verification | Decided | Each goal becomes a bounded acyclic task graph. Every node records mode/profile, adapter/model/thinking selection, self-contained context, objective, constraints, acceptance/evidence contract, and stop policy. Missing evidence routes to bounded research/data-collection nodes; the orchestrator synthesizes findings and independently checks acceptance rather than accepting a worker's claim. |
| Worker runtime | Decided | The selected adapter owns async agent execution, conversation, tools, and approvals; OpenCode is the current implementation. |
| Server ownership | Decided | A single local server is keyed by canonical workspace path; all workers/viewers for that path attach to it. |
| AskAway responsibility | Decided | AskAway owns registry, polling, serial queue state, Workers controls, telemetry, budget aggregation, and session links; it does not duplicate transcript or approvals. |
| Shared tools | Decided | Workers use the AskAway MCP service/broker. Each tool declares policy, input/output, observability event, and secret handling there. |
| Profiles and routing | Decided | Profiles are global, user-extensible definitions. Every mode/profile declares its adapter/platform, allowed model options, and allowed thinking budget/tier options suitable for its task type. The user or orchestrator selects an allowed model/thinking option per mode, then filters compatible workers in the canonical workspace and chooses existing/new. Multiple workers per mode are permitted. |
| Selection continuity | Decided | Dispatch resolves the requested adapter/model/thinking selection exactly. An unavailable or ineligible configured selection returns an explicit unavailable/ineligible result; fallback to another primary agent or model is a contract failure. Changing model or thinking budget/tier is a cache boundary. |
| Queue/reuse | Decided | A compatible worker is reused only when its estimated serial-queue wait is <=2 minutes; otherwise create an ad hoc worker. Never cross workspace paths. |
| Recovery/pruning | Decided | Reload reconnects to a server that remains live. Prune only inactive empty-queue workers and archive, rather than delete, mappings and telemetry. |
| Retention and reuse | Decided | Jobs are short and bounded. Reuse preserves historical/cached input context, while each new `runId` resets elapsed time and cost. Transcript compaction and indefinite worker retention are out of scope. |
| Approvals | Decided | `/tmp` reads/writes and safe commands allow-all; all other actions require OpenCode approval and cause AskAway notification. |
| Observability/budget | Decided | Record lifecycle and tool events plus the effective adapter, model, thinking budget/tier, and adapter usage by worker/session/run. Charge each run's time, cost, input, and output to the main-agent turn that dispatched it and retain the effective selection and usage fields in the existing expandable trace. |
| Budget source and reuse display | Decided | Token and cost calculations use real provider-returned `step_finish` fields, never estimates or fixture defaults in live accounting. Attribution remains on the dispatching main-agent turn. Reused-worker historical input stays visible, while elapsed time and cost reset for each run. |
| Durable pattern capture | Decided | Proven reusable procedures/domain knowledge may become skills; concise learned facts may become memory; ADRs require a durable user-approved decision; operational and product behavior belongs in documentation. Implementation details alone never justify an ADR. |
| Side channel | Decided | Spec 001 exposes extensible lifecycle facts/interfaces only. Spec 003 owns `worker_ask`, `worker_respond`, and central sender/recipient routing among main agent, worker, and human. |

## Incremental Gated Waterfall

| Phase | Entry criteria | Concrete deliverable | PAC: ID / assertion / verify / expected evidence | Exit and unlock | Writers / parallel work |
|---|---|---|---|---|---|
| P0 Contract baseline | This plan approved; base revision recorded | Orchestrator profile, bounded graph/routing, worker/run, packet, server, event, approval and MCP contracts | PAC-001: deterministic no-network tests route fixed task graphs and validate complete/rejected packets; repeated inputs produce the same route/selection and accepted payload names all context, acceptance, evidence, stop, attribution, and budget fields; saved test output | Contracts pass; unlock P1 | One writer for contracts; research/contract review may run in parallel |
| P1 Shared-server spike | P0 contracts pass; local OpenCode and OAuth available | Reproducible live-session proof and captured event fixture | PAC-002: worker and viewer use one server; integration command counts server instances and checks session link/event IDs; exactly one server process across workspaces and matching `workerId`/`sessionId`; command output + fixture | PAC-002 passes; unlock P2 | One spike writer; observer may collect evidence in parallel |
| P2 Registry and dispatch | P1 proof captured | Workspace server manager, profile selector, serial queues, handle API | PAC-003: compatible <=2 min worker reused, incompatible/>2 min becomes ad hoc; behavior test submits both; identities and queue decisions match; test log | PAC-003 passes; unlock P3 | One writer per owning module; independent selector/queue tests may parallelize |
| P3 Event, approval and budgets | P2 APIs stable | Poll adapter, Worker tab state, event ledger, source-attributed budget | PAC-004: non-safe request creates OpenCode approval and AskAway notification; PAC-005: `step_finish` fields and source-attributed async cost recorded but native-turn counter unchanged; integration tests inspect external control-plane records; persisted evidence | PAC-004 and PAC-005 pass; unlock P4 | One writer for shared ledger; UI and event adapter can proceed in parallel |
| P4 Recovery, retirement and archive | P3 telemetry works | Reload reconnect, retirement state, archive-only prune | PAC-006: live server reconnects after reload; PAC-007: cache expiry or 300001 context retires; PAC-008: only inactive empty queue archives; integration tests assert observed states; evidence records | All P4 PACs pass; unlock acceptance | One writer for lifecycle state; tests may parallelize by scenario |
| P5 End-to-end acceptance | P0-P4 evidence retained; live-test environment explicitly enabled with OpenCode auth and cheaper model configured outside source | Deterministic suite, bounded live OpenCode suite, and operator quickstart | PAC-009: bounded run returns handle before finish, streams progress, opens exact session, reaches terminal evidence, and records real `step_finish` usage/cost against the dispatching turn; live command enforces timeout/run/cost limits and succeeds or reports an explicit prerequisite/budget stop; captured output | All deterministic PACs and enabled live PACs pass; implementation ready for review | One acceptance owner; live tests run serially and separately from no-network tests |

## Exact Shared-Server Live-Session Spike

Prerequisites: canonical workspace is `/Users/machs/PycharmProjects/TaskSync`; GitHub Copilot OAuth is authenticated; OpenCode CLI/server is installed; live testing is explicitly enabled; and profile `explorer` is a primary AskAway worker profile using a cheaper model supplied by test configuration, not hardcoded credentials or an implicit production default. Missing enablement, auth, CLI/server, profile, or model availability produces an explicit prerequisite skip before dispatch. Once dispatch begins, provider/auth failures fail the test rather than skip it. The live suite allows one worker, one run, a configured wall-clock timeout and maximum provider cost, cancels on either limit, and records the stop reason. It never falls back to another model.

1. Resolve `WORKSPACE=$(realpath /Users/machs/PycharmProjects/TaskSync)` and start/reuse the AskAway-managed OpenCode server for that exact value. Record returned `serverId` and endpoint.
2. Submit a bounded request through `worker_start` then `worker_submit`: `Return the names of the top-level files only; stop after evidence.` Record `workerId`, `runId`, and `sessionId` from its immediate handle while status is non-terminal.
3. Open the Workers control-plane session action. It must target the recorded endpoint and `sessionId`; attach an OpenCode viewer to that same endpoint and session.
4. Poll `worker_status` until an OpenCode `message_update` occurs, then until terminal `step_finish`. In both the event ledger and viewer, assert the recorded `workerId`, `runId`, and `sessionId` match.
5. Submit a second bounded request for the same canonical workspace, then assert registry server count for the path is `1`, endpoint is unchanged, and the viewer remains live.

Pass evidence is the immediate non-terminal handle, server-count output `1`, matching IDs in viewer/link/events, one streamed update, and terminal `step_finish` with provider-returned input, output, reasoning, cache read/write, and cost. The accounting assertion derives totals from those returned fields and attributes them to the dispatching main-agent turn. Profile or model fallback fails the spike.

## Cloud Worker Packet

This section defines a schema, not a dispatch-ready packet. `/sk.implement` assembles a self-contained selected-task packet and must reject dispatch if any required field below is absent. `baseRevision` is the explicit immutable revision approved by this plan, `2eaeba0d3f45e8ee191f6b802cc30bbda1df3941`; it is never inferred from the feature slug, branch name, or dispatch-time `HEAD`. A differing checkout is reported as a mismatch and does not silently replace the revision. `canonicalWorkspacePath` is `realpath(workspaceFolder)`. Secrets are rejected before serialization.

Required fields are: packet version; canonical workspace path; explicit base revision; orchestrator turn ID; bounded graph and selected node identity; worker mode/profile; worker, run, and adapter session IDs; adapter/platform and server identity; allowed and effective provider/model/thinking selection; resolved worker tool policy; self-contained context sources/content, objective, constraints, acceptance/evidence contract, stop condition; approval policy; observability fields; and, for live-test nodes, timeout/run/cost limits. The effective selection must be a member of the profile's allowed options. No required value may contain `TBD`, placeholder prose, an unresolved decision, or a credential. If evidence is insufficient, the selected node must be a bounded research/data-collection node whose result feeds orchestrator synthesis before downstream planning or verification. If the configured selection is unavailable or ineligible, packet assembly returns that explicit result and does not substitute another primary agent, adapter, model, or thinking option.

```yaml
packetVersion: 2
canonicalWorkspacePath: /Users/machs/PycharmProjects/TaskSync
baseRevision: 2eaeba0d3f45e8ee191f6b802cc30bbda1df3941
orchestratorTurnId: <required dispatching main-agent turn ID>
taskGraph:
  graphId: <required bounded graph ID>
  nodeId: <required selected node ID>
  dependsOn: [<required completed prerequisite node IDs, or empty>]
workerId: <required persisted AskAway UUID>
runId: <required fresh UUID for this submission>
adapter:
  type: opencode
  sessionId: <required OpenCode session ID>
serverKey: canonicalWorkspacePath
workerMode: <required mode: research, implementation, review, or verification>
profile: <required resolved worker profile ID>
selectionPolicy:
  adapterPlatform: opencode
  allowedModels: [github-copilot/gpt-5.6-luna]
  allowedThinkingOptions: [<required profile-allowed budget or tier>]
effectiveSelection:
  provider: github-copilot
  model: github-copilot/gpt-5.6-luna
  thinking: <required selected budget or tier>
selectedTask:
  id: <required selected task ID>
  objective: <required exact bounded objective>
  contextSources: [<required source ID, immutable revision/path, and relevant content or digest>]
  constraints: [<required explicit execution and scope constraints>]
  allowedFiles: [<required explicit path scope>]
  requiredInputs: [<required self-contained content; references alone are insufficient unless worker-accessible and immutable>]
acceptanceContract:
  criteria: [<required independently verifiable outcome>]
evidenceContract:
  assertions: [<required caller-observable evidence mapped to acceptance criteria>]
  validationCommands: [<required rerunnable command>]
stopPolicy:
  condition: <required bounded terminal condition>
  maxElapsedSeconds: <required positive limit>
  maxRuns: <required positive limit>
  maxProviderCost: <required non-negative limit or explicit not-applicable for deterministic work>
liveTestBudget: <required timeout/run/cost policy for live-test nodes; otherwise omitted>
mcpPolicy: <required resolved portable policy ID>
approvalPolicy:
  allowAll: [tmp-read, tmp-write, explicitly-safe-command]
  otherwise: opencode-approval-with-askaway-notification
observability:
  dispatchingMainAgentTurnId: <must equal orchestratorTurnId>
  attribution: dispatching-main-agent-turn
  sourceAttribution: github-copilot
  expandableTrace: [time, cost, input, output, adapterPlatform, model, thinking]
  adapterUsageSource: provider-step_finish
  adapterUsage: [input, output, reasoning, cacheRead, cacheWrite, cost]
sideChannel: lifecycle-facts-only
```

## Project Structure

```text
tasksync-chat/src/{extension.ts,mcp/mcpServer.ts,observability/,webview/}
tasksync-opencode/src/{server.ts,sessionManager.ts,relay.ts}
specs/001-async-subagent-runner/{plan.md,research.md,data-model.md,quickstart.md,contracts/worker-runtime.md}
```

**Structure Decision**: Extend the existing extension and relay at their ownership boundaries; introduce no duplicate OpenCode UI and no new product application.

## Complexity Tracking

No constitution violation requires justification.