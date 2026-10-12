---

description: "Task list for 007 Validator Agent"
---

# Tasks: Validator Agent

**Input**: Design documents from `/specs/007-validator-agent/`

**Prerequisites**: plan.md (approved by the reviewer 2026-10-02), spec.md, research.md, data-model.md, contracts/, quickstart.md, checklists/

**Tests**: Requested by repo rule (AGENTS.md): every behaviour task includes its outside-in test, written from the caller's view; each new `test-validator-*.cjs` is added to `test:workers` in `tasksync-chat/package.json`. Gate: `npm --prefix tasksync-chat run test:workers`.

**Organization**: Tasks are grouped by user story. Budget check: `node tasksync-chat/tools/task-budget.cjs specs/007-validator-agent/tasks.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 to US6)

## Path Conventions

Extension code in `tasksync-chat/src/`, tests as `tasksync-chat/test-*.cjs`, evals in `tasksync-chat/evals/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Resolve the agentmemory unknowns before any knowledge-store work.

- [x] T001 agentmemory spike 2026-10-07: real local 0.9.30, zero-LLM, local embeddings configured, provider keys unset; remember 201/id and agentId verified, project not persisted, search mostly lexical with no documented scope filters, no verified version/history contract; import strategy=skip worked, consolidation disabled confirmed. Findings and limits in research.md R-1, based on `.askaway/analyst/agentmemory-spike.cjs` and saved README/routes. Reviewer: "Lets keep them under an interface and use agentmemory for now. We can migrate to others if needed." GO for append-only ledger-owned scope/history and agentmemory search index; no claim of an all-green upstream spike. Auto-forget/decay and occupied-port lifecycle remain T011; restart/network-isolation limits recorded in research. Adapter evidence EV-KNOWLEDGE-STORE proves retained hidden superseded versions without guessing upstream APIs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared pieces every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Secret redaction and records: `tasksync-chat/src/validator/redact.ts` wraps the existing `CREDENTIAL_ANYWHERE` pattern in `tasksync-chat/src/commentary/commentary.ts` (a non-exported const today: export it, do not copy it; no worker-transcript redaction exists, R-6) and drops the whole item when uncertain (FR-016), applied to the reviewer's reply, the observed response and the sources read and `tasksync-chat/src/validator/records.ts` (append-only jsonl under `.askaway/specs/<slug>/validator/`: responses, predictions, `index.jsonl`; data-model.md); test `tasksync-chat/test-validator-records.cjs` (secrets seeded in reply, response and a source reach no sink: agentmemory body, jsonl, Commentary, cost; records round-trip). Done 2026-10-06, EV-VALIDATOR-RECORDS (`node test-validator-records.cjs`, in test:workers); `redactOrDrop`/`redactRecordOrDrop` drop the whole item on any credential match; records carry optional `workerId`/`sessionId` (analyze N3).
- [x] T003 [P] Reuse points, three small edits. (1) Commentary in `tasksync-chat/src/commentary/commentary.ts`: keep `COMMENTARY_KINDS` (`update`/`heads-up`) as the agent-facing enum so the MCP `commentary` tool and `post()` keep refusing kind `validator`; widen `CommentaryItem.kind` to `CommentaryKind | 'validator'`, add optional `detail`, and add a separate internal `CommentaryStore.postValidator()` that is not an MCP tool (20-word cap stays on `update`/`heads-up` only, R-3; A2). (2) `SpecCostTurn` in `tasksync-chat/src/specs/specCostLedger.ts` gains optional backward-compatible `source`, `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens` (R-4); validator runs use `turnKey` `validator:<responseId>` so `recordSpecTurn` (upsert by turnKey+specSlug) never overwrites the observed turn's row (A3). (3) A read-only validator profile in `tasksync-chat/src/workers/workerProfiles.ts` with portable fields purpose, model, prompt, MCP tool policy (no send-to-agent tool), file scope, stop condition, evidence contract (R-5, A18); test `tasksync-chat/test-validator-foundation.cjs` (MCP `commentary` tool schema and `post()` REJECT kind `validator`; `postValidator` stores it with `detail`; banner total includes the validator row once and the observed row stays; old rows without `source` still total; profile has no send tool). Done 2026-10-06, EV-VALIDATOR-FOUNDATION (`node test-validator-foundation.cjs`, in test:workers). Deviations: profile lives in `src/validator/profile.ts` (workerProfiles.ts was out of the packet's scope); validator items are stored in `CommentaryState.validatorItems`, not `items`, because the conversation hook and `buildOpener` inject `items` into the agent's prompt (beta isolation), and `commentaryView` merges them for the tab.

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Observer answers the agent's question, with its cost (Priority: P1) 🎯 MVP

