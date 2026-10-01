# Observation Cost and Evals Checklist: Validator Agent

**Purpose**: Unit tests for the requirements on observation filtering, cost accounting, success targets and evals
**Created**: 2026-10-02
**Feature**: [spec.md](../spec.md) (FR-013, FR-015, FR-019, FR-021, SC-001..SC-009), [plan.md](../plan.md), [research.md](../research.md) R-2, R-4, R-5

**Note**: Tests the quality of the written requirements, not the implementation.

## Observation and cheap check (FR-019)

- [ ] CHK001 Is "pure progress update" defined with criteria beyond "no question, decision or new information"? [Clarity, Spec §FR-019]
- [ ] CHK002 Is the miss-rate (skipped responses that held a question/decision) a measurable requirement with a threshold? R-2 says only "audited". [Measurability, Research §R-2, Plan §Risks]
- [ ] CHK003 Is the cheap check's "no model call" constraint in the spec or only in research? [Gap, Research §R-2, Spec §FR-019]
- [ ] CHK004 Is the uncertain-case rule ("goes to the validator") a stated requirement? [Gap, Research §R-2]
- [ ] CHK005 Is FR-001 ("every response") consistent with FR-019 (skips some)? Is "observed" vs "answered" defined? [Consistency, Spec §FR-001, §FR-019]
- [ ] CHK006 Are the observation bounds specified for high-volume cases (many workers, long responses, bursts)? [Gap, Spec §Edge Cases "Several agents"]
- [ ] CHK007 Is a skipped response's visibility specified (counted, shown, or silent)? [Gap, Research §R-2]

## Cost (FR-013, SC-006, SC-007)

- [ ] CHK008 Is the denominator of SC-007 ("total cost of the agent work it observes") defined (per spec, per week, per response; includes skipped ones)? [Ambiguity, Spec §SC-007]
- [ ] CHK009 Is the cost of the cheap check, storage calls and eval runs in or out of "validator cost"? [Gap, Spec §FR-013, §SC-007]
- [ ] CHK010 Is the cost of non-model work (agentmemory embeddings, local model download) addressed? [Gap, Research §R-1]
- [ ] CHK011 Are all FR-013 fields (input, output, reasoning, cache, cost) specified for runs that fail or time out? [Coverage, Spec §FR-013, §FR-017]
- [ ] CHK012 Is per-source attribution (agent vs validator) a requirement and not only research R-4? [Gap, Spec §Edge Cases, Research §R-4]
- [ ] CHK013 Is the action when SC-007's 10% limit is exceeded defined (alert, throttle, nothing)? [Gap, Spec §SC-007]
- [ ] CHK014 Is the double-counting risk between validator turns and the observed spec turn addressed in the banner total? [Gap, Research §R-4]

## Success criteria measurability

- [ ] CHK015 Is SC-001's "baseline measured in the first week" paired with the way "agent questions" are counted (which responses contain questions)? [Clarity, Spec §SC-001]
- [ ] CHK016 Is SC-003 "match on the decision" defined (who judges, partial match, how recorded), as FR-007/FR-021 only say "how closely"? [Ambiguity, Spec §SC-003, §FR-007, §FR-021]
- [ ] CHK017 Is SC-003 measured only over answered questions, and what about unanswered ones? [Gap, Spec §SC-003]
- [ ] CHK018 Does the match measure shown in Commentary (FR-021) use the same definition as SC-003? [Consistency, Spec §FR-021, §SC-003]
- [ ] CHK019 Is SC-002 unmeasurable in beta and so left without a verification in this release? [Measurability, Spec §SC-002]
- [ ] CHK020 Is SC-004's "down from the pre-launch average" backed by a baseline source that exists? [Dependency, Spec §SC-004]
- [ ] CHK021 Is the first-week reset procedure for provisional targets (who, when, how recorded) defined? [Gap, Spec §SC Measurable Outcomes]
- [ ] CHK022 Is SC-008 "0 blocking steps" given a definition of the tested failure cases (timeout, store down, crash)? [Clarity, Spec §SC-008, §FR-017]

## Evals (FR-015, US5, SC-009)

- [ ] CHK023 Is "baseline" defined (first recorded score, fixed number, per-suite)? [Ambiguity, Spec §US5 §2, §SC-009]
- [ ] CHK024 Is the eval pass metric specified per suite (answer, enhance, store), including noise tolerance for non-deterministic runs? [Gap, Spec §US5]
- [ ] CHK025 Is minimum eval set size/coverage stated (including no-source, secret, reversal, "ok" reply cases)? [Completeness, Spec §US5, §FR-005, §FR-016]
- [ ] CHK026 Is a cheap-check eval (skip miss rate) required, since FR-015 lists three behaviours only? [Gap, Spec §FR-015, Research §R-2]
- [ ] CHK027 Is "improving the prompt" in FR-015 consistent with FR-009's beta "proposal" wording? [Consistency, Spec §FR-015, §FR-009]
- [ ] CHK028 Is the eval cost budget and who runs the gate (CI, manual) specified? [Gap, Spec §SC-009]
- [ ] CHK029 Is the process for adding real corrections to the eval set safe for secrets and reviewer approval? [Gap, Spec §US5 §3, §FR-016]
- [ ] CHK030 Is the reuse of `evalScoreboard.ts` stated as a constraint in the spec or only research R-5? [Traceability, Research §R-5]

## Notes

- Highest-risk items: CHK008, CHK016, CHK023.
