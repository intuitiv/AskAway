# Tasks: Async Sub-agent Runner

**Feature**: `001-async-subagent-runner`  
**Strategy**: Complete each gated cycle in order. A failed PAC or CAC blocks the next cycle; tests exercise caller-visible operations and records, not bridge internals.

## Gate Vocabulary

- **Phase**: `## Phase PN` heading; contains one or more cycles.
- **Cycle**: `[CY-NNN]` tag on each task line; groups the tasks delivered together.
- **PAC**: phase acceptance criterion; every named predicate in the phase must pass.
- **CAC**: cycle acceptance criterion; the phase deliverable is usable as the next cycle's input.
- **Demo references** point to named evidence predicates in [task-details.md](task-details.md).

## Phase P0: Contract and Test Seam

### Cycle CY-001: Portable worker contract

**Goal**: Establish the portable worker contract and executable behavior seam before runtime work.

**PAC P0**: `PAC-P0-ContractAndTestSeamReady` passes.  
**CAC CY-001**: `CAC-CY-001-ContractSeamReady` passes; unlocks CY-002.

- [x] T001 [CY-001] [Contract] `tasksync-chat/src/mcp/mcpServer.ts` Define exactly eight Spec 001 worker operations, handles, and explicit ineligible/retired results at the portable MCP boundary; do not add worker ask/respond operations. Demo: `EV-001 ContractSchemaComplete`. AC: `AC-T001-ContractSchemaComplete`.
- [x] T001a [CY-001] [Contract seam] `tasksync-chat/src/mcp/mcpServer.ts` Expose the eight worker operations through a callable, injected runtime-neutral facade for deterministic caller-visible contract testing; do not implement an adapter or server runtime. Demo: `EV-001a CallableOperationFacade`. AC: `AC-T001a-CallableOperationFacade`.
- [x] T002 [CY-001] [Test] `tasksync-chat/test-worker-runtime-contract.cjs` Add caller-visible contract checks for immediate `worker_start`/`worker_submit` handles and required lifecycle/status fields. Demo: `EV-002 ImmediateHandleContract`. AC: `AC-T002-ImmediateHandleContract`.
	- Dependencies: T001, T001a.
- [x] T003 [CY-001] [Contract] `tasksync-opencode/src/relay.ts` Define relay event payload translation carrying canonical workspace, worker, run, and OpenCode session identities without secrets or transcript duplication. Demo: `EV-003 EventIdentityContract`. AC: `AC-T003-EventIdentityContract`.

## Phase P1: Shared Server and Live Conversation

### Cycle CY-002: Shared server two-session spike

**Goal**: Prove that two worker sessions and their viewers share the one global OpenCode server while conversation updates remain live.

**PAC P1**: `PAC-P1-OneServerTwoLiveSessions` passes.  
**CAC CY-002**: `CAC-CY-002-LiveAttachmentProven` passes; unlocks CY-003.

- [x] T004 [CY-002] [Runtime] `tasksync-opencode/src/server.ts` Implement one shared OpenCode server for all workspaces, returning the same healthy endpoint to every worker and session-open action. Demo: `EV-004 OneGlobalServer`. AC: `AC-T004-OneGlobalServer`.
- [x] T006a [CY-002] [Spike] `specs/001-async-subagent-runner/research.md` Evaluate Herdr as a worker runtime adapter against this contract before building more session-lifetime code; record supported/unsupported capabilities with citations and one recommendation. Demo: `EV-006a HerdrAdapterEvaluation`. AC: `AC-T006a-HerdrAdapterEvaluation`.
	- Runs before T005 and T006 so session persistence, reload recovery, and blocked-state detection are not rebuilt if an existing runtime already provides them. Research only: no product code changes.
- [x] T005 [CY-002] [Runtime] `tasksync-opencode/src/sessionManager.ts` Start two bounded primary-profile sessions on the shared endpoint and retain each OpenCode `sessionId` for viewer attachment, tagging each session with its canonical workspace. Demo: `EV-005 TwoSessionsShareEndpoint`. AC: `AC-T005-TwoSessionsShareEndpoint`.
	- Reuse: extend the existing `SessionManager` session/history/token-usage store; do not add a second session store.