**Goal**: Every agent/worker response is observed; questions are answered from the active spec's sources in Commentary only, with cost in the shared banner.

**Independent Test**: Sample spec whose Rules.md decides X: a covered question gets a cited answer with observations/summary/impact in Commentary, an uncovered one is reported unanswerable, the agent received nothing, and the banner cost rose.

- [x] T004a [US1] Observer in `tasksync-chat/src/validator/observer.ts`: cheap check (R-2, skip counted and visible in Commentary stats, A15), `observe()` answering from Goal.md, Rules.md, spec, ADRs, memories with cited source or "no source answers" (FR-001 to FR-005, FR-019), run through the worker run port with failures shown, not blocking (FR-014, FR-017); test `tasksync-chat/test-validator-observer.cjs` (covered/uncovered/no-question/worker response cases, banner cost rose once, beta isolation: agent-send surface untouched, R-7, validator failure does not block). Done 2026-10-07, EV-VALIDATOR-OBSERVER (`node test-validator-observer.cjs`, in test:workers); records and lifecycle events (`onEvent`: start/stop/error) carry the validator run's workerId/sessionId (analyze N3); skips are counted in `stats()` and post no entry; an answer without a provided cited source becomes "no source answers". Its per-response cheap check is superseded by T004c's three triggers (reviewer A15, 2026-10-07).
- [x] T004b [US1] Commentary validator entry per `contracts/commentary-validator-entry.md` (rendered through the shared trace-row block, written via `postValidator` from T003) with a Storybook story in `tasksync-chat/storybook/`; test `tasksync-chat/test-validator-commentary-entry.cjs` (render output contains the shared trace-row output, validator item after an `update` item, a failed run shows an error entry) (depends on T004a). Done 2026-10-07, EV-VALIDATOR-COMMENTARY-ENTRY (`node test-validator-commentary-entry.cjs`); validator details render through `traceRowsHtml`; story `storybook/stories/ValidatorCommentary.stories.js` (ok, no-source, error).
- [x] T004c [US1] Wire Validator triggers, applying the superseding GOALS.md decisions of 2026-10-12: turn start stores the previous whole final paired with the user response without a model call; routine messages/commentary are stored without calls; questions and Validator mentions invoke it; turn end runs one batch containing the current AITalk conversation and whole final; direct memory answers return only to the caller. Done 2026-10-12: `rtk node tasksync-chat/test-validator-triggers.cjs` → PASS EV-VALIDATOR-TRIGGERS and EV-VALIDATOR-AITALK-BATCH; `test-validator-session-per-turn.cjs` guards persisted reuse <30 minutes and inclusive 100K input/no pings; `test-aitalk-presence.cjs` guards mention/reply routing. The older exactly-three-triggers and immediate turn-start model-call wording is superseded, not implemented against the newer cost rule.

- [x] T004d [US1] Agent-called validator tool askaway_validator, output to Commentary only (tool first, reviewer 2026-10-08) — test-validator-tool.cjs

**Checkpoint**: User Story 1 is functional and testable independently

---

## Phase 4: User Story 2 - Close the loop on the reviewer's reply and store knowledge (Priority: P2)

