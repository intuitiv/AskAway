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
- **[Story]**: Which user story this task belongs to (US1 to US5)

## Path Conventions

Extension code in `tasksync-chat/src/`, tests as `tasksync-chat/test-*.cjs`, evals in `tasksync-chat/evals/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Resolve the agentmemory unknowns before any knowledge-store work.

- [ ] T001 agentmemory spike, measure and report (research R-1 VERIFY items; it does NOT confirm an exemption, R-1 says none exists): against a local agentmemory server record in `specs/007-validator-agent/research.md` (a) a forced forget/consolidation/decay cycle against validator items for each FR-020 option, reported for the reviewer's choice: (a) a dedicated validator-only instance with `AUTO_FORGET_ENABLED=false` and `CONSOLIDATION_ENABLED=false` (own `--port`/`--data-dir`/`--instance`), (b) the shared instance plus a re-save job from `index.jsonl` (survives eviction, not consolidation rewrites), (c) the existing `memoryStore.ts` fallback; per option: items intact or not, wording rewritten or not, setup cost; (b) exact `/agentmemory/remember` fields (`concepts`, `agentId`, `project`) and the `/agentmemory/evolve` supersede call (answered in R-1, re-verify only), (c) project scoping in `smart-search` and the `AGENTMEMORY_AGENT_SCOPE=isolated` requirement, (d) behaviour when port 3111 is taken by another instance and the `/health` response, (e) `AGENTMEMORY_SECRET`: the server holds it in its env, the extension keeps its client copy in VS Code SecretStorage, never in files or logs. T001 only reports; the reviewer chooses (a), (b) or (c) (analyze A1) before T005. Includes a re-runnable probe `tasksync-chat/test-agentmemory-spike.cjs` that skips with a named reason when no server runs.

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

- [ ] T004a [US1] Observer in `tasksync-chat/src/validator/observer.ts`: cheap check (R-2, skip counted and visible in Commentary stats, A15), `observe()` answering from Goal.md, Rules.md, spec, ADRs, memories with cited source or "no source answers" (FR-001 to FR-005, FR-019), run through the worker run port with failures shown, not blocking (FR-014, FR-017); test `tasksync-chat/test-validator-observer.cjs` (covered/uncovered/no-question/worker response cases, banner cost rose once, beta isolation: agent-send surface untouched, R-7, validator failure does not block).
- [ ] T004b [US1] Commentary validator entry per `contracts/commentary-validator-entry.md` (rendered through the shared trace-row block, written via `postValidator` from T003) with a Storybook story in `tasksync-chat/storybook/`; test `tasksync-chat/test-validator-commentary-entry.cjs` (render output contains the shared trace-row output, validator item after an `update` item, a failed run shows an error entry) (depends on T004a).

**Checkpoint**: User Story 1 is functional and testable independently

---

## Phase 4: User Story 2 - Close the loop on the reviewer's reply and store knowledge (Priority: P2)

**Goal**: The reviewer's reply plus the previous response reach the validator first; prediction match is recorded and shown; new rules are stored in agentmemory per spec/story/task.

**Independent Test**: Reply with a decision differing from the prediction and containing a rule: mismatch recorded, rule stored with the spec, a fresh agent's question cites it.

- [ ] T005 [US2] KnowledgeStore port and agentmemory REST adapter in `tasksync-chat/src/validator/knowledgeStore.ts` per `contracts/knowledge-store.md` and the T001 outcome (depends on T001 and the reviewer's A1 choice: dedicated instance, re-save job or `memoryStore.ts`), mirroring ids in `index.jsonl`; test `tasksync-chat/test-validator-knowledge-store.cjs` against a stub server (remember tags `spec:`/`story:`/`task:`, project scoping, recall for spec A never returns spec B items via a post-filter on the `spec:` tag, health failure visible, secret from SecretStorage and never logged).
- [ ] T006 [US2] `closeLoop()` in `tasksync-chat/src/validator/observer.ts`: pair delivered before the agent (FR-006; ordering and timeout per the reviewer's A4 decision), prediction vs reply match shown in Commentary (FR-007, FR-021), extraction of rules/instructions/goals/examples (FR-008), "ok" stores nothing, unrelated reply stores nothing (depends on T004a, T004b, T005); test `tasksync-chat/test-validator-close-loop.cjs` (end to end: rule stored then cited by a fresh observer run; FR-018 isolation: no validator output reaches chat input, worker input, an MCP tool result or prompt text).

**Checkpoint**: User Stories 1 AND 2 work independently

---

## Phase 5: User Story 3 - Prompt enhancement (Priority: P3)

**Goal**: Commentary shows proposed context for a prompt; each addition is dismissible; the agent's prompt is unchanged.

**Independent Test**: With stored rules, a short prompt shows proposed additions, one removed, agent prompt byte-identical.

- [ ] T007 [US3] `proposeContext()` in `tasksync-chat/src/validator/observer.ts` using KnowledgeStore recall (depends on T005 and T006: same file `observer.ts`, so sequential), dismissal via the existing Commentary clear behaviour (FR-009); test `tasksync-chat/test-validator-propose-context.cjs` (proposal shown, dismiss works, nothing relevant means no proposal, named context not duplicated, prompt byte-identical, FR-018 isolation: no proposal reaches an agent input).

**Checkpoint**: User Stories 1 to 3 work independently

---

## Phase 6: User Story 4 - Knowledge stays small: dedup and concision (Priority: P4)

**Goal**: One canonical entry per fact; reversed decisions supersede; long replies stored concisely.

**Independent Test**: Same rule from two replies and an ADR line leaves one entry loaded once; a reversal loads only the new statement.

- [ ] T008 [US4] Dedup, supersede and concision rules in `tasksync-chat/src/validator/knowledgeStore.ts` (FR-010, FR-011; stored knowledge never expires automatically, FR-020; depends on T005 and T001 supersede finding); test `tasksync-chat/test-validator-dedup.cjs` (restated rule stored once, ADR plus memory loaded once, reversal replaces and flags changed, long reply stored concisely).

**Checkpoint**: User Stories 1 to 4 work independently

---

## Phase 7: User Story 5 - Evals for the validator's prompt (Priority: P5)

**Goal**: Three eval suites gate the validator prompt; a regression is rejected.

**Independent Test**: Run the eval set per suite; a weakened prompt lowers its suite and is reported as a regression.

- [ ] T009a [US5] Eval suites `tasksync-chat/evals/validator/` (answer, enhance, store, plus a cheap-check skip case and a secret-leak case, A16) per `contracts/validator-evals.md`, scored through `tasksync-chat/src/workers/evalScoreboard.ts`; test `tasksync-chat/test-validator-evals.cjs` (three suite results reported, skip and secret cases present).
- [ ] T009b [US5] Baseline per behaviour and a way to add a real reviewer correction (FR-015) in `tasksync-chat/evals/validator/`; test `tasksync-chat/test-validator-eval-baseline.cjs` (weakened prompt flagged as regression, added correction included in later runs); wire all `test-validator-*.cjs` into `test:workers` in `tasksync-chat/package.json` (depends on T009a).

**Checkpoint**: All user stories are independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T010 Run `specs/007-validator-agent/quickstart.md` end to end, record the first-week measurement plan for the provisional 60/70/80/10% targets (Clarifications), update `tasksync-chat/docs/requirements/` rows for FR-001 to FR-021, then run the gate `npm --prefix tasksync-chat run test:workers` and `node tasksync-chat/tools/task-budget.cjs specs/007-validator-agent/tasks.md`.

---

## Dependencies & Execution Order

- **Setup**: T001 first; no dependencies. T005, T006, T007, T008 depend on T001 (knowledge-store tasks).
- **Foundational (T002, T003)**: can run in parallel with T001; BLOCK all user stories.
- **US1 (T004a, T004b)** need T002, T003; T004b after T004a. **US2 (T005, T006)**: T005 needs T001 and T002; T006 needs T004a, T004b and T005. **US3 (T007)** needs T005 and T006 (same file `observer.ts`, sequential). **US4 (T008)** needs T005. **US5 (T009a, T009b)** need T004a to T007; T009b after T009a.
- **Polish (T010)** after all stories.

## Parallel Example

```text
T001 agentmemory spike  |  T002 redact+records  |  T003 postValidator + cost source + profile
After T006: T007 (US3, `observer.ts`) and T008 (US4, `knowledgeStore.ts`) in parallel
```

## Implementation Strategy

- **MVP**: T001 to T004b (spike, foundation, US1): the reviewer reads validator answers and cost in Commentary.
- **Incremental**: add US2 (learning), US3 (proposal), US4 (dedup), US5 (evals); each ships with its test and keeps `test:workers` green.
- T001 reports the three FR-020 options; stop before T005 until the reviewer chooses (analyze A1).

## Notes

- Reused names: Commentary tab, `CommentaryStore`, `specCostLedger`, worker runtime/profiles, `evalScoreboard`.
- Beta: nothing is sent to the agent (FR-018); advisory output only.
- Never put secrets in records, store, Commentary or cost data (FR-016).