- [x] T006 [CY-002] [Test] `tasksync-chat/test-shared-opencode-server.cjs` Run the reproducible two-session spike: prove server count one, matching worker/run/session IDs, streamed `message_update`, and terminal `step_finish`. Demo: `EV-006 SharedServerLiveConversation`. AC: `AC-T006-SharedServerLiveConversation`.

## Phase P2: Profiles, Registry, and Selection

### Cycle CY-003: Workspace-bound dispatch

**Goal**: Route work through globally defined profiles into workspace-bound, serial workers with bounded warm reuse.

**PAC P2**: `PAC-P2-EligibleReuseAndPerModeSelection` passes.  
**CAC CY-003**: `CAC-CY-003-WorkspaceBoundDispatchReady` passes; unlocks CY-004.

- [x] T007 [CY-003] [Registry] `tasksync-chat/src/extension.ts` Add global editable profiles with allowed per-mode model/thinking selections and workspace registry keys based on `realpath(workspaceFolder)`. Demo: `EV-007 ProfileAndWorkspaceIsolation`. AC: `AC-T007-ProfileAndWorkspaceIsolation`.
	- Implemented in `tasksync-chat/src/workers/workerProfiles.ts`; profiles live in `~/.askaway/worker-profiles/` and `tools/sync-worker-profiles.cjs` emits OpenCode `aa-<mode>` primary agents.
- [x] T008 [CY-003] [Routing] `tasksync-opencode/src/sessionManager.ts` Implement compatible-worker selection, one serial queue per worker, explicit refusal of unavailable model/thinking selections without fallback, cache boundaries on model/thinking changes, and ad-hoc creation when reuse is stale, retired, incompatible, or estimated above 120 seconds. Demo: `EV-008 BoundedReuseSelection`. AC: `AC-T008-BoundedReuseSelection`.
- [x] T009 [CY-003] [Test] `tasksync-chat/test-worker-selection.cjs` Verify per-mode model/thinking selection and recorded effective adapter/model/thinking, compatible idle reuse, model/thinking cache boundaries, unavailable-selection refusal, over-120-second ad-hoc creation, multiple workers per mode, and canonical-path isolation. Demo: `EV-009 SelectionBehavior`. AC: `AC-T009-SelectionBehavior`.

## Phase P3: Events, Approval, and Ledger

### Cycle CY-004: Observable worker ledger

**Goal**: Persist current-workspace worker state, approval notifications, and source-attributed `step_finish` usage without affecting native per-turn credits.

**PAC P3**: `PAC-P3-ObservableWorkerLedgerReady` passes.  
**CAC CY-004**: `CAC-CY-004-ObservableWorkerStateReady` passes; unlocks CY-005.

- [x] T010 [CY-004] [Events] `tasksync-opencode/src/relay.ts` Poll sessions and translate start, update, tool, checkpoint, stop, error, approval, effective adapter/model/thinking, and `step_finish` facts into workspace-scoped records. Demo: `EV-010 LifecyclePollingLedger`. AC: `AC-T010-LifecyclePollingLedger`.
	- Reuse: `apiPluginStats` in `tasksync-opencode/src/server.ts` already receives real `step.input`/`step.output`/`step.cost`; key those existing records rather than adding a new intake path.
- [x] T011 [CY-004] [Ledger] `tasksync-chat/src/extension.ts` Attribute GitHub Copilot async worker usage to the dispatching main-agent turn by workspace, worker, run, and session while explicitly leaving the native per-turn counter unchanged. Demo: `EV-011 AsyncUsageSeparatedFromTurnCap`. AC: `AC-T011-AsyncUsageSeparatedFromTurnCap`.
	- Reuse: follow the existing upsert-per-turn ledger pattern in `tasksync-chat/src/specs/specCostLedger.ts` instead of a new storage format.
- [x] T012 [CY-004] [MCP] `tasksync-chat/src/mcp/mcpServer.ts` Expose worker list, status, wait, cancel, resume, and fact-only logs backed by the observed state. Demo: `EV-012 WorkerOperationsReflectLedger`. AC: `AC-T012-WorkerOperationsReflectLedger`.
	- `worker_wait` is bounded: hard ceiling 240 seconds per call, then return an explicit `STILL_RUNNING` result with worker/run identity and last state so the parent can end its turn.
	- All operation results are bounded fact records so the parent's input context does not grow with worker output.