**Goal**: The reviewer's reply plus the previous response reach the validator alongside the agent flow, never blocking delivery; prediction match is recorded and shown; new rules are stored in agentmemory per spec/story/task.

**Independent Test**: Reply with a decision differing from the prediction and containing a rule: mismatch recorded, rule stored with the spec, a fresh agent's question cites it.

- [x] T005 [US2] KnowledgeStore port in `tasksync-chat/src/validator/knowledgeStore.ts` and REST search-index adapter in `agentmemoryStore.ts`, per reviewer decision and T001 findings in research.md (supersedes unverified server filter/evolve assumptions in the older contract). Redacted append-only `ValidatorRecords` index owns facts, project/agentId/spec scope, versions/history; remember concepts include `project:`/`spec:`/`story:`/`task:`, recall post-filters and hides superseded IDs; constructor-injected Bearer secret never enters bodies/logs/records, index outages throw visibly. Done 2026-10-07, EV-KNOWLEDGE-STORE; `rtk node tasksync-chat/test-knowledge-store.cjs` passes against a fake HTTP server: project/agent/spec isolation, supersede/history after reopening, secret gate and server-down errors. No package.json edit in this packet.
- [x] T006 [US2] `closeLoop()` in `tasksync-chat/src/validator/observer.ts`: pair processed alongside the agent flow without blocking delivery (FR-006; A4), prediction vs reply match shown in Commentary (FR-007, FR-021), extraction of rules/instructions/goals/examples (FR-008), "ok" stores nothing, unrelated reply stores nothing (depends on T004a, T004b, T005); test `tasksync-chat/test-validator-close-loop.cjs` (end to end: slow validator does not delay agent receipt, rule stored then cited by a fresh observer run; FR-018 isolation: no validator output reaches chat input, worker input, an MCP tool result or prompt text). Done 2026-10-08: `rtk node tasksync-chat/test-validator-close-loop.cjs` → `PASS EV-VALIDATOR-CLOSE-LOOP: slow validator never delays agent receipt; mismatch shown and scoped knowledge stored`; fresh-observer citation and FR-018 PASS; observer, tool and commentary-entry regression tests PASS; TypeScript no errors. Deterministic fakes only; package.json unchanged.

**Checkpoint**: User Stories 1 AND 2 work independently

---

## Phase 5: User Story 3 - Prompt enhancement (Priority: P3)

**Goal**: Commentary shows proposed context for a prompt; each addition is dismissible; the agent's prompt is unchanged.

**Independent Test**: With stored rules, a short prompt shows proposed additions, one removed, agent prompt byte-identical.

- [x] T007 [US3] `proposeContext()` in `tasksync-chat/src/validator/observer.ts` using KnowledgeStore recall (depends on T005 and T006: same file `observer.ts`, so sequential), dismissal via the existing Commentary clear behaviour (FR-009); test `tasksync-chat/test-validator-propose-context.cjs` (proposal shown, dismiss works, nothing relevant means no proposal, named context not duplicated, prompt byte-identical, FR-018 isolation: no proposal reaches an agent input). Evidence (2026-10-10): `rtk node tasksync-chat/test-validator-propose-context.cjs` → `PASS EV-VALIDATOR-PROPOSE-CONTEXT all T007 cases`; scoped recall, duplicate suppression across fresh observers, clear dismissal retained in audit history, secret/foreign-scope exclusion, no model run. Observer and close-loop regressions PASS; `rtk npx tsc -p tasksync-chat --noEmit` clean. No availability/live-gating or package.json changes.

**Checkpoint**: User Stories 1 to 3 work independently

---

## Phase 6: User Story 4 - Knowledge stays small: dedup and concision (Priority: P4)

**Goal**: One canonical entry per fact; reversed decisions supersede; long replies stored concisely.

**Independent Test**: Same rule from two replies and an ADR line leaves one entry loaded once; a reversal loads only the new statement.

