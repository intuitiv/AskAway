---
description: "Task list for 005 Spec Kit Guided Flow"
---

# Tasks: Spec Kit Guided Flow

**Input**: `specs/005-speckit-guided-flow/` — spec.md, plan.md (Decision Register D-1…D-21), data-model.md, contracts/, research.md

**Branch provenance**: generated on `main` at `1fc06d1`; implementation lands on one active PR per story (plan D-12).

**Tests**: Required (repo rule: every behaviour ships an outside-in test in `npm run test:workers`).

**Paths**: all code paths are under `tasksync-chat/`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [ ] T001 Create sample-repo fixture builder `tasksync-chat/test-fixtures/specs-sample.cjs`: temp git repo with specs at stages specify/plan/tasks/implement, one legacy `CY-NNN` spec, and helpers to commit/dirty a file
- [ ] T002 [P] Track `.askaway/specs/` in git: add `!.askaway/specs/` exception (and `.askaway/specs/*/cloud/` ignore for 006) to `.gitignore` (plan D-17)

---

## Phase 2: Foundational

**⚠️ No story work before this phase passes.**

- [ ] T003 [P] Implement `src/specs/stages.ts`: `SPEC_STAGES`, `nextStep`, `stageButton`, `impliedStage(artifacts)`, `stageMismatch` per data-model.md table and plan D-1, D-3, D-4, D-5
- [ ] T004 [P] Implement `src/specs/runRecords.ts`: `appendRunRecord` (unique file name, write-once, allow-listed fields), `readRunRecords` (skip malformed, count skipped), `specFacts(records)` (stored stage, branch, PR, sums) per contracts/run-record.schema.json and D-2, D-15
- [ ] T005 Extend `parseTasks` in `src/specs/specKitScanner.ts` to expose `task.tags[]` and `task.story` from `[...]` markers (D-21); keep `cycleId`
- [ ] T006 Test `test-spec-stages.cjs` (+ add to `test:workers`): each fixture spec yields the expected implied stage, next step and button; stored `tasks` with no `tasks.md` reports a mismatch naming both stages
- [ ] T007 Test `test-spec-run-records.cjs` (+ `test:workers`): two records written in the same millisecond produce two files; totals equal the sum; a malformed file is skipped and counted

**Checkpoint**: stage and run-record modules usable by every story.

---

## Phase 3: User Story 1 — Stage tracking and next step (P1) 🎯 MVP

**Goal**: every spec shows its stored stage, action button, `/sk.check`, next step, mismatches and stale artifacts.

**Independent Test**: spec.md US1 — fixture specs at each stage render stage/button/`/sk.check`/next step; uncommitted upstream edit marks downstream stale and a mismatch is flagged.

- [ ] T008 [P] [US1] Implement `src/specs/staleness.ts`: artifact ranks from one `git log --name-only` + `git status --porcelain` per spec, ancestry compare, dependency graph (D-6, D-7), `unavailable` when not a git repo
- [ ] T009 [US1] Wire stage into `scanSpecs` in `src/specs/specKitScanner.ts`: replace `deriveStage` with stored-or-implied stage, add `impliedStage`, `stageSource`, `mismatch`, `stale[]`, `facts` (reads run records via T004)
- [ ] T010 [US1] Render stage bar in `media/webview.js` (`renderStageBar`: stage, stage button, `/sk.check` button, next step, mismatch and stale badges) and its message handlers in `src/webview/webviewProvider.ts` (buttons send the matching `/sk.*` command to chat)
- [ ] T011 [US1] Test `test-spec-staleness.cjs` (+ `test:workers`): US1 scenarios 3 and 4 (plan committed after tasks → tasks stale; dirty spec → plan stale), non-git root → `unavailable`
- [ ] T012 [US1] Extend `test-specs-webview-regression.cjs`: stage bar for scenarios 1–2 and All/Completed switch scenario 5 (10 specs, 3 completed)

**Checkpoint**: US1 Independent Test passes; SC-001, SC-002 checked.

