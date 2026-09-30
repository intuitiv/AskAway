---
description: "Task list for 005 Spec Kit Guided Flow"
---

# Tasks: Spec Kit Guided Flow

**Input**: `specs/005-speckit-guided-flow/` — spec.md, plan.md (Decision Register D-1…D-21; later stories under `## Later`), data-model.md, contracts/, research.md

**Branch provenance**: generated on `main` at `1fc06d1`; implementation lands on one active PR per story (plan D-12).

**Tests**: Required (repo rule: every behaviour ships an outside-in test in `npm run test:workers`).

**Budget**: `tools/task-budget.cjs` allows 12 open tasks and 6 per group; US3–US7 stay in plan.md `## Later` until US1–US2 close.

**Paths**: code paths are under `tasksync-chat/`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Sample-repo fixture builder `test-fixtures/specs-sample.cjs` (specs at every stage, legacy cycle spec, optional git history)
- [ ] T002 [P] Track `.askaway/specs/` in git and ignore `.askaway/specs/*/cloud/` in `.gitignore` (plan D-17; waits for reviewer confirmation)

---

## Phase 2: Foundational

- [x] T003 [P] `src/specs/stages.ts` (stage order, next step, button, implied stage, mismatch) with `test-spec-stages.cjs` in `test:workers`
- [x] T004 [P] `src/specs/runRecords.ts` (write-once files, allow-list, skipped count, facts) with `test-spec-run-records.cjs` in `test:workers`
- [x] T005 Scanner (`src/specs/specKitScanner.ts`) exposes `task.tags`, `task.story`, `specKitStage`, `stageSource`, `impliedStage`, `mismatch`, `nextStep`, `stageButton`, `facts`

**Checkpoint**: stage and run-record modules usable by every story.

---

## Phase 3: User Story 1 — Stage tracking and next step (P1) 🎯 MVP

**Goal**: every spec shows its stored stage, action button, `/sk.check`, next step, mismatches and stale artifacts.

**Independent Test**: spec.md US1 — fixture specs at each stage render stage/button/`/sk.check`/next step; an uncommitted upstream edit marks the downstream artifact stale; a stored stage past a missing artifact is flagged.

- [x] T006 [P] [US1] `src/specs/staleness.ts` (D-6, D-7: one `git log --name-only` + `git status --porcelain` per spec, ancestry compare, `unavailable` outside git) wired into the scanner as `spec.stale[]`, with `test-spec-staleness.cjs` (US1 scenarios 3 and 4) in `test:workers`
- [x] T007 [US1] Stage bar in the Specs tab: `renderStageBar` in `media/webview.js` (stage, stage button, `/sk.check`, next step, mismatch + stale badges), button handlers in `media/webview.js` (`act === 'sk'`) prefilling the `/sk.*` command; card badge shows the Spec Kit stage (derived `stage` kept only for the Completed filter); extend `test-specs-webview-regression.cjs` for US1 scenarios 1, 2 and 5

**Checkpoint**: US1 Independent Test passes; SC-001, SC-002 checked; story PR ready.

---

## Phase 4: User Story 2 — Stories as phases everywhere (P1)

**Goal**: task lists, wrappers and the Specs tab use Setup / Foundational / US1…USn / Polish; old cycle specs still render.

**Independent Test**: spec.md US2.

- [ ] T008 [P] [US2] Story model + story groups: `spec.stories[]` in the scanner (headings `Phase N: User Story N - <title> (Priority: Pn)` and `[USn]` tags, Independent Test from spec.md, SCs from `Verified by:`), `renderStoryGroup` in `media/webview.js`; `tools/task-budget.cjs` budgets per story instead of per cycle; `test-spec-stories.cjs` in `test:workers`
- [ ] T009 [P] [US2] Rewrite `SPEC_KIT_PROMPTS` in `src/specs/specKitPromptAssets.ts` to the story structure (remove `acceptance`, `categories`, `gates` and every CY/PAC/CAC demand; D-18), regenerate user prompt copies; assert in `test-spec-planning-contract.cjs` that wrapper text has no `CY-`/`PAC-`/`CAC-` and names Setup, Foundational, `[USn]`, Polish

**Checkpoint**: US2 Independent Test passes; SC-003 checked.

---

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2 → (plan.md `## Later`: US3–US7, Polish).
- `media/webview.js` has one writer at a time: T007 before T008.
- `[P]` pairs safe for two build workers: T006 ‖ T009.
