# Task Details: Async Sub-agent Runner

Each task's **Demo** is executable evidence. Every acceptance criterion has an Assert, Verify, Expected result, and a named non-vacuous evidence predicate.

## CY-001: P0 Contract and Test Seam

### T001 [Contract] `tasksync-chat/src/mcp/mcpServer.ts`
**Context**: The portable MCP boundary is the caller-visible worker API.  
**Scope**: Define `worker_start`, `worker_submit`, `worker_list`, `worker_status`, `worker_wait`, `worker_cancel`, `worker_resume`, and `worker_logs` request/results.  
**Dependencies**: None.  
**Acceptance `AC-T001-ContractSchemaComplete`** — **Assert**: the public schema exposes exactly `worker_start`, `worker_submit`, `worker_list`, `worker_status`, `worker_wait`, `worker_cancel`, `worker_resume`, and `worker_logs`, with typed identity/result fields and non-terminal start/submit handles; `worker_ask` and `worker_respond` are absent. **Verify**: `node tasksync-chat/test-worker-runtime-contract.cjs`. **Expected**: `EV-001 ContractSchemaComplete: PASS`, with operation count exactly 8, all eight names matched, required handle fields present, and zero ask/respond operations or secret-bearing fields.  
**Demo**: `node tasksync-chat/test-worker-runtime-contract.cjs` reports `EV-001 ContractSchemaComplete: PASS`.

### T001a [Contract seam] `tasksync-chat/src/mcp/mcpServer.ts`
**Context**: T002 needs a callable public seam before an adapter/runtime exists.
**Scope**: Export an injected, runtime-neutral facade for exactly the eight declared operations; it delegates to `WorkerRuntime` without starting a server or selecting an adapter.
**Dependencies**: T001.
**Acceptance `AC-T001a-CallableOperationFacade`** — **Assert**: callers can invoke exactly the eight named operations through the facade, and each operation preserves the injected runtime result.
**Verify**: `node tasksync-chat/test-worker-runtime-contract.cjs`.
**Expected**: `EV-001a CallableOperationFacade: PASS`, with operation count exactly 8 and all eight facade names matched.
**Demo**: `node tasksync-chat/test-worker-runtime-contract.cjs` reports `EV-001a CallableOperationFacade: PASS`.

### T002 [Test] `tasksync-chat/test-worker-runtime-contract.cjs`
**Context**: Runtime changes must preserve a caller-visible immediate-handle promise.  
**Scope**: Test handle timing/result shape and required status fields through the public operation seam.  
**Dependencies**: T001, T001a.  
**Acceptance `AC-T002-ImmediateHandleContract`** — **Assert**: callers observe start/submit handles before terminal completion. **Verify**: `node tasksync-chat/test-worker-runtime-contract.cjs`. **Expected**: `EV-002 ImmediateHandleContract: PASS`, with the handle observed before the programmed terminal event and state exactly `STARTING` or another declared non-terminal state.  
**Demo**: `node tasksync-chat/test-worker-runtime-contract.cjs` reports `EV-002 ImmediateHandleContract: PASS`.

### T003 [Contract] `tasksync-opencode/src/relay.ts`
**Context**: Relay facts must be portable and scoped without becoming a copied conversation.  
**Scope**: Define identity-preserving event payload translation and secret exclusion.  
**Dependencies**: None.  
**Acceptance `AC-T003-EventIdentityContract`** — **Assert**: translated facts preserve canonical workspace, worker, run, and session IDs while refusing credentials, approval decisions, and transcript bodies. **Verify**: `node tasksync-chat/test-worker-runtime-contract.cjs`. **Expected**: `EV-003 EventIdentityContract: PASS`, with all four identity values equal to the fixture and every payload containing `token` rejected.  
**Demo**: `node tasksync-chat/test-worker-runtime-contract.cjs` reports `EV-003 EventIdentityContract: PASS`.

## CY-002: P1 Shared Server Spike

### T004 [Runtime] `tasksync-opencode/src/server.ts`
**Context**: One OpenCode server process serves every workspace so extra windows never add processes.  
**Scope**: Acquire/reuse the single shared server; workers stay workspace-tagged records on it.  
**Dependencies**: `CAC-CY-001-ContractSeamReady`.  
**Acceptance `AC-T004-OneGlobalServer`** — **Assert**: concurrent acquisitions return one identical server identity and endpoint, and no second server process is started for another workspace; workspace scoping is applied by worker records and view filters, not by server count. **Verify**: `node tasksync-chat/test-shared-opencode-server.cjs`. **Expected**: `EV-004 OneGlobalServer: PASS serverCount=1 workspaceFilters=external`, with equal `serverId`/`endpoint` and a `ws://127.0.0.1:<port>/relay` endpoint.  
**Demo**: `node tasksync-chat/test-shared-opencode-server.cjs` reports `EV-004 OneGlobalServer: PASS`.