---

## Phase 4: User Story 2 — Stories as phases everywhere (P1)

**Goal**: task lists, wrappers and the Specs tab use Setup / Foundational / US1…USn / Polish; old cycle specs still render.

**Independent Test**: spec.md US2.

- [ ] T013 [P] [US2] Parse stories in `src/specs/specKitScanner.ts`: `spec.stories[]` from `## Phase N: User Story N - <title> (Priority: Pn)` headings and `[USn]` tags; Independent Test text from spec.md; SC mapping from `Verified by:` (D-14)
- [ ] T014 [P] [US2] Rewrite `SPEC_KIT_PROMPTS` in `src/specs/specKitPromptAssets.ts` to the story structure; remove `acceptance`, `categories`, `gates` constants and every `CY-`/`PAC`/`CAC` requirement (D-18); regenerate the user prompt copies
- [ ] T015 [US2] Render story groups in `media/webview.js` (`renderStoryGroup`: title, priority, done/total, Independent Test, checkpoint result) reusing the existing phase row styles; legacy cycle specs keep the cycle renderer
- [ ] T016 [US2] Test `test-spec-stories.cjs` (+ `test:workers`): 3-story fixture → phases in order with Independent Test; US1 4/6 progress; legacy cycle spec renders without error
- [ ] T017 [US2] Test in `test-spec-planning-contract.cjs` (existing): generated wrapper text contains no `CY-`, `PAC-`, `CAC-` tokens and names Setup, Foundational, `[USn]`, Polish

**Checkpoint**: US2 Independent Test passes; SC-003 checked.

---

## Phase 5: User Story 3 — Plain text drives the flow (P2)

**Goal**: plain messages route to direct change or the right stage; extension flows report the stored stage.

**Independent Test**: spec.md US3.

- [ ] T018 [P] [US3] Create `tools/spec-facts.cjs` per contracts/spec-facts-cli.md (uses compiled scanner + run records)
- [ ] T019 [P] [US3] Add routing rules (D-8 thresholds, continue-from-stored-stage) to the AskAway Build agent text and `SPEC_KIT_PROMPTS` (`sk.continue`, `sk.handoff`); `/pr-daily` prompt and `tools/pr-daily-facts.cjs` read `spec-facts.cjs`
- [ ] T020 [US3] Routing eval set `evals/routing-cases.json` (10 labelled messages: direct change / specify / continue) + grader in `evals/graders.cjs`
- [ ] T021 [US3] Test `test-spec-facts-cli.cjs` (+ `test:workers`): CLI stage equals scanner stage for every fixture spec; unknown slug exits 2

**Checkpoint**: US3 Independent Test passes; SC-004 (eval ≥ 9/10), SC-005 checked.

---

## Phase 6: User Story 4 — Per-spec facts (P2)

**Goal**: runs write records; the card shows branch, PR, stage, cost, agent time; Telegram carries cost + tokens.

**Independent Test**: spec.md US4.

