---
description: "Task list for 006 Cloud Tasks"
---

# Tasks: Cloud Tasks

**Input**: `specs/006-cloud-tasks/` — spec.md, plan.md (Decision Register C-1…C-22), data-model.md, contracts/, research.md

**Branch provenance**: generated on `main` at `1fc06d1`; implementation lands on the 006 story PR (one active PR per story).

**Depends on 005**: Foundational (T003–T007: stages, run records, `task.tags`) and US4/US5 active PR (T028).

**Tests**: Required. Paths are under `tasksync-chat/` unless shown.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [ ] T001 Create `src/cloud/` and settings in `package.json` contributes: `askaway.cloudTasks.enabled` (false), `pollMinutes` (3), `digestTime` ("08:00"), `agentLogins` ([])
- [ ] T002 [P] `gh` runner `src/cloud/gh.ts` with injectable exec (tests pass a fake), JSON parsing, error → typed failure (`unauthenticated`, `rate-limited`, `network`)

---

## Phase 2: Foundational

- [ ] T003 Confirm 005 Foundational is merged (stage, run records, `task.tags`); if not, stop and do 005 T003–T007 first
- [ ] T004 [P] Secret gate `secretFindings(text, knownValues)` in `src/cloud/packet.ts` (C-16)
- [ ] T005 [P] Test `test-cloud-secrets.cjs` (+ `test:workers`): each seeded pattern and a known env value are refused with the field name; clean text passes

**Checkpoint**: gh runner and secret gate ready.

---

## Phase 3: User Story 1 — Live proof of the cloud route (P1) 🎯 MVP

**Goal**: committed evidence note answering every route question; recorded signal fixture; go/no-go.

**Independent Test**: spec.md US1.

- [ ] T006 [US1] `tools/cloud-proof.cjs --pr <n> --task PROOF-1`: commits a trivial packet (append one line to `specs/006-cloud-tasks/evidence/proof-target.md`), posts the comment (C-12 template, one variant asking for a model by name), polls every 60 s up to 59 min, writes raw polls to `test-fixtures/cloud-signals-<date>.json`
- [ ] T007 [US1] Second probe in the same tool: two comments 1 min apart → record whether two sessions run concurrently (drives C-5)
- [ ] T008 [US1] Write evidence note `specs/006-cloud-tasks/evidence/proof-<date>.md` per contracts/evidence-note.md from the fixture (tool prints the table; reviewer-visible go/no-go)
- [ ] T009 [US1] Update plan C-3, C-4, C-5, C-15, C-19 with observed facts (event name, agent login, model selectability, concurrency, Actions behaviour)

**Checkpoint**: SC-001 (no "unknown" rows); SC-002 part 1 (same branch). No-go → stop for reviewer.

---

## Phase 4: User Story 2 — Flag and queue a task (P1)

**Goal**: `[cloud]`/`[local: reason]` tags from `/sk.tasks`; "Queue in cloud" writes packet, pushes, posts comment.

**Independent Test**: spec.md US2.

- [ ] T010 [P] [US2] Eligibility rules in the `/sk.tasks` prompt asset (`src/specs/specKitPromptAssets.ts`): tag every task `[cloud]` or `[local: <reason>]` (C-9)
- [ ] T011 [P] [US2] `buildPacket` / `buildComment` in `src/cloud/packet.ts` per contracts/packet.md (task details = line + sub-bullets + story Independent Test; `draft: true` for spec/plan stages)
- [ ] T012 [US2] `queueTask` + pure `refusalFor` in `src/cloud/cloudQueue.ts` (C-21 order); commit + push packet; post comment; write cloud-run file (Queued)
- [ ] T013 [US2] Specs tab task row: "Queue in cloud" button on `cloud` tags, reason tooltip on `local:` tags, state chip; model line per C-3 (`media/webview.js`, `src/webview/webviewProvider.ts`)
- [ ] T014 [US2] Test `test-cloud-queue.cjs` (+ `test:workers`) with fake gh/git: packet has 9 fields; comment ≤ 5 lines and contains no spec/plan text; each refusal fires before any write; ineligible task shows no button

