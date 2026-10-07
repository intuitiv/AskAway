---
description: "Task list for 006 Cloud Tasks"
---

# Tasks: Cloud Tasks

**Input**: `specs/006-cloud-tasks/` — Goal.md, Rules.md, spec.md, plan.md (Decision Register C-1…C-23), data-model.md, contracts/, research.md; reviewer questions in checklists/analyze.md §2026-10-07.

**Branch provenance**: generated on `main` at `1fc06d1`; implementation lands on the 006 story PR (one active PR per story).

**Depends on 005**: Foundational (stages, run records, `task.tags`) — done in 005 T003–T005; active PR (005 plan D-12) before US2.

**Tests**: Required; each behaviour task names its outside-in test, wired into `test:workers`. `test-cloud-state.cjs` MUST assert no cloud price in card/Telegram/digest. **Budget**: ≤12 open, ≤6 per group; US3–US6 scheduled below (10 open: 3/3/3/1). Blocked planning tasks are not permission to invent design.

**Paths**: under `tasksync-chat/` unless shown.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 [P] `src/cloud/gh.ts`: `gh` runner with injectable exec, JSON parsing, typed failures (`unauthenticated`, `rate-limited`, `network`), first stderr line only; `test-cloud-gh.cjs` in `test:workers`. Add `.askaway/specs/*/cloud/` to `.gitignore`. Settings `askaway.cloudTasks.*` are added in US2 with the code that reads them.

---

## Phase 2: Foundational

- [x] T002 [P] Secret gate `secretFindings(text, knownValues)` in `src/cloud/packet.ts` (C-16) with `test-cloud-secrets.cjs` in `test:workers` (each seeded pattern and a known env value refused with the field name; clean text passes)

**Checkpoint**: gh runner and secret gate ready.

---

## Phase 3: User Story 1 — Live proof of the cloud route (P1) 🎯 MVP

**Goal**: committed evidence note answering every route question, a recorded signal fixture, go/no-go.

**Independent Test**: spec.md US1.

- [x] T003 [US1] `tools/cloud-proof.cjs --pr <n> --task PROOF-1 [--dry-run]`: commit a trivial packet (append one line to `specs/006-cloud-tasks/evidence/proof-target.md`), post the C-12 comment (one variant names a model), then a second comment 1 min later (concurrency probe, C-5); poll every 60 s up to 59 min; write raw polls to `test-fixtures/cloud-signals-<date>.json`; `--dry-run` prints the packet and comment without posting; dry-run covered by `test-cloud-proof.cjs` in `test:workers`
- [x] T004 [US1] Live run (proof budget 61 min, FR-024) on a reviewer-chosen open PR (reviewer action: posts to GitHub) and write `specs/006-cloud-tasks/evidence/proof-<date>.md` per contracts/evidence-note.md with no "unknown" rows. Done 2026-10-07 on throwaway PR #1608 (reviewer: "use throwaway PR"), evidence `evidence/proof-2026-10-07.md`; reviewer looked at the PR, then it was closed and the branch deleted.
- [x] T005 [US1] Fold observed facts into plan C-3, C-4, C-5, C-15, C-19 and spec Assumptions; align packet/comment contract. Done 2026-10-07: `evidence/proof-2026-10-07.md`, same-branch bot commits, sequential sessions, self-reported models only, Actions copilot job ran/no observed hold, approval setting not captured. Reviewer: "Sure productise cloud thing. As it is triggered only when i ask for it. Not always." GO recorded in Rules/spec/plan; explicit reviewer requests only, no automatic/scheduled launches by default; "do not merge PRs".

**Checkpoint**: SC-001; SC-002 part 1. No-go → stop for reviewer.

---

## Phase 4: User Story 2 — Explicitly queue a task and see its report (P1)

**Goal**: Reviewer requests a cloud task on the active PR; packet/comment posted once, status visible in Specs card, authenticated report parsed back into the task without ticking it. One active attempt per PR; more explicitly requested tasks Held, never automatic task discovery/dispatch.

**Independent Test**: Press "Queue in cloud" for an eligible task; see one pushed packet and one PR comment, Queued then Working/Pushed/Needs review on the Specs card, correlated report and self-reported model, task unticked. A second explicitly requested task waits; startup/scheduled ticks alone post nothing.

