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

- [x] T008 [P] [US2] Story model + story groups: `spec.stories[]` in the scanner (`### User Story N - <title> (Priority: Pn)` in spec.md, `[USn]` tags or story phase for tasks, Independent Test, SCs from `Verified by:`), Independent Test + SCs shown under each story phase by `renderSpecWork`; `test-spec-stories.cjs` in `test:workers`. Per-story task budget moved to T010.
- [x] T010 [US2] `tools/task-budget.cjs` budgets open tasks per story (`[USn]`/story phase) instead of treating all untagged tasks as one "(no cycle)" group; extend `test-task-budget.cjs`
- [ ] T009 [P] [US2] Rewrite `SPEC_KIT_PROMPTS` in `src/specs/specKitPromptAssets.ts` to the story structure (remove `acceptance`, `categories`, `gates` and every CY/PAC/CAC demand; D-18), regenerate user prompt copies; assert in `test-spec-planning-contract.cjs` that wrapper text has no `CY-`/`PAC-`/`CAC-` and names Setup, Foundational, `[USn]`, Polish

**Checkpoint**: US2 Independent Test passes; SC-003 checked.

---

## Phase 5: Pulled forward from `## Later` (worker-built)

- [ ] T011 [P] [US3] `tools/spec-facts.cjs` per contracts/spec-facts-cli.md (same scanner as the Specs tab) with `test-spec-facts-cli.cjs` in `test:workers`
- [x] T012 [P] [US7] `src/specs/readiness.ts` (`normalizeReadiness`: PASS without evidence → BLOCKED; `readinessLines` plain text shared by Specs tab, Telegram, PR text) with `test-spec-readiness.cjs` in `test:workers`

---

## Phase 6: Reviewer requests 2026-10-01 — worker transparency and parallel lanes

- [x] T013 [US6] `start` never queues behind a busy worker (reviewer: two starts queued on one worker instead of running in parallel); `submit` is the only way to queue; `submit` past the wait bound is INELIGIBLE, not RETIRED (`workerRouter.ts`, EV-008 in `test-worker-selection.cjs`)
- [x] T014 [US6] `worker` wait accepts any `timeoutSeconds` and clamps to 240 s instead of rejecting (`workerTools.ts`, `test-worker-mcp-tools.cjs`)
- [ ] T015 [US4] Worker spend in the shared chat banner and the Telegram status: current-turn worker requests and $ join the totals with the worker part shown; live turn timer; Metrics tab stays current-conversation only; trace credits shown as $ in Metrics and Workers (`usageSince`, `ObservabilityMetrics.workers/turnStartedAt`, banner block; EV-WORKER-TURN-SPEND + webview tests)
- [ ] T016 [US1] Specs and commentary polish: one next-step button (labelled "Continue" when next = current stage), one plain stale line per upstream, pastel colour per Spec Kit stage; commentary text full width with time and count on a second, right-aligned line
- [x] T017 [P] [US6] `tools/command-patterns.cjs`: terminal-command bursts, families and the requests spent between burst commands in Copilot debug logs; run on the reviewer's recent conversations and decide bash/git worker vs standalone commands (EV-COMMAND-PATTERNS). Result 2026-10-01 (5 conversations): 158 commands, 103 in bursts, 59 full-context requests between burst commands = 342 AIU; git 34%, reads 34%. Decision proposed: no git/bash worker; a deterministic checkpoint script for diff→add→commit→status, read bursts go to `explore`.
- [ ] T018 [US6] Keep a warm worker warm while the main chat is active and its knowledge fits pending work: minimal `POST /session/:id/message` ping before the 5-min TTL, ping cost in the ledger, stop at 300K context or after N unused pings (research 2026-10-01: a ping is a real request, cache read 0.1×, cold rewrite 1.25×; health checks do not refresh)
- [x] T022 [US6] Fork-for-parallel POC: a second request for a busy warm worker forks its OpenCode session and runs in parallel; verify both forks keep ~99-100% cache hits on Luna and Sonnet (`tools/poc-session-fork.cjs`); if confirmed, `submit` to a busy worker forks instead of queuing
- [x] T023 Reviewer requirements per UI component and feature in `tasksync-chat/docs/requirements/` (reviewer's quoted words, date, guarding test or `gap`); `test-requirements-docs.cjs` fails on a cited test id that does not exist (EV-REQUIREMENTS-DOCS)
- [x] T024 [US6] Command batching for the main agent (data: `tools/command-options.cjs`, option H saves 38 requests / $2.29 over 5 conversations): `tools/checkpoint.cjs` for commits (done, EV-CHECKPOINT), `tools/batch.cjs` for independent command sequences (EV-BATCH), worker `status` returns the report once finished; both agent prompts name them

---

## Phase 7: Reviewer requests 2026-10-01 — availability, handoff, validator

- [ ] T019 [US3] Availability selector "Here · Away (Telegram) · Offline until <time>" per workspace, injected by the spec-context hook. Away/Offline rules: do not stop for small choices (decide, record in a decisions list), keep every lane busy, write a handoff at the end of the session, end with a report of decisions, open questions and cost. Offline never asks; questions are parked for the report. Test: hook output per mode.
- [ ] T020 [US3] Auto-handoff near 300K input tokens while Away/Offline: write `/sk.handoff`, continue in a fresh session, Telegram notice when Away; test with a stubbed token count
- [ ] T021 Spec 007 Validator agent: `/sk.specify` from `specs/007-validator-agent/Goal.md` and `Rules.md`

---

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2 → (plan.md `## Later`: US3–US7, Polish).
- `media/webview.js` has one writer at a time: T007 before T008.
- `[P]` pairs safe for two build workers: T006 ‖ T009.