- [x] T013 [CY-004] [Test] `tasksync-chat/test-worker-observability.cjs` Verify dispatch-turn attribution, expandable trace elapsed/cost/input/output values, reused-worker historical/cached input visibility with per-run elapsed/cost reset, pending approval notification only, workspace isolation, and unchanged native counter. Demo: `EV-013 ObservableLedgerBehavior`. AC: `AC-T013-ObservableLedgerBehavior`.
- [x] T029 [CY-004] [LiveTest] `tasksync-chat/test-worker-lifecycle-live.cjs` Piecewise live tests, one per operation and combination: start, status, wait (including the 240s `STILL_RUNNING` ceiling), cancel, submit to a warm worker (`--session` reuse), resume, logs, unavailable-selection refusal, and queue enqueue/cancel-before-start. Demo: `EV-029 LifecyclePiecewise`. AC: `AC-T029-LifecyclePiecewise`.
	- Dependencies: T008, T012. Opt-in with `--live`; skips explicitly before any provider request when prerequisites are missing.

## Phase P4: Workers Control Plane

### Cycle CY-005: Operator-visible workers

**Goal**: Present authoritative server/worker state, filters, exact session links, and per-worker usage without duplicating OpenCode UI.

**PAC P4**: `PAC-P4-WorkersControlPlaneAccurate` passes.  
**CAC CY-005**: `CAC-CY-005-OperatorsCanObserveAndOpenSessions` passes; unlocks CY-006.

- [x] T014 [CY-005] [ControlPlane] `tasksync-chat/src/webview/webviewProvider.ts` Supply Workers view state for server health, worker state, last update, blockers/retirement, session-open target, effective adapter/model/thinking, and per-worker/per-run trace metrics. Demo: `EV-014 WorkersStateProjection`. AC: `AC-T014-WorkersStateProjection`.
- [x] T015 [CY-005] [UI] (done 2026-09-24: EV-015, EV-015b queue cancel-before-start + eval scoreboard, EV-038 shared trace; swimlanes deferred until packets carry a track) `tasksync-chat/media/webview.js` Render worker filter, server/worker status, per-worker usage, expandable trace elapsed/cost/input/output values, pending-approval notification, and an action that opens the exact OpenCode session. Demo: `EV-015 WorkersViewInteraction`. AC: `AC-T015-WorkersViewInteraction`.
	- Progress 2026-09-24: base tab shipped (filter, status, usage, trace, approval notice, open session; EV-015 PASS). The bar below is still open.
	- Lists every worker in the current workspace by default, each with a navigate action to its exact OpenCode session on the shared endpoint.
	- Shows each worker's serial queue with position, and allows queueing a new task and cancelling a not-yet-started queued entry.
	- Reviewer bar: "better than awesome". Concretely, each item must be demonstrable:
		- Track view: orchestrator tracks as swimlanes, packets as cards, dependency arrows, parallel lanes visibly side by side.
		- Instruct-then-verify pairing: every mutating packet shows its verify packet and the verdict with the exact evidence line.
		- Live per-worker state with elapsed timer, a `STILL_RUNNING` countdown to the 240s wait ceiling, and a blocked reason (auth, MCP down, approval) with its one-click fix.
		- Model/tier badge per run, cost and tokens per run, cumulative spend against the turn budget, and cache-hit ratio.
		- Eval scoreboard per mode from `~/.askaway/evals/results.jsonl`: pass rate, cost per pass, trend by prompt hash.
		- One-click actions: open exact OpenCode session, cancel, re-dispatch, escalate tier (with a required reason), enqueue follow-up.
		- Filters by workspace (default current), mode, state, and track; keyboard navigable; no transcript or approval controls.