- [x] T006 [US2] Eligibility `[cloud]` / `[local: reason]` in `/sk.tasks` prompt asset and scanner-backed Specs row (FR-002/FR-003): self-contained, under ~45 min, no open questions/local services; eligible is never automatically queued. Outside-in `test-cloud-eligibility.cjs`: generated tasks expose correct tags/reasons and queue affordance, ineligible task has no button; loading eligible tasks produces zero GitHub writes. Done 2026-10-07, EV-CLOUD-ELIGIBILITY; `rtk node tasksync-chat/test-cloud-eligibility.cjs` passes.
- [x] T007 [US2] `buildPacket` / `buildComment` in `src/cloud/packet.ts` per contract: nine required fields, all draft stages, current PR-head base, task commit prefix/report format, ≤5-line reference comment, secret gate; model line read-only PR default, report names self-reported. Outside-in `test-cloud-packet.cjs`: caller-generated packet/comment retain exact verification commands and required fields, correct packet SHA reference, no repeated context, seeded secrets refused before writes (depends on T002, T005). Done 2026-10-07, EV-CLOUD-PACKET: `rtk node tasksync-chat/test-cloud-packet.cjs` → `test-cloud-packet: 9 passed, 0 failed`.
- [x] T008 [US2] Explicit reviewer-triggered `queueTask` / `refusalFor` in `src/cloud/cloudQueue.ts`: auth/open active PR/permission/eligibility/duplicate/secret checks before writes; resolve branch from PR, commit/push packet then comment; settings enabled/pollMinutes/agentLogins, per-spec run state. Serialise Queued/Working/Pushed/checks attempts per PR; additional requested tasks Held locally, released only from their existing explicit request at Needs review/terminal; never merge/create branch/PR/issue or launch from startup/schedule. Outside-in `test-cloud-queue.cjs` with git/gh fixtures: exactly one packet/comment on active branch despite different checkout, no writes on refusal/repeated click/no request, simultaneous requests yield one posted attempt and one Held, release posts Held once (depends on T006/T007). Done 2026-10-07, EV-CLOUD-QUEUE: `rtk node tasksync-chat/test-cloud-queue.cjs` → `test-cloud-queue: 14 passed, 0 failed`.
- [x] T009 [US2] Initial `pollPr` / `deriveCloudState` / run-store report ingestion (`src/cloud/cloudPoller.ts`, `cloudState.ts`): use observed eyes/start/finish/commit/check signals and authenticated `Copilot` report with unquoted task-labelled line after quoted request. Correlate author/app/task/branch; model claims labelled self-reported, `Verify output: 1` never acceptance; preserve command/report/commit links and questions on task run, no checkbox tick. Outside-in `test-cloud-task-report.cjs`: replay live fixture for both serial tasks, recognise real bot reports, reject human echoes/wrong task/quoted-only reports, expose check statuses (including approval if present), report→Needs review and task remains unticked; release only previously requested Held task (depends on T008; full backoff/timeouts and feed/Telegram in US3). Done 2026-10-07, EV-CLOUD-TASK-REPORT: `rtk node tasksync-chat/test-cloud-task-report.cjs` → `test-cloud-task-report: 18 passed, 0 failed (PR #1608 fixture replay)`.
- [x] T010 [US2] Wire explicit "Queue in cloud" action and initial run/report status into Specs card through existing task/trace render components, converting run state at boundary; show Held/Queued/Working/Pushed/checks/Needs review, report evidence/question, duration and self-reported model/no price, no merge action or picker claiming enforced selection. Outside-in `test-cloud-specs-card.cjs`: click→one queue call, fixture transitions/report shown on correct task, shared renderer output reused, no tick on report, no queue call on card render/startup/schedule, second request Held; compile/type-check and run `npm --prefix tasksync-chat run test:workers` plus budget (depends on T008/T009). Done 2026-10-07, EV-CLOUD-SPECS-CARD: `rtk node tasksync-chat/test-cloud-specs-card.cjs` → `test-cloud-specs-card: PASS shared task/trace reuse, click boundary, statuses/report, gated polling, no tick/price/merge`; JS syntax, TypeScript noEmit and test:workers (including budget) pass.

**Checkpoint**: US2 caller-view tests pass; still needs one explicitly requested live cloud run recorded before release (the US1 demo is not US2 checkpoint evidence). Run only when the reviewer asks and names the active PR; never merge. US4 still owns local verification and task acceptance.

---

## Phase 5: User Story 3 — See cloud task status everywhere (P2)

**Goal**: Extend the existing US2 tracker to elapsed-time/backoff behaviour, shared Workers feed, Telegram status and changed-run morning digest.

**Independent Test**: Replay `test-fixtures/cloud-signals-2026-10-07.json` through polling to Specs/feed/Telegram; observe timestamps, SHA/check/report links and decisions, then advance a fake clock through No response, Timed out, stale polling and daily digest. No cloud price on any surface; one reviewer-requested live task confirms the same transitions.