- [x] T008 [US4] Dedup, supersede and concision rules in `tasksync-chat/src/validator/knowledgeStore.ts` (FR-010, FR-011; stored knowledge never expires automatically, FR-020; depends on T005 and T001 supersede finding); test `tasksync-chat/test-validator-dedup.cjs` (restated rule stored once, ADR plus memory loaded once, reversal replaces and flags changed, long reply stored concisely). Done 2026-10-07, EV-VALIDATOR-DEDUP (`node test-validator-dedup.cjs`); test-knowledge-store.cjs still green.

**Checkpoint**: User Stories 1 to 4 work independently

---

## Phase 6b: User Story 6 - One memory store for all agents (Priority: P6)

**Next priority (reviewer 2026-10-07)**: T012 then T013, ahead of validator T004c/T006/T007. Full memory replacement removes seeded md memory content from the conversation; agents pull through the memory tool. How md files stop being auto-loaded: mechanism pending reviewer choice.

**Goal**: One local-only agentmemory server, started by AskAway, replaces `/memories` md files for Copilot agents and OpenCode workers; the validator shares it by agentId (FR-023 to FR-026).

Reviewer: "agentmemory is replacement for all memory needs. Validator also uses it." + "Do it in 007. We have to many specs. It belongs there." + "Askaway starts it like we start opencode server." + "Yes" to local-only. D22: "we dont use or update them going forward" — user/repo md seed once, then no reads or updates. History: "keep older versions also, hide them".

**Independent Test**: With no server running, a first memory call starts one detached local-only server; a second window attaches; seeded facts are readable by a Copilot-side agent and an OpenCode worker through MCP; md files are untouched.

