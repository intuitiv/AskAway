---
description: "Task list for 006 Cloud Tasks"
---

# Tasks: Cloud Tasks

**Input**: `specs/006-cloud-tasks/` — spec.md, plan.md (Decision Register C-1…C-22; later stories under `## Later`), data-model.md, contracts/, research.md

**Branch provenance**: generated on `main` at `1fc06d1`; implementation lands on the 006 story PR (one active PR per story).

**Depends on 005**: Foundational (stages, run records, `task.tags`) — done in 005 T003–T005; active PR (005 plan D-12) before US2.

**Tests**: Required; each behaviour task names its outside-in test, wired into `test:workers`. `test-cloud-state.cjs` MUST assert no cloud price in card/Telegram/digest. **Budget**: ≤12 open, ≤6 per group; US2 planned after GO, US3–US6 remain in plan.md `## Later`.

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

- [ ] T006 [US2] Eligibility `[cloud]` / `[local: reason]` in `/sk.tasks` prompt asset and scanner-backed Specs row (FR-002/FR-003): self-contained, under ~45 min, no open questions/local services; eligible is never automatically queued. Outside-in `test-cloud-eligibility.cjs`: generated tasks expose correct tags/reasons and queue affordance, ineligible task has no button; loading eligible tasks produces zero GitHub writes.
- [ ] T007 [US2] `buildPacket` / `buildComment` in `src/cloud/packet.ts` per contract: nine required fields, all draft stages, current PR-head base, task commit prefix/report format, ≤5-line reference comment, secret gate; model line read-only PR default, report names self-reported. Outside-in `test-cloud-packet.cjs`: caller-generated packet/comment retain exact verification commands and required fields, correct packet SHA reference, no repeated context, seeded secrets refused before writes (depends on T002, T005).
- [ ] T008 [US2] Explicit reviewer-triggered `queueTask` / `refusalFor` in `src/cloud/cloudQueue.ts`: auth/open active PR/permission/eligibility/duplicate/secret checks before writes; resolve branch from PR, commit/push packet then comment; settings enabled/pollMinutes/agentLogins, per-spec run state. Serialise Queued/Working/Pushed/checks attempts per PR; additional requested tasks Held locally, released only from their existing explicit request at Needs review/terminal; never merge/create branch/PR/issue or launch from startup/schedule. Outside-in `test-cloud-queue.cjs` with git/gh fixtures: exactly one packet/comment on active branch despite different checkout, no writes on refusal/repeated click/no request, simultaneous requests yield one posted attempt and one Held, release posts Held once (depends on T006/T007).
- [ ] T009 [US2] Initial `pollPr` / `deriveCloudState` / run-store report ingestion (`src/cloud/cloudPoller.ts`, `cloudState.ts`): use observed eyes/start/finish/commit/check signals and authenticated `Copilot` report with unquoted task-labelled line after quoted request. Correlate author/app/task/branch; model claims labelled self-reported, `Verify output: 1` never acceptance; preserve command/report/commit links and questions on task run, no checkbox tick. Outside-in `test-cloud-task-report.cjs`: replay live fixture for both serial tasks, recognise real bot reports, reject human echoes/wrong task/quoted-only reports, expose check statuses (including approval if present), report→Needs review and task remains unticked; release only previously requested Held task (depends on T008; full backoff/timeouts and feed/Telegram in US3).
- [ ] T010 [US2] Wire explicit "Queue in cloud" action and initial run/report status into Specs card through existing task/trace render components, converting run state at boundary; show Held/Queued/Working/Pushed/checks/Needs review, report evidence/question, duration and self-reported model/no price, no merge action or picker claiming enforced selection. Outside-in `test-cloud-specs-card.cjs`: click→one queue call, fixture transitions/report shown on correct task, shared renderer output reused, no tick on report, no queue call on card render/startup/schedule, second request Held; compile/type-check and run `npm --prefix tasksync-chat run test:workers` plus budget (depends on T008/T009).

**Checkpoint**: US2 caller-view tests pass; one explicit reviewer-requested live run recorded before release. US4 still owns local verification and task acceptance.

---

## Dependencies & Execution Order

- Setup ‖ Foundational → US1 GO → US2 T006/T007 → T008 → T009 → T010; US3–US6/Polish remain Later.
- T004 needs a real open PR and posts to GitHub: only after the reviewer names the PR.