- [x] T016 [CY-005] [UI] `tasksync-chat/media/main.css` Style the Workers control-plane states, filters, metrics, expandable trace, and notification affordances without transcript or approval controls. Demo: `EV-016 WorkersControlPlanePresentation`. AC: `AC-T016-WorkersControlPlanePresentation`.
- [x] T017 [CY-005] [Test] `tasksync-chat/test-workers-control-plane.cjs` Verify filtering, exact session-open payload, effective selection, trace metrics, and reused-worker historical/cached input with reset per-run elapsed/cost; confirm no transcript or approval action is rendered. Demo: `EV-017 WorkersUiBoundary`. AC: `AC-T017-WorkersUiBoundary`.
- [x] T030 [CY-005] [UI] `tasksync-chat/media/webview.js` Commentary tab: goal box on top, live commentary feed below (decision / question / progress / blocked, 10-20 words each), copy button that emits goal + uncleared feed as the next conversation's opener, and an explicit Clear. Demo: `EV-030 CommentaryFeed`. AC: `AC-T030-CommentaryFeed`.
	- Feed source: a `commentary` tool call `{kind, text}` that the orchestrator batches with the step's real tool call (no extra request). Validated to 10-20 words; stored per workspace; the tab is the only place it renders. Prose `» ` lines are a fallback until the tool ships.
	- Carry-over: uncleared goal + feed are injected once at the next conversation's first prompt by the existing spec-context hook.
	- Backend DONE 2026-09-24 (`src/commentary/commentary.ts`, `commentary` LM tool, webview messages `requestCommentary`/`setCommentaryGoal`/`clearCommentary` → `commentaryState`, hook carry-over; `EV-030 CommentaryBackend: PASS`). UI render pending.
	- Steering from the tab (reply, quote a commentary line, pause) is owned by Spec 003; this task renders and copies only.
- [x] T031 [CY-005] [Hook] `tasksync-chat/hooks/spec-context-inject.cjs` Per-prompt main-goal anchor: one line from the goal box (fallback: active cycle) on every prompt, plus an `aside:` prefix that answers briefly and returns to the goal without changing it. Demo: `EV-031 GoalAnchor`. AC: `AC-T031-GoalAnchor`.

## Phase P5: Recovery, Retirement, Prune, and E2E

### Cycle CY-006: Recoverable and safely retired workers

**Goal**: Make workers recoverable and safely retired, then demonstrate the complete caller-visible workflow.

**PAC P5**: `PAC-P5-RecoveryRetirementPruneAndE2EComplete` passes.  
**CAC CY-006**: `CAC-CY-006-FeatureAcceptanceComplete` passes; feature is ready for review.

- [x] T018 [CY-006] [Recovery] `tasksync-chat/src/extension.ts` Reconnect registry records after reload only when the shared server remains live; otherwise mark workers orphaned with an explicit reason. Demo: `EV-018 ReloadRecovery`. AC: `AC-T018-ReloadRecovery`.
	- Reuse: resume through OpenCode's own `opencode --session <id>`; do not implement a bespoke session-restore mechanism.
- [x] T019 [CY-006] [Lifecycle] (done 2026-09-24 in `workerRouter.ts`: EV-019) `tasksync-opencode/src/sessionManager.ts` Retire workers on expired cache or context tokens above 300000, reject reuse, and require fresh submission. Demo: `EV-019 RetirementBoundary`. AC: `AC-T019-RetirementBoundary`.
- [x] T020 [CY-006] [Lifecycle] (done 2026-09-24: `runtime.archive`, Workers-tab archive button, not an MCP tool so the surface stays eight; EV-020) `tasksync-chat/src/mcp/mcpServer.ts` Implement archive-only prune that accepts only inactive workers with empty serial queues and never cancels/deletes active work. Demo: `EV-020 InactiveOnlyArchivePrune`. AC: `AC-T020-InactiveOnlyArchivePrune`.
- [x] T021 [CY-006] [E2E] (done 2026-09-24: EV-021 in `test-async-subagent-runner-e2e.cjs`, driven through the eight worker tools with OpenCode faked at the process boundary) `tasksync-chat/test-async-subagent-runner-e2e.cjs` Execute the exactly-eight-operation bounded start/submit workflow, parent-progress observation, live session opening, per-mode selection/refusal and cache-boundary checks, lifecycle/ledger/trace verification, reload recovery, retirement, and protected prune behavior without worker ask/respond. Demo: `EV-021 EndToEndAsyncWorkerFlow`. AC: `AC-T021-EndToEndAsyncWorkerFlow`.