- [ ] T022 [US4] Stop-hook writer in `src/extension.ts` hook script: at turn end append one run record for the active spec (cost from existing Copilot aggregation, agentMs, branch, PR, stageAfter from the wrapper's marker line)
- [ ] T023 [P] [US4] Worker runs append a run record on finish (`src/workers/openCodeRuntime.ts`, cost from `step_finish`)
- [ ] T024 [P] [US4] One-time import of `specCostLedger` rows into `imported-<date>.json` per spec (D-16) in `src/specs/runRecords.ts`
- [ ] T025 [US4] Render facts on the card (`renderSpecFacts`: branch, active PR or "no PR", stage, cost AIU, agent time) in `media/webview.js`
- [ ] T026 [US4] Test `test-spec-facts-card.cjs` (+ `test:workers`): two concurrent run writers → two files, card totals = sum; card shows all five facts; Telegram status line from `telegramLive.ts` contains cost and tokens

**Checkpoint**: US4 Independent Test passes; SC-006, SC-007 checked.

---

## Phase 7: User Story 5 — Story completion and PR flow (P2)

**Goal**: checkpoint verify worker; PR ready only on pass; one active PR.

**Independent Test**: spec.md US5.

- [ ] T027 [US5] Implement `src/specs/checkpoint.ts`: build verify packet (Independent Test + mapped SCs), start `verify` worker, write `checkpoint` run record; BLOCKED when the test cannot run
- [ ] T028 [US5] Active PR via `gh` (D-12, D-13): `activePr(slug)`, open draft PR at story start, `gh pr ready` on PASS; warning when two open PRs
- [ ] T029 [US5] Test `test-spec-checkpoint.cjs` (+ `test:workers`) with stubbed worker and `gh`: PASS → ready; FAIL → not ready, failing check named; BLOCKED when test missing; new story → new active PR

**Checkpoint**: US5 Independent Test passes; SC-008 checked.

---

## Phase 8: User Story 6 — Orchestrator runs the flow (P3)

**Goal**: code-enforced dispatch: ≤2 build workers per track, disjoint files, scope check, gate evidence.

**Independent Test**: spec.md US6.

- [ ] T030 [US6] Admission in `src/workers/workerRouter.ts` per contracts/dispatch-packet.md (track cap, glob overlap queue, `allowedPaths` required for build)
- [ ] T031 [P] [US6] `scopeCheck(base, head, allowedPaths)` in `src/workers/workerRouter.ts` (or `src/workers/scopeCheck.ts`)
- [ ] T032 [P] [US6] Orchestrator PreToolUse guard (compound terminal command → deny with "use a build worker") installed by `src/extension.ts` (D-19)
- [ ] T033 [US6] Orchestrator agent text: story order, `/sk.check` at each gate, acceptance = scope check + integrated gate + named evidence
- [ ] T034 [US6] Test `test-orchestrator-dispatch.cjs` (+ `test:workers`): three `[P]` tasks → 2 running, overlapping one queued; out-of-scope change rejected; `start` returns runId without waiting

**Checkpoint**: US6 Independent Test passes; SC-009, SC-010 checked.

---

## Phase 9: User Story 7 — Readiness at the done gate (P3)

**Goal**: converge readiness summary identical on Specs tab, Telegram, PR text.

**Independent Test**: spec.md US7.

- [ ] T035 [US7] Implement `src/specs/readiness.ts` (`readinessLines`; PASS without evidence → BLOCKED) and write `readiness` into the converge run record
- [ ] T036 [US7] Use `readinessLines` in the Specs tab (`renderReadiness`), `telegramLive.ts`, and the `/pr-daily` PR text
- [ ] T037 [US7] Test `test-readiness-surfaces.cjs` (+ `test:workers`): unavailable tool → BLOCKED with reason; three surfaces produce identical lines

**Checkpoint**: US7 Independent Test passes; SC-011, SC-012 checked.

---

## Phase 10: Polish

- [ ] T038 [P] Storybook stories for `renderStageBar`, `renderStoryGroup`, `renderSpecFacts`, `renderReadiness` in `storybook/stories/`
- [ ] T039 [P] README section "Guided flow" in `tasksync-chat/README.md`
- [ ] T040 Run quickstart.md end to end; deploy locally; record proof

---

## Dependencies & Execution Order

- Setup → Foundational → US1 → (US2 ‖ US4) → US3 (needs US1) → US5 (needs US2, US4) → US6 (needs US2) → US7 (needs US4) → Polish.
- One writer for `media/webview.js`: T010, T015, T025, T036, T038 run sequentially.
- One writer for `specKitScanner.ts`: T005 → T009 → T013.
- `[P]` pairs safe for two build workers: T003‖T004, T008‖(none in webview), T013‖T014, T018‖T019, T023‖T024, T031‖T032.

## Implementation Strategy

MVP = Setup + Foundational + US1, merged through the first story PR. Then one story per PR in the order above.
