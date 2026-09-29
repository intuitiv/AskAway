# Goal — 001 Async Sub-agent Runner

Let one strong-model orchestrator run for a long time at low cost by delegating real work to cheap, async OpenCode workers.

## Outcomes that define done
- **Orchestrator plans, workers work.** The main agent decomposes goals into small, independently acceptable packets across parallel tracks, dispatches them, and verifies results. It does not read code or data itself.
- **Main-agent input stays small.** Parent context does not grow with the amount of delegated work: workers return bounded syntheses plus evidence references, never transcripts or file contents.
- **Async, tiered workers.** The user picks the orchestrator model (often Opus). The orchestrator picks each worker's model by complexity and cost: GPT-5.6 Luna for light work, GPT-5.6 Terra for normal work, Opus or GPT-6 Sol only for justified hard work.
- **One shared OpenCode server for all workspaces.** Workers are workspace-bound records on it; the Workers tab is global and filters by workspace.
- **Kick-ass Workers tab.** Every worker in the workspace, its state and cost, a link to its exact OpenCode session, and a per-worker task queue with enqueue and cancel-before-start.
- **Bounded waiting.** Until the Spec 003 side channel exists, a status wait lasts at most 240 seconds, then returns `STILL_RUNNING` so the turn ends instead of burning credits.
- **Dedicated modes.** explore, research, rca, code, test, gradle, review, verify, authoring (authoring MCP + launchpad rule skills), and devx (local DevX MCP for end-to-end checks). Each is optimized for its job.
- **Real cost attribution.** Worker usage comes from OpenCode `step_finish` token, cache, and cost facts, attributed to the dispatching main-agent turn.
- **The orchestrator is the reviewer's replacement.** It thinks at the bigger picture: spins up tracks, validates results with independent workers, prepares demos, and knows how this framework behaves (which tools are slow, which blow up context, what cache windows cost). It carries the reviewer's gotchas, design intent, limits, dos and don'ts.
- **Live commentary.** The orchestrator narrates in 10-20 words per item: decisions taken, questions for the reviewer, progress, blockers. Cricbuzz-style, but short. A tab shows the live feed, with a copy button that produces the next conversation's opener; the feed doubles as an audit trail.
- **Explicit main goal.** A goal box above the commentary holds the reviewer's current main goal. The orchestrator focuses on it and treats side questions as asides. Unless cleared, goal and commentary carry into the next conversation.
- **More worker modes.** `perf` (performance analysis with the YourKit MCP tools) and `quality` (Sonar violations via the SonarQube MCP).

## Current position
- Done: P0 contract (CY-001), shared server and live two-session proof (CY-002), profiles/routing/serial queues (CY-003), real OpenCode runtime with lifecycle ledger, dispatch-turn attribution, and the eight `worker_*` MCP tools (CY-004), piecewise live lifecycle tests (T029), the Workers and Commentary tabs (CY-005), reload recovery, retirement, archive-only prune, and the end-to-end flow (CY-006), VS Code tool bridge for workers (T039), orchestrator policy, behaviour verification, perf/quality workers, commentary, research-first routing and capture policy with live evals (CY-007).
- Next: CY-008 (reviewer feedback after acceptance) is built, gated, and live-checked on Telegram (2026-09-29). Side channel is Spec 003, carry-over payload Spec 004.
- CY-007 status (2026-09-25): all tasks done (T022-T028, T032-T034, T039, T040). Decomposition and capture live in the orchestrator profile and are proven by live evals, not by code in the old tasksync-opencode sessionManager.
- Deferred: Herdr, as a possible second adapter later. Side channel belongs to Spec 003.