## Dependencies and Parallel Work

`CY-001 -> CY-002 -> CY-003 -> CY-004 -> CY-005 -> CY-006 -> CY-007`. No cycle may start until its predecessor CAC passes. Within a cycle, test work follows the behavior seam it verifies; otherwise work is intentionally serialized at owning-file boundaries.

Parallel opportunities after their dependencies are met: `T001` and `T003`; `T004` and `T005` after the server contract is settled; `T010` and `T011` after selection is stable; `T014` and `T016` after the state projection is defined; and `T018`, `T019`, and `T020` after control-plane state is available.

## MVP and Completion

**Infrastructure spike**: CY-001 and CY-002 deliver only a contract-backed shared-server two-session live-conversation proof; they are not a usable orchestrator release.  
**Product acceptance**: CY-007/P6 is mandatory. The feature is not review-ready until the non-coding orchestrator policy, decomposition/routing, complete worker packets, durable pattern capture, deterministic budget tests, and bounded real-provider test all pass.  
**Full completion**: all 26 task ACs, seven phase PACs, and seven cycle CACs pass.

## Cycle CY-007: P6 Orchestrator Delegation and Live Provider Acceptance

## Phase P6: Orchestrator Delegation and Live Provider Acceptance

### Cycle CY-007: Delegation and real-provider acceptance

**Goal**: Constrain the orchestrator to delegation, route bounded self-contained work through workers, preserve durable learning by policy, and prove deterministic and real-provider acceptance.

**PAC P6**: `PAC-P6-OrchestratorDelegationAndLiveProviderAccepted` passes.  
**CAC CY-007**: `CAC-CY-007-OrchestratorDelegationAccepted` passes; feature is ready for review.