**Checkpoint**: US2 Independent Test (one live queue on a real PR); SC-003, SC-004, SC-005 checked.

---

## Phase 5: User Story 3 — Status everywhere (P2)

**Goal**: poll, derive state, show on row, feed and Telegram; morning digest.

**Independent Test**: spec.md US3 (fixture replay + one live task).

- [ ] T015 [P] [US3] `pollPr` in `src/cloud/cloudPoller.ts` (C-4, C-6: ≤5 calls per poll, backoff, `staleSince`)
- [ ] T016 [P] [US3] Pure `deriveCloudState(run, signals, now, settings)` in `src/cloud/cloudState.ts` per data-model.md transitions
- [ ] T017 [US3] Feed adapter: cloud run → Workers trace-row input, rendered by existing `traceRowsHtml` (C-20)
- [ ] T018 [US3] Telegram: state changes in live status; `digestLines` in `src/cloud/cloudDigest.ts` + daily send at `digestTime` (C-18), no price
- [ ] T019 [US3] Test `test-cloud-state.cjs` (+ `test:workers`): replay the US1 fixture → recorded state sequence; poll failure keeps state with `staleSince`; digest lists PR, evidence, duration, model, blocker, decision and no currency symbol; feed HTML contains `traceRowsHtml` output

**Checkpoint**: US3 Independent Test passes; SC-006, SC-007 checked.

---

## Phase 6: User Story 4 — Accept only after local verification (P2)

**Goal**: verify worker re-runs packet commands on the pulled branch; tick or return.

**Independent Test**: spec.md US4.

- [ ] T020 [US4] `acceptCloudTask` in `src/cloud/cloudAccept.ts`: worktree at PR head, `verify` worker packet, pure `outOfScope(paths, allowed)`, Status-line change check (C-13, C-14)
- [ ] T021 [US4] On pass: tick task in `tasks.md`, write 005 run record, commit + push (main process); on fail: Returned with failing output
- [ ] T022 [US4] Test `test-cloud-accept.cjs` (+ `test:workers`) on two git fixtures: passing commit → Accepted + ticked; failing → Returned + tasks.md unchanged; out-of-scope file → Returned listing it

**Checkpoint**: US4 Independent Test passes; SC-008 checked; SC-009 live run (3 tasks overnight) scheduled.

---

## Phase 7: User Story 5 — Safety, conflicts and ceilings (P3)

**Goal**: overlap holds, conflict detection, ceilings, merge block.

**Independent Test**: spec.md US5.

- [ ] T023 [P] [US5] Overlap/one-at-a-time hold in `cloudQueue.ts` (FR-017, C-5)
- [ ] T024 [P] [US5] Conflict detection (non-agent commit during Working) and ceilings/No response in `cloudState.ts` (C-15, C-17)
- [ ] T025 [US5] Commit status `askaway/cloud-task` pending/success on PR head + Specs tab "merge blocked" line (C-8)
- [ ] T026 [US5] Test `test-cloud-safety.cjs` (+ `test:workers`): overlapping second task Held with paths; disjoint allowed only per C-5 evidence; developer commit → conflict with both shas; ceiling → Timed out; status posted pending then success

**Checkpoint**: US5 Independent Test passes; SC-010, SC-011 checked.

---

## Phase 8: Polish

- [ ] T027 [P] Storybook: task row in every cloud state; digest block
- [ ] T028 [P] README "Cloud tasks" section incl. reviewer setup (required status check, workflow approval setting)
- [ ] T029 Run quickstart.md; enable setting; deploy; record proof

---

## Dependencies & Execution Order

- Setup → Foundational (needs 005 Foundational) → US1 → US2 → US3 → US4 → US5 → Polish.
- US1 (T006–T008) can run as soon as T001–T002 exist and a PR is open — before 005 is finished.
- One writer for `media/webview.js` (T013, T017, T027) and `specKitPromptAssets.ts` (T010, shared with 005 T014/T019): sequential.
- `[P]` pairs: T004‖T002, T010‖T011, T015‖T016, T023‖T024.
