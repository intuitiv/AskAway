---
description: "Task list for 006 Cloud Tasks"
---

# Tasks: Cloud Tasks

**Input**: `specs/006-cloud-tasks/` — spec.md, plan.md (Decision Register C-1…C-22; later stories under `## Later`), data-model.md, contracts/, research.md

**Branch provenance**: generated on `main` at `1fc06d1`; implementation lands on the 006 story PR (one active PR per story).

**Depends on 005**: Foundational (stages, run records, `task.tags`) — done in 005 T003–T005; active PR (005 plan D-12) before US2.

**Tests**: Required; `test-cloud-state.cjs` MUST assert that cloud runs show no price in the card, Telegram status, or digest. **Budget**: ≤12 open, ≤6 per group; US2–US5 stay in plan.md `## Later` until US1's go/no-go.

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
- [ ] T005 [US1] Fold observed facts into plan C-3, C-4, C-5, C-15, C-19 (event name, agent login, model selectability, concurrency, Actions behaviour) and record go/no-go; update the spec Assumption currently marked "UNVERIFIED" and the packet/comment contracts to reflect the observed route and model-selection behavior

**Checkpoint**: SC-001; SC-002 part 1. No-go → stop for reviewer.

---

## Dependencies & Execution Order

- Setup ‖ Foundational → US1 → (plan.md `## Later`: US2–US5, Polish).
- T004 needs a real open PR and posts to GitHub: only after the reviewer names the PR.