- [ ] T011 [US3] Elapsed-time exits and polling backoff in `src/cloud/cloudState.ts`, `cloudPoller.ts`, `cloudSpecs.ts` and `src/webview/webviewProvider.ts` (FR-010/FR-021/FR-022; C-6/C-17): 10-minute no-ack exit, configured/59-minute timeout, timestamped history, retain last state with staleSince on failure, backoff to 15 min and recover; retry only by explicit request as attempt n+1. Outside-in `tasksync-chat/test-cloud-state.cjs`: fixture replay plus fake clock/failed gh polls exposes correct state/history and no guessed transitions or unrequested posts (depends on T010; cap enforcement question F25 remains separate).
- [ ] T012 [US3] Convert cloud runs at the feed boundary in `src/cloud/cloudSpecs.ts`, `src/webview/webviewProvider.ts` and `media/webview.js`; reuse existing `traceRowsHtml`, never a parallel cloud renderer (FR-011/FR-013; C-20). Outside-in `tasksync-chat/test-cloud-state.cjs`: replayed task states appear in both Specs and Workers output containing the shared renderer output, same ordering/links/expand-collapse, duration/self-reported model and no price (depends on T011; one writer for webview).
- [ ] T013 [US3] `digestLines` in `src/cloud/cloudDigest.ts`, delivery through `src/commentary/telegramLive.ts`, scheduling/settings in `src/webview/webviewProvider.ts` and `package.json` (FR-011/FR-012/FR-013; C-18). Outside-in `tasksync-chat/test-cloud-digest.cjs` and `tasksync-chat/test-cloud-state.cjs`: captured Telegram status/digest lists PR/evidence/duration/model/blocker/decision, sends only changed runs once daily at configured local time (default 08:00), empty digest sends nothing, no price or cloud-launch side effects (depends on T012).

**Checkpoint**: US3 Independent Test automated in `test:workers`; SC-006/SC-007 evidence plus one live run in `specs/006-cloud-tasks/evidence/` only on explicit reviewer request. Never merge; live evidence remains pending until requested.

---

## Phase 6: User Story 4 — Accept cloud work only after local verification (P2)

**Goal**: Automatically verify Needs review locally, return unsafe/failing output, and tick only passing work with 005 checkpoint evidence.

**Independent Test**: On local git fixtures, submit passing, failing and out-of-scope cloud commits to acceptance; only the passing task becomes Accepted/ticked with named command evidence, failures stay unticked with reasons on row/digest, and all-Accepted invokes the existing 005 story checkpoint.

- [ ] T014 [US4] `acceptCloudTask` worktree/verify-worker boundary in `src/cloud/cloudAccept.ts`, invoked from `src/cloud/cloudSpecs.ts` on Needs review (FR-014; C-14). Outside-in `tasksync-chat/test-cloud-accept.cjs`: pass/fail git fixtures fetch the current PR head into a temporary worktree and run the packet's exact commands; passing local evidence yields Accepted, failed command yields Returned/evidence without ticking, agent report alone never passes (depends on T013).
- [ ] T015 [US4] Scope and human-gate checks in `src/cloud/cloudAccept.ts` (FR-009/FR-015; C-13/C-14/C-15): inspect cloud-agent changes between packet base and verified head, reject paths outside allowedPaths and changes to spec/plan Status lines. Outside-in `tasksync-chat/test-cloud-accept.cjs`: local git fixtures with forbidden paths or Status edits become Returned with offending paths/evidence and unchanged checkbox despite passing verify output (depends on T014).
- [ ] T016 [US4] Main-process tick/final record in `src/cloud/cloudAccept.ts`, `cloudSpecs.ts`, `src/specs/runRecords.ts`; reuse the existing 005 checkpoint flow through `src/webview/webviewProvider.ts` (FR-014/FR-016/FR-018/FR-022; C-7/C-14). Outside-in `tasksync-chat/test-cloud-accept.cjs`: pass ticks once and records evidence, failure stays unticked and appears on row/digest, verify worker never pushes, tick/record commits carry AskAway-Commit trailers and defer push while another task is Working; completing a cloud story invokes the same 005 checkpoint, no human gate or PR merge (depends on T015).

**Checkpoint**: US4 Independent Test and SC-008 pass. SC-009 still requires ≥3 explicitly requested tasks Accepted overnight on one active PR with automatic verification/digest; record live evidence only when requested. Never merge.

---

## Phase 7: User Story 5 — Safety, conflicts and ceilings (P3)