- [x] T011 [US6] Server lifecycle in `tasksync-chat/src/validator/memoryServer.ts`, modelled on the shared OpenCode server start/attach: first use starts one detached server, port as cross-window mutex, env scrubbed of `OPENAI_API_KEY` and provider keys, local embeddings, auto-forget and consolidation off (FR-024, FR-025); test `tasksync-chat/test-memory-server-lifecycle.cjs` (second caller attaches, no second process, spawned env has no provider key, flags off, `/health` failure visible). Done 2026-10-07, EV-MEMORY-SERVER-LIFECYCLE (`node test-memory-server-lifecycle.cjs`; reuses `workers/sharedServer.ts`; refuses a local `.env` that would reload provider keys). Not yet proven live: real-server egress and simultaneous two-window start (T012 live run).
- [x] T012 [US6] One-time seed from `/memories/` and `/memories/repo/` md files, then frozen, plus agent access through the AskAway MCP memory tools for VS Code Copilot and OpenCode workers, separated by agentId with superseded versions hidden (FR-023, FR-022; depends on T005, T008, T011); test `tasksync-chat/test-memory-seed-and-mcp.cjs` (seed once is idempotent, md files byte-identical and never read after seeding, a Copilot-side and an OpenCode-side call read a seeded fact and write a new one, validator items not returned to another agentId, superseded versions hidden). An agent's memory tool call is also the validator's third trigger (T004c); the requested result returns only to the calling agent, with no push into any agent input. Done 2026-10-08: offline and live against the real server (`ASKAWAY_MEMORY_LIVE=1`, throwaway projects only) PASS EV-MEMORY-SEED-MCP.
- [x] T013 [US6] Switch agent and worker prompts and profiles from `/memories` to the store (FR-026; depends on T012); test `tasksync-chat/test-memory-prompts-switched.cjs` (no shipped prompt, agent definition or profile names `/memories` paths; they name the memory tools; the conversation's injected memory text shrinks to zero md memory content after the switch). Mechanism (reviewer, 2026-10-08): remove the VS Code memory tool from the agents' tool lists so agents use the AskAway memory tool. Done 2026-10-08 after reload: `ASKAWAY_MEMORY_LIVE=1 node test-memory-seed-and-mcp.cjs` PASS EV-MEMORY-REAL-SEED (seed marker present, 52 hits for a seeded md fact); this AskAway Build conversation has no VS Code memory tool and no injected md memory text.

**Checkpoint**: One memory store serves agents, workers and the validator

---

## Phase 6c: User Story 7 - Live validator acts for the reviewer while away (Priority: P2)

**Goal**: Reviewer-enabled, Away-only, pull-only safe decisions (2026-10-08).
**Independent Test**: Beta when off/Here; sourced safe answers and held risky questions when Away; return digest and commentary flags.
- [x] T014 [US7] Default-off askaway.validator.live setting and workspace availability gate, timed expiry and Here beta fallback; test `tasksync-chat/test-validator-live.cjs` (FR-027). Done 2026-10-08: EV-VALIDATOR-LIVE offline.
- [x] T015 [US7] Bounded forced live answers/held, risk/reversible/confidence contract, append-only `liveDecisions.ts` records; test `tasksync-chat/test-validator-live.cjs` (FR-028, FR-029; depends T014). Done 2026-10-08: offline cases plus live run against the real OpenCode server (`ASKAWAY_VALIDATOR_LIVE=1`): answer 4 with GOALS.md source.
- [x] T016 [US7] Digest on reviewer return with decisions, sources, uncertainties and held questions; test `tasksync-chat/test-validator-digest-watch.cjs` (FR-030; depends T015). Done 2026-10-08: EV-VALIDATOR-DIGEST-WATCH offline.
- [x] T017 [US7] Watch commentary in live Away mode and flag drift/risk to reviewer only, never destructive actions; test `tasksync-chat/test-validator-digest-watch.cjs` (FR-031; depends T014). Done 2026-10-08: offline plus live (`ASKAWAY_VALIDATOR_LIVE=1`): the real validator flagged commentary that contradicts GOALS.md and stayed quiet on aligned commentary.

**Checkpoint**: Live validator safely acts for the absent reviewer and reports on return.

---

## Phase 7: User Story 5 - Evals for the validator's prompt (Priority: P5)

**Goal**: Three eval suites report results for manual beta review, without automated baseline/regression gate (reviewer: "I'll manually see them few days").

**Independent Test**: Run the eval set per suite; results are available for manual review without an automated baseline gate.

- [x] T009a [US5] Eval suites `tasksync-chat/evals/validator/` (answer, enhance, store, plus a cheap-check skip case and a secret-leak case, A16) per `contracts/validator-evals.md`, scored through `tasksync-chat/src/workers/evalScoreboard.ts`; test `tasksync-chat/test-validator-evals.cjs` (three suite results reported, skip and secret cases present). Evidence (2026-10-10): `rtk node tasksync-chat/test-validator-evals.cjs` → `PASS EV-VALIDATOR-EVALS three scoreboard results offline; negative fixtures rejected; no model call`. Eleven illustrative recorded fixtures, three isolated result rows read by the existing scoreboard, wrong decisions/citations, duplicate context/facts, prompt mutation, lost history, beta leaks and seeded secret sinks rejected. No paid run or automated baseline gate; live execution/manual quality review deferred per reviewer. package.json unchanged.
- [ ] T009b [US5] Manual quality-review results and a way to add a real reviewer correction (FR-015) in `tasksync-chat/evals/validator/`; test `tasksync-chat/test-validator-eval-baseline.cjs` (results available without automated baseline/regression gate, added correction included in later runs); wire all `test-validator-*.cjs` into `test:workers` in `tasksync-chat/package.json` (depends on T009a).
  Blocked 2026-10-12: no real reviewer quality assessment or correction was supplied; this headless worker cannot fabricate either. The required `tasksync-chat/evals/validator/` correction/run integration is outside the packet's allowed files. Existing `test-validator-evals.cjs` proves recorded three-suite results without paid calls, not manual quality acceptance. Leave open until the reviewer supplies a correction/assessment and an evals-scoped packet can test inclusion in later runs.

**Checkpoint**: All user stories are independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T010 Run `specs/007-validator-agent/quickstart.md` end to end including port/health checks, record manual beta review for provisional 60/70/80/10% targets (no automated baseline; SC-002 deferred until linking), update `tasksync-chat/docs/requirements/` rows for FR-001 to FR-026, then run the gate `npm --prefix tasksync-chat run test:workers` and `node tasksync-chat/tools/task-budget.cjs specs/007-validator-agent/tasks.md`. D19: "accept" — checklist gaps are beta limits, not blockers (spec.md Beta limits).
  Blocked 2026-10-12: live VS Code/Commentary/banner and reviewer beta assessment over real turns are unavailable headlessly; provisional 60/70/80/10% quality/cost measurements cannot be inferred from deterministic fixtures. Quickstart step 8's automated score-regression wording conflicts with the newer no-baseline decision; quickstart.md is outside packet scope. Gate executed twice (exit 1): out-of-scope `test-workers-control-plane.cjs:250` fails "an expanded row stays open across the 1s re-render". `rtk node tasksync-chat/tools/task-budget.cjs specs/007-validator-agent/tasks.md` → TASK-BUDGET 007-validator-agent: PASS open=2/12 largestCycle=US5:1/6. `rtk npx tsc -p tasksync-chat --noEmit` exits 0; deterministic Validator trigger/session/observer/evals/close-loop/context tests pass, but are not live quickstart proof. The Webex live-arrival check skipped with matched=0 and is not a pass.

---

## Dependencies & Execution Order

- **Next priority (2026-10-07)**: US6 T012 then T013 before validator T004c/T006/T007; retain their existing dependencies. The md auto-load mechanism is pending reviewer choice.
- **Setup**: T001 first; no dependencies. T005, T006, T007, T008 depend on T001 (knowledge-store tasks).
- **Foundational (T002, T003)**: can run in parallel with T001; BLOCK all user stories.
- **US1 (T004a, T004b)** need T002, T003; T004b after T004a. **US2 (T005, T006)**: T005 needs T001 and T002; T006 needs T004a, T004b and T005. **US3 (T007)** needs T005 and T006 (same file `observer.ts`, sequential). **US4 (T008)** needs T005. **US5 (T009a, T009b)** need T004a to T007; T009b after T009a.
- **US6 (T011, T012, T013)**: T011 needs T001; T012 needs T005, T008 and T011; T013 needs T012.
- **Polish (T010)** after all stories.

## Parallel Example

```text
T001 agentmemory spike  |  T002 redact+records  |  T003 postValidator + cost source + profile
After T006: T007 (US3, `observer.ts`) and T008 (US4, `knowledgeStore.ts`) in parallel
```

## Implementation Strategy

- **MVP**: T001 to T004b (spike, foundation, US1): the reviewer reads validator answers and cost in Commentary.
- **Incremental**: add US2 (learning), US3 (proposal), US4 (dedup), US5 (evals); each ships with its test and keeps `test:workers` green.
- T001 confirms the selected local-only store before T005; topology is decided (ONE server), not awaiting another reviewer choice.

## Notes

- Reused names: Commentary tab, `CommentaryStore`, `specCostLedger`, worker runtime/profiles, `evalScoreboard`.
- Beta: nothing is sent to the agent (FR-018); advisory output only.
- Never put secrets in records, store, Commentary or cost data (FR-016).
- [x] T018 [request] Cut Validator spend: store messages without model calls, reuse one Validator session per turn, add caller-view session test and requirement row within packet scope. Evidence: rtk node tasksync-chat/test-validator-session-per-turn.cjs → PASS EV-VALIDATOR-SESSION-PER-TURN: 10 messages, 2 questions, 1 batch, 1 session; new turn new session; no pings; rtk npx tsc -p tasksync-chat --noEmit → TypeScript: No errors found
