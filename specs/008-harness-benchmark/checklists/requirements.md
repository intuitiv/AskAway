# Requirements Checklist: Harness Benchmark

**Purpose**: Check that spec 008 requirements are complete, unambiguous and traced to plan decisions and tasks before implementation
**Created**: 2026-10-13
**Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Fixture scope (spec-bearing, four levels) is decided and sourced (Clarifications 2026-10-13; FR-001, FR-012)
- [x] CHK002 Main agent and harness are decided (FR-013; Rules 2026-10-10)
- [x] CHK003 Score definition and gate are decided and point to one function (FR-006, FR-009; research D2, D6)
- [x] CHK004 Spend limit is stated with a value and stop behaviour (FR-011; research D4)
- [ ] CHK005 Scoreboard surface in the UI is decided (plan Q1, blocks T014)
- [ ] CHK006 Spend-cap scope (per configuration run vs per comparison) is confirmed (plan Q2)
- [ ] CHK007 Result-row storage location is confirmed (plan Q5)

## Clarity

- [x] CHK008 "Accepted" is defined by hidden checks only, never by agent claims (FR-004; research D1)
- [x] CHK009 Outcome statuses are enumerated: accepted, failed, skipped, interrupted (FR-005; data-model)
- [x] CHK010 Unavailable cost/usage is shown as unavailable, never zero (FR-008; contracts/result-row.md)
- [x] CHK011 Comparability rule for different benchmark versions or pricing bases is defined (FR-010; research D7)

## Traceability

- [x] CHK012 Every FR maps to at least one task in tasks.md (FR-001→T002–T004; FR-002/003→T006, T007, T010; FR-004/005→T003, T008; FR-006/009→T012, T014; FR-007/008→T005, T012; FR-010→T013; FR-011→T009; FR-012→T004; FR-013→T007)
- [x] CHK013 Each user story has an Independent Test and a caller-view test file (US1 `test-benchmark-runner.cjs`; US2 `test-benchmark-scoreboard.cjs`)
- [x] CHK014 Scoreboard reuse of the banner component is asserted by a test (T012, T014; constitution II)

## Notes

- Open items CHK005–CHK007 are the reviewer questions in [plan.md](../plan.md); recommended answers are recorded there.