**Goal**: Add safety diagnostics without relaxing serial PR dispatch or introducing merge controls; apply the reviewer-approved run cap.

**Independent Test**: Explicitly queue overlapping and disjoint tasks; both second attempts stay Held with overlap paths where applicable. Simulate developer and extension-authored pushes, advance the duration ceiling, and seed packet/comment secrets: caller sees conflict evidence, Timed out blocker and secret-field refusal without writes.

- [ ] T017 [US5] Overlap diagnostics and branch-conflict state in `src/cloud/cloudQueue.ts`, `cloudState.ts`, `cloudSpecs.ts`, shared feed input via `src/webview/webviewProvider.ts` (FR-017/FR-018; C-5/C-7). Outside-in `tasksync-chat/test-cloud-safety.cjs`: overlapping/disjoint second requests remain Held until serial release, overlapping paths shown, developer push during Working shows both SHAs on row/feed, agent and AskAway-Commit packet/tick/record pushes cause no warning; never merge or install required status (depends on T016; overlap release ambiguity F24 must be resolved before changing release rules).
- [ ] T018 [P] [US5] Secret refusal regression at packet/comment write boundary in `src/cloud/packet.ts`, `cloudQueue.ts` (FR-020; C-16). Outside-in `tasksync-chat/test-cloud-safety-secrets.cjs`: seeded token patterns and known credential values in each outgoing field refuse before packet/commit/comment writes, identify the field without exposing the value; clean request succeeds (depends on T010; may run alongside US3 on disjoint files, not T017/T019 which share queue/packet files).
- [ ] T019 [US5] Duration-ceiling policy in `src/cloud/packet.ts`, `cloudState.ts`, `cloudSpecs.ts`, `package.json` and remaining-cap Specs output in `media/webview.js` (FR-019/FR-024; C-17/C-23; Rules.md hard max 59, default 50). Outside-in `tasksync-chat/test-cloud-safety.cjs`: omitted ceiling defaults to 50, above-59 request refused, configured expiry/59-minute boundary produces Timed out/digest blocker and remaining-cap warning, no merge action. **Blocked on F25** for the enforcement/clock design: add caller-observed stop/no-further-work assertion only after approved mechanism is in plan/contracts; local timeout alone is not proof the cloud stopped (depends on T017/T018 and reviewer decision).

**Checkpoint**: US5 Independent Test, SC-005/SC-010/SC-011 pass only after F24/F25 are resolved; one explicitly requested live cap/safety run recorded, never an automatic launch or merge.

---

## Phase 8: User Story 6 — Delegate a whole user story to GitHub (Later; planning gate)

**Goal**: Prepare the ultimate goal on the active PR branch in implement, reusing per-task status/acceptance rules. No story-level runtime design is approved yet.

**Independent Test**: spec.md US6: explicit delegation in implement lands story tasks on the active PR branch, Actions run, and the unchanged 005 checkpoint passes locally before acceptance; human merges only.

- [ ] T020 [local: open question] [US6] Resolve F23 with the reviewer before implementation; then extend `specs/006-cloud-tasks/plan.md` and `contracts/packet.md` / `contracts/cloud-run.schema.json` with the chosen story-delegation boundary and caller-view cases for `tasksync-chat/test-cloud-story.cjs`. Trace FR-004/FR-005/FR-007/FR-014/FR-016/FR-017/FR-023/FR-024/FR-025 and US6 Independent Test: explicit implement-only request, same PR branch, exact per-task verification, unchanged checkpoint, no merge/unrequested dispatch. Do not invent US6 acceptance scenarios or claim a passing test; approved plan must name implementation files and small follow-up tasks within budget (depends on US5 and reviewer decision).

**Checkpoint**: Blocked on F23: reviewer approves the story contract/test cases before implementation tasks are generated. US6 is not delivered by this planning task; its Independent Test still needs automated coverage and an explicitly requested live run.

---

## Dependencies & Execution Order

- Setup ‖ Foundational → US1 GO → US2 T006/T007 → T008 → T009 → T010 → US3 T011–T013 → US4 T014–T016 → US5 T017–T019 → US6 T020 (reviewer planning gate). T018 [P] may run alongside US3 after T010 on disjoint files; shared files/tests otherwise stay serial. Polish remains Later.
- T004 needs a real open PR and posts to GitHub: only after the reviewer names the PR.
- All live checkpoints require a fresh explicit reviewer request; no cloud launch is authorized by this task list. AskAway never merges. Before 008, finish 005/006/007 as requested by the reviewer 2026-10-07; this tasks stage does not declare 006 finished.