### T006a [Spike] `specs/001-async-subagent-runner/research.md`
**Context**: Herdr (https://herdr.dev, Apache 2.0) is an agent runtime that already owns persistent agent terminals, survives disconnect, and reports working/blocked/idle. Building our own session-lifetime layer without checking it risks duplicating solved work.  
**Scope**: Read-only evaluation against this feature's contract; no product code, no dependency adoption.  
**Dependencies**: T004.  
**Acceptance `AC-T006a-HerdrAdapterEvaluation`** — **Assert**: research.md gains a `Herdr Adapter Evaluation` section whose capability table covers exactly the eight worker operations plus session persistence, reload recovery, blocked-state detection, and per-run token/cost usage facts; every row states supported/unsupported/unknown with a cited source URL, and the section ends with exactly one `Recommendation:` line choosing adapter, reject, or defer with rationale. **Verify**: `node tasksync-chat/test-herdr-evaluation.cjs`. **Expected**: `EV-006a HerdrAdapterEvaluation: PASS rows=12 citedRows=12 unknownRowsJustified=true recommendations=1`.  
**Demo**: `node tasksync-chat/test-herdr-evaluation.cjs` reports `EV-006a HerdrAdapterEvaluation: PASS`.

### T005 [Runtime] `tasksync-opencode/src/sessionManager.ts`
**Context**: Multiple sessions may share a server while retaining distinct worker/session identities.  
**Scope**: Launch and attach two bounded sessions using the shared endpoint.  
**Dependencies**: T004.  
**Acceptance `AC-T005-TwoSessionsShareEndpoint`** — **Assert**: two sessions have distinct session IDs, share one endpoint, and each opens by its exact ID. **Verify**: `node tasksync-chat/test-shared-opencode-server.cjs`. **Expected**: `EV-005 TwoSessionsShareEndpoint: PASS`, with exactly two distinct `sessionId` values paired with one equal endpoint.  
**Demo**: `node tasksync-chat/test-shared-opencode-server.cjs` reports `EV-005 TwoSessionsShareEndpoint: PASS`.

### T006 [Test] `tasksync-chat/test-shared-opencode-server.cjs`
**Context**: The architecture is viable only with live updates across shared-server sessions.  
**Scope**: Reproduce the two-session, viewer-attached bounded conversation spike.  
**Dependencies**: T004, T005.  
**Acceptance `AC-T006-SharedServerLiveConversation`** — **Assert**: each returned handle owns its streamed update and terminal usage facts, with equal IDs across handle, viewer link, and events. **Verify**: `node tasksync-chat/test-shared-opencode-server.cjs`. **Expected**: `EV-006 SharedServerLiveConversation: PASS`, `serverCount=1`, exactly two session IDs, and at least one matching `message_update` and terminal `step_finish` per session.  
**Demo**: `node tasksync-chat/test-shared-opencode-server.cjs` reports `EV-006 SharedServerLiveConversation: PASS`.

## CY-003: P2 Profiles, Registry, and Selection

### T007 [Registry] `tasksync-chat/src/extension.ts`
**Context**: Profiles are global definitions; workers are isolated by canonical workspace.  
**Scope**: Register editable profiles and workspace registry identity.  
**Dependencies**: `CAC-CY-002-LiveAttachmentProven`.  
**Acceptance `AC-T007-ProfileAndWorkspaceIsolation`** — **Assert**: global editable profiles declare allowed model/thinking selections per mode, while equal labels cannot merge workers from distinct real paths. **Verify**: `node tasksync-chat/test-worker-selection.cjs`. **Expected**: `EV-007 ProfileAndWorkspaceIsolation: PASS`, with a nonzero allowed-selection count for every configured mode and exactly two registry keys for equal-mode workers on two paths.  
**Demo**: `node tasksync-chat/test-worker-selection.cjs` reports `EV-007 ProfileAndWorkspaceIsolation: PASS`.

### T008 [Routing] `tasksync-opencode/src/sessionManager.ts`
**Context**: Warm reuse is valuable only when compatible and not queue-blocked.  
**Scope**: Select eligible workers and create ad-hoc workers when the contract refuses reuse.  
**Dependencies**: T007.  
**Acceptance `AC-T008-BoundedReuseSelection`** — **Assert**: reuse requires fresh cache, <=300000 context, compatible path/profile/model/thinking, non-retired state, and <=120-second wait; unavailable per-mode model/thinking is explicitly refused without fallback, and any model/thinking change creates a cache boundary. **Verify**: `node tasksync-chat/test-worker-selection.cjs`. **Expected**: `EV-008 BoundedReuseSelection: PASS`, with reuse at 120 seconds, ad-hoc creation at 121 seconds, explicit `SELECTION_UNAVAILABLE` and zero fallback dispatches for unavailable selection, and a new worker/run when model or thinking changes.  
**Demo**: `node tasksync-chat/test-worker-selection.cjs` reports `EV-008 BoundedReuseSelection: PASS`.

### T009 [Test] `tasksync-chat/test-worker-selection.cjs`
**Context**: Selection must remain correct after the queue implementation changes.  
**Scope**: Exercise caller-visible route outcomes across eligibility cases.  
**Dependencies**: T007, T008.  
**Acceptance `AC-T009-SelectionBehavior`** — **Assert**: public results cover allowed per-mode selections, record effective adapter/model/thinking per run/trace, explicitly refuse unavailable selection without fallback, treat model/thinking changes as cache boundaries, and preserve compatible reuse, bounded wait, same-mode multiplicity, and path isolation. **Verify**: `node tasksync-chat/test-worker-selection.cjs`. **Expected**: `EV-009 SelectionBehavior: PASS`, with all scenario predicates passing, exact requested effective values in each accepted run/trace, zero dispatches for refused selections, and distinct worker/run IDs at each cache boundary.  
**Demo**: `node tasksync-chat/test-worker-selection.cjs` reports `EV-009 SelectionBehavior: PASS`.

## CY-004: P3 Events, Approval, and Ledger

### T010 [Events] `tasksync-opencode/src/relay.ts`
**Context**: AskAway observes OpenCode lifecycle facts but does not own the conversation or approvals.  
**Scope**: Poll and record lifecycle, approval notification, and available terminal metrics.  
**Dependencies**: `CAC-CY-003-WorkspaceBoundDispatchReady`.  
**Acceptance `AC-T010-LifecyclePollingLedger`** — **Assert**: records include order-independent lifecycle facts, effective adapter/model/thinking, all provider-supplied `step_finish` values, and notification-only approval. **Verify**: `node tasksync-chat/test-worker-observability.cjs`. **Expected**: `EV-010 LifecyclePollingLedger: PASS`, with nonzero start/update/tool/checkpoint/approval/terminal records sharing fixture IDs, exact effective selection values, and zero stored approval actions.  
**Demo**: `node tasksync-chat/test-worker-observability.cjs` reports `EV-010 LifecyclePollingLedger: PASS`.

### T011 [Ledger] `tasksync-chat/src/extension.ts`
**Context**: Async Copilot spend contributes to workspace budgeting without changing the native turn limit.  
**Scope**: Aggregate source-attributed worker cost and preserve native counter separation.  
**Dependencies**: T010.  
**Acceptance `AC-T011-AsyncUsageSeparatedFromTurnCap`** — **Assert**: worker usage is grouped by current workspace and attributed to its dispatching main-agent turn with source `github-copilot`, without changing the native turn counter. **Verify**: `node tasksync-chat/test-worker-observability.cjs`. **Expected**: `EV-011 AsyncUsageSeparatedFromTurnCap: PASS`, with positive worker usage under the exact dispatch-turn ID, zero usage under other turns/workspaces, and native turn-credit delta exactly 0.  
**Demo**: `node tasksync-chat/test-worker-observability.cjs` reports `EV-011 AsyncUsageSeparatedFromTurnCap: PASS`.

### T012 [MCP] `tasksync-chat/src/mcp/mcpServer.ts`
**Context**: Parent operations must expose observed control-plane facts.  
**Scope**: Back non-start operations with server/worker state and fact-only logs.  
**Dependencies**: T010, T011.  
**Acceptance `AC-T012-WorkerOperationsReflectLedger`** — **Assert**: list/status/wait/cancel/resume/logs reflect observed records and never return a copied transcript. **Verify**: `node tasksync-chat/test-worker-observability.cjs`. **Expected**: `EV-012 WorkerOperationsReflectLedger: PASS`, with exact recorded IDs/metrics in operation output, zero transcript bodies, and inaccessible resume returning the declared fresh-submission result.  
**Demo**: `node tasksync-chat/test-worker-observability.cjs` reports `EV-012 WorkerOperationsReflectLedger: PASS`.

### T013 [Test] `tasksync-chat/test-worker-observability.cjs`
**Context**: Observability must preserve both source attribution and runtime boundary.  
**Scope**: Test approval notification, metrics, isolation, and native-counter behavior.  
**Dependencies**: T010-T012.  
**Acceptance `AC-T013-ObservableLedgerBehavior`** — **Assert**: the expandable trace exposes elapsed time, cost, input/output tokens, effective adapter/model/thinking, and available reasoning/cache values; reused workers retain historical/cached input visibility while each run resets elapsed time and cost, and usage remains attributed to the dispatching main-agent turn. **Verify**: `node tasksync-chat/test-worker-observability.cjs`. **Expected**: `EV-013 ObservableLedgerBehavior: PASS`, with exact fixture elapsed/cost/input/output/effective-selection values, positive historical/cached input after reuse, new-run elapsed and cost exactly 0 before events, correct dispatch-turn/source attribution, and zero secrets or approval actions.  
**Demo**: `node tasksync-chat/test-worker-observability.cjs` reports `EV-013 ObservableLedgerBehavior: PASS`.

## CY-005: P4 Workers Control Plane

### T014 [ControlPlane] `tasksync-chat/src/webview/webviewProvider.ts`
**Context**: The Workers tab projects control-plane state rather than recreating OpenCode.  
**Scope**: Supply state and exact session-open targets to the webview.  
**Dependencies**: `CAC-CY-004-ObservableWorkerStateReady`.  
**Acceptance `AC-T014-WorkersStateProjection`** — **Assert**: projected state includes health, worker state, update/blocker, endpoint/session action, effective adapter/model/thinking, per-run elapsed/cost/input/output, and historical/cached input. **Verify**: `node tasksync-chat/test-workers-control-plane.cjs`. **Expected**: `EV-014 WorkersStateProjection: PASS`, with every named field equal to the fixture and zero transcript-content or approval-command keys.  
**Demo**: `node tasksync-chat/test-workers-control-plane.cjs` reports `EV-014 WorkersStateProjection: PASS`.

### T015 [UI] `tasksync-chat/media/webview.js`
**Context**: Operators need to scan and filter workers, then open the right live conversation.  
**Scope**: Render filters, state/usage, notification, and exact session-open action.  
**Dependencies**: T014.  
**Acceptance `AC-T015-WorkersViewInteraction`** — **Assert**: filtering changes visible rows, session action preserves endpoint/session ID, and an expandable trace shows elapsed time, cost, input tokens, and output tokens. **Verify**: `node tasksync-chat/test-workers-control-plane.cjs`. **Expected**: `EV-015 WorkersViewInteraction: PASS`, with exactly one matched worker, exact session-open payload and trace fixture values, and zero approval buttons or transcript panels.  
**Demo**: `node tasksync-chat/test-workers-control-plane.cjs` reports `EV-015 WorkersViewInteraction: PASS`.

### T016 [UI] `tasksync-chat/media/main.css`
**Context**: State and usage must remain legible in the existing AskAway UI.  
**Scope**: Style Workers state, filters, metrics, and notification affordances.  
**Dependencies**: T014.  
**Acceptance `AC-T016-WorkersControlPlanePresentation`** — **Assert**: every state, notification, metric, and expandable-trace selector used by the Workers view has visible styling. **Verify**: `node tasksync-chat/test-workers-control-plane.cjs`. **Expected**: `EV-016 WorkersControlPlanePresentation: PASS`, with a nonzero matched selector count for health, state, metrics, trace, and pending notification, and zero transcript/approval-action selectors.  
**Demo**: `node tasksync-chat/test-workers-control-plane.cjs` reports `EV-016 WorkersControlPlanePresentation: PASS`.

### T017 [Test] `tasksync-chat/test-workers-control-plane.cjs`
**Context**: UI tests must enforce the product boundary, not internal rendering mechanics.  
**Scope**: Test filters, exact links, projected metrics, and absent duplicated controls.  
**Dependencies**: T014-T016.  
**Acceptance `AC-T017-WorkersUiBoundary`** — **Assert**: a worker session link resolves to its shared endpoint/session, filters leave only matches, effective selection is visible, and reused-worker history remains visible while new-run elapsed/cost reset. **Verify**: `node tasksync-chat/test-workers-control-plane.cjs`. **Expected**: `EV-017 WorkersUiBoundary: PASS`, with exact link and adapter/model/thinking values, exactly one filtered row, positive historical/cached input, new-run elapsed and cost exactly 0, and zero transcript/approval UI.  
**Demo**: `node tasksync-chat/test-workers-control-plane.cjs` reports `EV-017 WorkersUiBoundary: PASS`.

## CY-006: P5 Recovery, Retirement, Prune, and E2E

### T018 [Recovery] `tasksync-chat/src/extension.ts`
**Context**: Reload must reconnect only to a server that is still alive.  
**Scope**: Rehydrate server/worker records and mark unavailable sessions orphaned.  
**Dependencies**: `CAC-CY-005-OperatorsCanObserveAndOpenSessions`.  
**Acceptance `AC-T018-ReloadRecovery`** — **Assert**: live-server reload retains the exact session link and unavailable-server reload becomes `ORPHANED` with a reason. **Verify**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs`. **Expected**: `EV-018 ReloadRecovery: PASS`, with exactly one reconnected worker and one `ORPHANED` worker carrying a nonempty reason.  
**Demo**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs` reports `EV-018 ReloadRecovery: PASS`.

### T019 [Lifecycle] `tasksync-opencode/src/sessionManager.ts`
**Context**: Cache/context policy must visibly stop unsafe warm reuse.  
**Scope**: Transition expired-cache and >300000-token workers to retired.  
**Dependencies**: `CAC-CY-005-OperatorsCanObserveAndOpenSessions`.  
**Acceptance `AC-T019-RetirementBoundary`** — **Assert**: cache expiration and 300001 context tokens retire a worker with a reason and reject reuse. **Verify**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs`. **Expected**: `EV-019 RetirementBoundary: PASS`, with `RETIRED` at both policy triggers and a distinct fresh worker/run in each result.  
**Demo**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs` reports `EV-019 RetirementBoundary: PASS`.

### T020 [Lifecycle] `tasksync-chat/src/mcp/mcpServer.ts`
**Context**: Cleanup cannot destroy active or queued work.  
**Scope**: Add archive-only prune eligibility and result reporting.  
**Dependencies**: `CAC-CY-005-OperatorsCanObserveAndOpenSessions`.  
**Acceptance `AC-T020-InactiveOnlyArchivePrune`** — **Assert**: an inactive empty-queue worker archives mappings/telemetry, while active or queued workers are explicitly refused without cancellation or deletion. **Verify**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs`. **Expected**: `EV-020 InactiveOnlyArchivePrune: PASS`, with exactly one archive reference and active/queued record counts and states unchanged.  
**Demo**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs` reports `EV-020 InactiveOnlyArchivePrune: PASS`.

### T021 [E2E] `tasksync-chat/test-async-subagent-runner-e2e.cjs`
**Context**: Final acceptance verifies the parent can continue while a bounded worker delivers evidence.  
**Scope**: Exercise the full workflow across server, routing, ledger, view link, recovery, retirement, and prune.  
**Dependencies**: T018-T020.  
**Acceptance `AC-T021-EndToEndAsyncWorkerFlow`** — **Assert**: the exactly eight public operations omit worker ask/respond; start returns before finish; parent progress precedes terminal evidence; allowed per-mode selection records effective adapter/model/thinking; unavailable selection refuses without fallback; model/thinking changes bound cache reuse; and all IDs, dispatch-turn usage, expandable trace values, recovery, retirement, and prune outcomes agree. **Verify**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs`. **Expected**: `EV-021 EndToEndAsyncWorkerFlow: PASS`, with operation count exactly 8, zero ask/respond/fallback dispatches, exact selected adapter/model/thinking, distinct worker/run after each selection change, positive historical/cached input after reuse, per-run initial elapsed/cost exactly 0, matching dispatch-turn/session IDs, and every EV-018 through EV-020 predicate passing.
**Demo**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs` reports `EV-021 EndToEndAsyncWorkerFlow: PASS`.

## Gates

### CY-001 / P0
**Cycle acceptance `CAC-CY-001-ContractSeamReady`** — **Assert**: all CY-001 member task ACs pass and the public contract composes into a secret-free immediate-handle seam. **Verify**: `node tasksync-chat/test-worker-runtime-contract.cjs`. **Expected**: `CAC-CY-001 ContractSeamReady: PASS`, with `AC-T001-ContractSchemaComplete`, `AC-T002-ImmediateHandleContract`, and `AC-T003-EventIdentityContract` all PASS.  
**Phase acceptance `PAC-P0-ContractAndTestSeamReady`** — **Assert**: CY-001 is complete and its contract is executable as the next phase's runtime input. **Verify**: `node tasksync-chat/test-worker-runtime-contract.cjs`. **Expected**: `PAC-P0 ContractAndTestSeamReady: PASS`, with `CAC-CY-001-ContractSeamReady` PASS and exactly 8 public operations.

### CY-002 / P1
**Cycle acceptance `CAC-CY-002-LiveAttachmentProven`** — **Assert**: all CY-002 member task ACs pass and two identity-distinct sessions provide live updates through the one shared server. **Verify**: `node tasksync-chat/test-shared-opencode-server.cjs`. **Expected**: `CAC-CY-002 LiveAttachmentProven: PASS`, with `AC-T004-OneGlobalServer`, `AC-T005-TwoSessionsShareEndpoint`, and `AC-T006-SharedServerLiveConversation` all PASS.  
**Phase acceptance `PAC-P1-OneServerTwoLiveSessions`** — **Assert**: P0 and CY-002 are complete and the shared endpoint supports two openable live sessions. **Verify**: `node tasksync-chat/test-shared-opencode-server.cjs`. **Expected**: `PAC-P1 OneServerTwoLiveSessions: PASS`, with `PAC-P0-ContractAndTestSeamReady` and `CAC-CY-002-LiveAttachmentProven` PASS, `serverCount=1`, and exactly two distinct session IDs.

### CY-003 / P2
**Cycle acceptance `CAC-CY-003-WorkspaceBoundDispatchReady`** — **Assert**: all CY-003 member task ACs pass and dispatch produces only eligible compatible reuse, explicit ad-hoc creation, or explicit unavailable-selection refusal without fallback. **Verify**: `node tasksync-chat/test-worker-selection.cjs`. **Expected**: `CAC-CY-003 WorkspaceBoundDispatchReady: PASS`, with `AC-T007-ProfileAndWorkspaceIsolation`, `AC-T008-BoundedReuseSelection`, and `AC-T009-SelectionBehavior` all PASS.  
**Phase acceptance `PAC-P2-EligibleReuseAndPerModeSelection`** — **Assert**: P1 and CY-003 are complete and every accepted run records an allowed effective adapter/model/thinking while selection changes bound cache reuse. **Verify**: `node tasksync-chat/test-worker-selection.cjs`. **Expected**: `PAC-P2 EligibleReuseAndPerModeSelection: PASS`, with `PAC-P1-OneServerTwoLiveSessions` and `CAC-CY-003-WorkspaceBoundDispatchReady` PASS, exact effective selection values, and zero fallback dispatches.

### CY-004 / P3
**Cycle acceptance `CAC-CY-004-ObservableWorkerStateReady`** — **Assert**: all CY-004 member task ACs pass and operations/ledger expose current-workspace facts attributed to the dispatching main-agent turn without altering native turn credits. **Verify**: `node tasksync-chat/test-worker-observability.cjs`. **Expected**: `CAC-CY-004 ObservableWorkerStateReady: PASS`, with `AC-T010-LifecyclePollingLedger`, `AC-T011-AsyncUsageSeparatedFromTurnCap`, `AC-T012-WorkerOperationsReflectLedger`, and `AC-T013-ObservableLedgerBehavior` all PASS.  
**Phase acceptance `PAC-P3-ObservableWorkerLedgerReady`** — **Assert**: P2 and CY-004 are complete, approval remains notification-only, and reused-worker traces preserve historical/cached input while per-run elapsed/cost reset. **Verify**: `node tasksync-chat/test-worker-observability.cjs`. **Expected**: `PAC-P3 ObservableWorkerLedgerReady: PASS`, with `PAC-P2-EligibleReuseAndPerModeSelection` and `CAC-CY-004-ObservableWorkerStateReady` PASS, positive historical/cached input, new-run elapsed/cost exactly 0, and native turn-credit delta exactly 0.

### CY-005 / P4
**Cycle acceptance `CAC-CY-005-OperatorsCanObserveAndOpenSessions`** — **Assert**: all CY-005 member task ACs pass and the Workers view exposes authoritative filterable state, exact session links, effective selection, and expandable trace metrics without duplicated conversation/approval controls. **Verify**: `node tasksync-chat/test-workers-control-plane.cjs`. **Expected**: `CAC-CY-005 OperatorsCanObserveAndOpenSessions: PASS`, with `AC-T014-WorkersStateProjection`, `AC-T015-WorkersViewInteraction`, `AC-T016-WorkersControlPlanePresentation`, and `AC-T017-WorkersUiBoundary` all PASS.  
**Phase acceptance `PAC-P4-WorkersControlPlaneAccurate`** — **Assert**: P3 and CY-005 are complete and a caller can filter a worker, inspect elapsed/cost/input/output and historical/cached input, and open its exact live session. **Verify**: `node tasksync-chat/test-workers-control-plane.cjs`. **Expected**: `PAC-P4 WorkersControlPlaneAccurate: PASS`, with `PAC-P3-ObservableWorkerLedgerReady` and `CAC-CY-005-OperatorsCanObserveAndOpenSessions` PASS and exactly one fixture session-open payload match.

### CY-006 / P5
**Cycle acceptance `CAC-CY-006-FeatureAcceptanceComplete`** — **Assert**: all CY-006 member task ACs pass and the complete eight-operation workflow integrates recovery, retirement, protected prune, selection, trace, and dispatch-turn attribution. **Verify**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs`. **Expected**: `CAC-CY-006 FeatureAcceptanceComplete: PASS`, with `AC-T018-ReloadRecovery`, `AC-T019-RetirementBoundary`, `AC-T020-InactiveOnlyArchivePrune`, and `AC-T021-EndToEndAsyncWorkerFlow` all PASS.  
**Phase acceptance `PAC-P5-RecoveryRetirementPruneAndE2EComplete`** — **Assert**: P4 and CY-006 are complete and all P0-P5 caller-visible evidence is reproducible without worker ask/respond or unavailable-selection fallback. **Verify**: `node tasksync-chat/test-async-subagent-runner-e2e.cjs`. **Expected**: `PAC-P5 RecoveryRetirementPruneAndE2EComplete: PASS`, with `PAC-P4-WorkersControlPlaneAccurate` and `CAC-CY-006-FeatureAcceptanceComplete` PASS, operation count exactly 8, and zero ask/respond/fallback dispatches.

## CY-007: P6 Orchestrator Delegation and Live Provider Acceptance

### T022 [Policy] `tasksync-chat/src/extension.ts`
**Context**: The orchestrator must direct work without reading or editing implementation code itself.  
**Scope**: Register an orchestrator profile whose resolved tool policy denies implementation-code read/edit and permits planning, worker-control, skills/memory, internet, SharePoint, architecture MCP, and evidence verification.  
**Dependencies**: `CAC-CY-006-FeatureAcceptanceComplete`.  
**Acceptance `AC-T022-OrchestratorToolPolicy`** — **Assert**: the resolved orchestrator policy denies both implementation-code read and edit requests and allows each of the seven named capability groups. **Verify**: `node tasksync-chat/test-orchestrator-delegation.cjs`. **Expected**: `EV-022 OrchestratorToolPolicy: PASS`, with exactly 2 denied implementation-code operations, exactly 7 allowed capability groups, and zero implementation-code operations executed.  
**Demo**: `node tasksync-chat/test-orchestrator-delegation.cjs` reports `EV-022 OrchestratorToolPolicy: PASS`.

### T023 [Routing] `tasksync-opencode/src/sessionManager.ts`
**Context**: Delegation requires bounded decomposition and complete packets rather than implicit worker context.  
**Scope**: Build a bounded task graph, loop research results into orchestration, select mode/profile/adapter/model/thinking without fallback, assemble packet v2, synthesize worker results, and dispatch independent verification.  
**Dependencies**: T022.  
**Acceptance `AC-T023-DecompositionRoutingAndPacket`** — **Assert**: one bounded graph routes an unresolved input through research before synthesis, records all five selection dimensions, emits a complete packet v2, and sends the synthesized result to a distinct verification node. **Verify**: `node tasksync-chat/test-orchestrator-delegation.cjs`. **Expected**: `EV-023 DecompositionRoutingAndPacket: PASS`, with exactly 3 nodes (research, synthesis, verification), exactly 1 research feedback edge, packet version exactly 2, zero missing required packet fields, zero fallback selections, and verification worker ID different from the producing worker ID.  
**Demo**: `node tasksync-chat/test-orchestrator-delegation.cjs` reports `EV-023 DecompositionRoutingAndPacket: PASS`.

### T024 [Capture] `tasksync-chat/src/extension.ts`
**Context**: Durable discoveries belong in different stores according to their audience and authority.  
**Scope**: Select skill, memory, user-approved ADR, or operational/product documentation through an explicit capture policy.  
**Dependencies**: T023.  
**Acceptance `AC-T024-DurablePatternCapturePolicy`** — **Assert**: representative reusable procedure, remembered fact, approved architectural decision, and operational/product guidance each route to exactly one correct destination, while an unapproved ADR request is refused. **Verify**: `node tasksync-chat/test-orchestrator-delegation.cjs`. **Expected**: `EV-024 DurablePatternCapturePolicy: PASS`, with exactly 4 accepted captures mapped one each to skill, memory, user-approved ADR, and operational/product docs, exactly 1 unapproved ADR refusal, and zero ambiguous or duplicate destinations.  
**Demo**: `node tasksync-chat/test-orchestrator-delegation.cjs` reports `EV-024 DurablePatternCapturePolicy: PASS`.

### T025 [Test] `tasksync-chat/test-orchestrator-delegation.cjs`
**Context**: Deterministic acceptance must catch policy, graph, packet, and accounting regressions without provider access.  
**Scope**: Exercise orchestrator denial, decomposition/routing, packet completeness, bounded budgets, and dispatching-turn attribution through caller-visible contracts.  
**Dependencies**: T022-T024.  
**Acceptance `AC-T025-DeterministicOrchestratorDelegation`** — **Assert**: fixture-driven orchestration enforces the denied operations, completes the three-node route with a complete packet, stops at configured limits, and attributes every worker usage record to the dispatching turn. **Verify**: `node tasksync-chat/test-orchestrator-delegation.cjs`. **Expected**: `EV-025 DeterministicOrchestratorDelegation: PASS`, with all EV-022 through EV-024 predicates PASS, exactly 1 elapsed-limit refusal, exactly 1 run-limit refusal, exactly 1 cost-limit refusal, and 3 of 3 worker usage records carrying the exact dispatching turn ID.  
**Demo**: `node tasksync-chat/test-orchestrator-delegation.cjs` reports `EV-025 DeterministicOrchestratorDelegation: PASS`.

### T026 [LiveE2E] `tasksync-chat/test-opencode-live-provider-e2e.cjs`
**Context**: Mock usage cannot prove that the configured OpenCode provider returns billable usage or that warm reuse accounting is correct.  
**Scope**: Run an explicitly enabled, timeout/run/cost-bounded real OpenCode LLM test with the configured cheaper model and environment-provided credentials only; classify unmet prerequisites as SKIP, never PASS.  
**Dependencies**: T025 and explicit `ASKAWAY_RUN_LIVE_OPENCODE_E2E=1`, configured cheaper provider/model, available OpenCode server/provider authentication, and positive timeout/run/cost limits.  
**Acceptance `AC-T026-RealProviderUsageAndReuse`** — **Assert**: two real submissions reuse one worker, receive real provider responses, persist nonzero `step_finish` usage/cost, attribute both runs to the dispatching turn, retain historical input on the second run, and reset second-run elapsed/cost before provider completion; missing prerequisites produce SKIP and no synthetic response can pass. **Verify**: `ASKAWAY_RUN_LIVE_OPENCODE_E2E=1 node tasksync-chat/test-opencode-live-provider-e2e.cjs`. **Expected**: `EV-026 RealProviderUsageAndReuse: PASS` only with exactly 2 real provider responses, exactly 2 terminal provider `step_finish` events, input tokens >0, output tokens >0, total cost >0, 2 of 2 records carrying the exact dispatching turn ID, second-run historical input >0, and second-run initial elapsed and cost exactly 0; otherwise output is `EV-026 RealProviderUsageAndReuse: SKIP` for unmet prerequisites or FAIL for an executed predicate failure.  
**Demo**: `ASKAWAY_RUN_LIVE_OPENCODE_E2E=1 node tasksync-chat/test-opencode-live-provider-e2e.cjs` reports PASS with the exact nonzero provider fields, or SKIP when a named prerequisite is absent.

### T027 [Eval] `tasksync-chat/evals/run-evals.cjs`
**Context**: Worker prompts need tuning evidence, not impressions.  
**Acceptance `AC-T027-WorkerEvals`** — **Assert**: every one of the 10 modes has at least one live case graded only by deterministic predicates; read-only modes prove no file changed against a pre-run baseline; `code` passes hidden inputs that a special-cased fix would fail; `verify` rejects a failing command; every run records real `step_finish` tokens, cost, and the profile prompt hash. **Verify**: `node tasksync-chat/test-eval-graders.cjs`, then `node tasksync-chat/evals/run-evals.cjs --suite workers --live`. **Expected**: `EV-EVALS GraderRejections: PASS` and `EVALS workers: fail=0`, with every SKIP carrying an explicit prerequisite reason.

### T028 [Eval] `tasksync-chat/evals/orchestrator-cases.json`
**Context**: The orchestrator's planning quality is the main cost lever and must be measurable per model.  
**Acceptance `AC-T028-OrchestratorEvals`** — **Assert**: the orchestrator prompt, run planning-only with every tool denied, returns a plan that splits multi-part goals into parallel tracks, completes every packet field, keeps light modes on the light tier, justifies any heavy tier, keeps trivial goals small, and pairs every mutating packet with an independent `verify` packet. **Verify**: `node tasksync-chat/evals/run-evals.cjs --suite orchestrator --live [--model <id>]`. **Expected**: `EVALS orchestrator: fail=0` for the selected model, with per-case cost recorded.

### T029 [LiveTest] `tasksync-chat/test-worker-lifecycle-live.cjs`
**Context**: Each worker operation must be proven on its own against a real worker, so a regression names the broken operation.  
**Dependencies**: T008, T012.  
**Acceptance `AC-T029-LifecyclePiecewise`** — **Assert**: start returns a non-terminal handle; status reflects it; wait returns `STILL_RUNNING` at the 240s ceiling; cancel stops it; submit reuses a warm session; resume returns the handle or a fresh-submission requirement; logs return facts only; unavailable selection refuses with zero dispatches; queued work is visible and cancellable before it starts. **Verify**: `node tasksync-chat/test-worker-lifecycle-live.cjs --live`. **Expected**: one `EV-029 <operation>: PASS` line per operation, or an explicit SKIP naming the missing prerequisite before any provider request.

## CY-007 / P6 Gates

**Cycle acceptance `CAC-CY-007-OrchestratorDelegationAccepted`** — **Assert**: all five CY-007 member task ACs pass, including the opt-in real-provider AC, and the orchestrator delegates without implementation-code access. **Verify**: run `node tasksync-chat/test-orchestrator-delegation.cjs` and `ASKAWAY_RUN_LIVE_OPENCODE_E2E=1 node tasksync-chat/test-opencode-live-provider-e2e.cjs`. **Expected**: `CAC-CY-007 OrchestratorDelegationAccepted: PASS`, with exactly 5 of 5 AC-T022 through AC-T026 predicates PASS, zero implementation-code operations executed by the orchestrator, and zero SKIP results.  
**Phase acceptance `PAC-P6-OrchestratorDelegationAndLiveProviderAccepted`** — **Assert**: P5 and CY-007 are complete, deterministic orchestration evidence passes, and a bounded real-provider run proves usage, attribution, and reuse accounting. **Verify**: run `node tasksync-chat/test-orchestrator-delegation.cjs` and `ASKAWAY_RUN_LIVE_OPENCODE_E2E=1 node tasksync-chat/test-opencode-live-provider-e2e.cjs`. **Expected**: `PAC-P6 OrchestratorDelegationAndLiveProviderAccepted: PASS`, with `PAC-P5-RecoveryRetirementPruneAndE2EComplete` PASS, `CAC-CY-007-OrchestratorDelegationAccepted` PASS, exactly 2 real provider responses, nonzero input/output/cost, and zero SKIP results.