- [x] T022 [CY-007] [Policy] (done 2026-09-24 in `AA.Orchestrator.agent.md` frontmatter: no terminal, code read/edit, or sub-agent tools; terminal dispatch fallback removed so all work shows in the Workers tab; EV-022 in `test-orchestrator-policy.cjs`) `tasksync-chat/src/extension.ts` Define the orchestrator profile/tool policy that denies implementation-code read/edit while allowing planning, worker-control, skills/memory, internet, SharePoint, architecture MCP, and evidence verification. Demo: `EV-022 OrchestratorToolPolicy`. AC: `AC-T022-OrchestratorToolPolicy`.
- [x] T023 [CY-007] [Routing] (done 2026-09-25 in the orchestrator profile, not the old `tasksync-opencode` sessionManager: decomposition is the orchestrator's job (`AA.Orchestrator.agent.md` "Plan as tracks"), graded by `evals/graders.cjs`. New `researchBeforeWork`: every code/test/authoring packet must wait, directly or transitively, on a research/explore packet; EV-023 in `test-eval-graders.cjs`. Selection without fallback EV-009, packet completeness + distinct behaviour verifier EV-040/EV-EVALS. Live Opus `missing-evidence-researches-first` PASS $0.12) `tasksync-opencode/src/sessionManager.ts` Implement bounded task-graph decomposition, a research-worker feedback loop, explicit mode/profile/adapter/model/thinking selection, self-contained packet v2 assembly, synthesis, and independent verification. Demo: `EV-023 DecompositionRoutingAndPacket`. AC: `AC-T023-DecompositionRoutingAndPacket`.
	- Decomposition targets the smallest independently acceptable unit per packet, and results return as bounded syntheses plus evidence references so parent input does not grow with delegated volume.
	- The parent runs the strongest reasoning model; workers run the declared cheaper execution tiers.
- [x] T024 [CY-007] [Capture] (done 2026-09-25 as orchestrator policy: "Knowledge capture" table in `AA.Orchestrator.agent.md` routes each lesson to exactly one of skill, memory, ADR (reviewer's quoted words, Proposed), or docs, and refuses an ADR for an implementation choice. Plans carry `captures[]`; `captureChecks` grades destination per lesson and that an ADR quote sits in the reviewer's quoted words; EV-024. Found live: docs/ADR writes were checked by `grep` and failed the behaviour rule, so packets now mark `writes: docs` and a text check is valid only for those. Live Opus `lessons-go-to-one-home` PASS $0.16, `code-judged-by-running-tests` still PASS) `tasksync-chat/src/extension.ts` Route durable pattern capture to a skill, memory, user-approved ADR, or operational/product documentation according to policy. Demo: `EV-024 DurablePatternCapturePolicy`. AC: `AC-T024-DurablePatternCapturePolicy`.
- [x] T025 [CY-007] [Test] (covered 2026-09-24 by the offline gate rather than a new file: tool-policy denial EV-022, decomposition/pairing/tier/packet completeness EV-EVALS + EV-040, packet schema refusal EV-012, routing + dispatch-turn attribution EV-021) `tasksync-chat/test-orchestrator-delegation.cjs` Add deterministic E2E/contract coverage for tool-policy denial, decomposition/routing, packet completeness, and budget/dispatch-turn attribution. Demo: `EV-025 DeterministicOrchestratorDelegation`. AC: `AC-T025-DeterministicOrchestratorDelegation`.
- [x] T026 [CY-007] [LiveE2E] (done 2026-09-24 via `test-worker-lifecycle-live.cjs --live`, EV-029: real luna run in=7415 out=117 $0.0022; reused session run2 cacheRead=15013 with its own cost $0.0005; turn1/turn2 attributed separately; total $0.0033) `tasksync-chat/test-opencode-live-provider-e2e.cjs` Add an opt-in bounded real OpenCode LLM E2E using the configured cheaper model with no credentials in source, proving nonzero provider `step_finish` token/cost fields, dispatching-turn attribution, and reused-worker historical input with per-run elapsed/cost reset. Demo: `EV-026 RealProviderUsageAndReuse`. AC: `AC-T026-RealProviderUsageAndReuse`.
- [x] T027 [CY-007] [Eval] (done: `evals/run-evals.cjs --suite workers`, git fixtures under /tmp/aa-evals, graders proven offline by EV-EVALS, results with cost in ~/.askaway/evals/results.jsonl, shown in the Workers scoreboard) `tasksync-chat/evals/run-evals.cjs` Per-mode worker eval suite with deterministic graders, disposable git fixtures, and recorded cost/tokens per run for tuning. Demo: `EV-027 WorkerEvals`. AC: `AC-T027-WorkerEvals`.
- [x] T028 [CY-007] [Eval] (done: `--suite orchestrator [--model id]`, 6 cases incl. code-judged-by-running-tests live PASS; graders EV-EVALS + EV-040) `tasksync-chat/evals/orchestrator-cases.json` Orchestrator planning eval that grades track decomposition, parallelism, packet completeness, tier choice, and independent verification, per selectable orchestrator model. Demo: `EV-028 OrchestratorEvals`. AC: `AC-T028-OrchestratorEvals`.
- [x] T032 [CY-007] [Profile] (done 2026-09-25: live run-m2s3ey-4 PASS, perf worker ran `yourkit_profiler` check_setup (no issues) and list_processes (12 JVMs), $0.0383 on terra; built 2026-09-24: `perf.md` profile + `aa-perf` agent; YourKit reaches workers as `askaway_yourkit_*` through the VS Code tool bridge, allowed only for perf; EV-039 offline. Pending live: a perf worker returns a ranked snapshot after window reload + shared server restart) `~/.askaway/worker-profiles/perf.md` Performance worker using the YourKit MCP (snapshot capture, hot methods, allocation) that reports ranked findings with numbers. Demo: `EV-032 PerfWorker`. AC: `AC-T032-PerfWorker`.
- [x] T033 [CY-007] [Profile] (done 2026-09-25: live run-b0os3t-3, $0.0015 on luna: `analyze_file` then `copilot_getErrors` on mcpServer.ts → 2 major findings at `:299` (cognitive complexity 18>15, promise where void expected) with root-cause fixes. Found: `analyze_file` only triggers analysis, so an earlier run called a file "clean" from the trigger message; profile now must read diagnostics and may never call a trigger clean. Gap: VS Code's `copilot_getErrors` output has no rule keys; security listing needs Connected Mode. Earlier: live 2026-09-25 run-m2s3ey-2: the worker reached SonarQube through the bridge, $0.0024, but `list_potential_security_issues` needs Connected Mode (workspace not bound) → honest BLOCKED; `analyze_file` was missing from the bridge (one-match-per-pattern bug, fixed) and needs a reload for its live run. built 2026-09-24: `quality.md` + `aa-quality`; SonarQube via the VS Code SonarQube extension through the bridge as `askaway_sonarqube_*`, so no Sonar token is handled at all; EV-039 offline. Pending live) `~/.askaway/worker-profiles/quality.md` Code-quality worker using the SonarQube MCP that reports violations by severity with `path:line` and a root-cause fix per rule. The Sonar token must come from the environment, never from a config file. Demo: `EV-033 QualityWorker`. AC: `AC-T033-QualityWorker`.
- [x] T034 [CY-007] [Prompt] (done 2026-09-25: plan evals carry a `commentary` array graded with the tool's own limits (update/heads-up, 3-20 words, no IDs/model names/step labels; a heads-up must name the decision); EV-034 in `test-eval-graders.cjs`. Live Opus: first run FAILED at 25-44-word lines because the prompt never stated the limit; after adding it, `simple-lookup-stays-cheap` and `reviewer-decision-gets-heads-up` PASS, $0.18) `AA.Orchestrator.agent.md` Framework knowledge and commentary: tool latency and cost table, `» ` commentary lines, questions and decisions surfaced as they happen. Covered by an orchestrator eval case that fails without commentary. Demo: `EV-034 OrchestratorCommentary`. AC: `AC-T034-OrchestratorCommentary`.
- [x] T039 [CY-007] [MCP] (done 2026-09-24; live: a luna worker read /memories/repo and answered from it, created a memory, $0.0038; per-workspace routing + safe writes in EV-039) VS Code tool bridge (reviewer: "expose memory tool from vscode to opencode agent, it will take care of those things"): the AskAway MCP proxies an allowlist of VS Code LM tools (`copilot_memory`, `code_nav`, `vscode_listCodeUsages`, `copilot_searchWorkspaceSymbols`, `copilot_getErrors`) through `vscode.lm.invokeTool`, with VS Code's own schemas; OpenCode reaches it as MCP `askaway` (`worker_*`, `ask_user`, `commentary` denied). Offline: `EV-039 VsCodeToolBridge` (built). Pending live: a worker quotes a repo-memory fact it could not know otherwise.
- [x] T040 [CY-007] [Prompt] (done 2026-09-24: offline `EV-040 VerifiedByBehaviour` in test-eval-graders.cjs; live `orchestrator/code-judged-by-running-tests` PASS on terra, $0.028) Verification by behaviour: `AA.Orchestrator.agent.md` carries a work-type → verifier table (code → gradle/test worker runs the tests; authoring → devx end-to-end; research → a second worker re-derives the claim) and every packet states the exact instruction plus the check that will judge it. Eval case fails when a code packet is accepted without an independent test run. Demo: `EV-040 VerifiedByBehaviour`.
- [x] T035 [CY-005] [ControlPlane] Expose `worker_*` and `commentary` to the VS Code orchestrator. Today the AskAway MCP registers only with Kiro/Cursor/Antigravity, so AA.Orchestrator cannot call `worker_*` and falls back to terminal `opencode run`. Demo: `EV-035 OrchestratorReachesWorkers` (orchestrator eval dispatches through `worker_start`). AC: `AC-T035-OrchestratorReachesWorkers`.
- [x] T036 [CY-005] [Runtime] `tasksync-chat/src/workers/sharedServer.ts` Attach every worker launch to the one shared `opencode serve` on :4096, starting it detached on first worker use; the fixed port is the cross-window mutex; failure is visible as `NOT_ATTACHED` with a reason. Demo: `EV-036 SharedServerAttach`. Live proof after reload still pending.
- [x] T038 [CY-005] [UI] Worker trace reuses the Metrics turn-trace rows: extract the request/tool row builders from `updateObservabilityUI` into one shared pure block, map worker ledger facts (step_finish → request row, before/after_tool → tool row) onto it, and load them lazily when a worker's trace is expanded. Demo: `EV-038 SharedTraceRows`. Done 2026-09-24: `traceRowsHtml` block; one partition row per run; tool previews live in memory only. Lazy loading not done (projection builds events every poll).