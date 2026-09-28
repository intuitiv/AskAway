# Cycles

Cycle metadata for the Specs hierarchy. Tasks join a cycle with a `[CY-NNN]` tag in `tasks.md`.

| Cycle | Title | Purpose | Verification |
|---|---|---|---|
| CY-001 | Portable worker contract | Establish the eight-operation worker contract and a callable test seam before any runtime | `node tasksync-chat/test-worker-runtime-contract.cjs` |
| CY-002 | Shared server two-session spike | Prove one global OpenCode server serves every workspace with live session updates, and evaluate an existing agent runtime before rebuilding session lifetime | `node tasksync-chat/test-shared-opencode-server.cjs` |
| CY-003 | Workspace-bound dispatch | Route profiles into workspace-bound serial workers with bounded warm reuse | `node tasksync-chat/test-worker-selection.cjs` |
| CY-004 | Observable worker ledger | Record lifecycle facts and dispatch-turn cost without changing native turn credits | `node tasksync-chat/test-worker-observability.cjs` |
| CY-005 | Operator-visible workers | Show server/worker state, filters, usage and exact session links in the Workers view | `node tasksync-chat/test-workers-control-plane.cjs` |
| CY-006 | Recoverable and retired workers | Recover after reload, retire unsafe reuse, and prune only inactive workers | `node tasksync-chat/test-async-subagent-runner-e2e.cjs` |
| CY-007 | Delegation and real-provider acceptance | Constrain the orchestrator to delegation and prove real bounded provider usage | `node tasksync-chat/test-orchestrator-delegation.cjs` |
| CY-008 | Reviewer-facing polish and control | Ships one worker tool, a per-turn folding commentary feed mirrored live to Telegram, a Storybook sample conversation, an always-visible active spec, and a hard task budget, each with its EV line | `npm --prefix tasksync-chat run test:workers` |
