# Knowledge Store Lifecycle Checklist: Validator Agent

**Purpose**: Unit tests for the requirements on knowledge storage, dedup, supersede and retention (agentmemory)
**Created**: 2026-10-02
**Feature**: [spec.md](../spec.md) (FR-008, FR-010, FR-011, FR-020), [plan.md](../plan.md), [research.md](../research.md) R-1

**Note**: Tests the quality of the written requirements, not the implementation.

## Retention vs agentmemory decay (FR-020, R-1)

- [ ] CHK001 Is FR-020 ("kept until the reviewer changes it; MUST NOT expire") reconciled with agentmemory's default decay/consolidation/auto-evict, which R-1 admits conflicts? [Conflict, Spec §FR-020, Research §R-1 Lifecycle caveat]
- [ ] CHK002 Is there a stated pass/fail gate for the spike (decay can be disabled or exempted for `agentId=validator`) before US2 starts? [Measurability, Plan §Phase 1, Research §R-1 VERIFY]
- [ ] CHK003 Is the fallback if the exemption fails unambiguous (re-save job vs revisit Decision vs memoryStore.ts) and does it still satisfy FR-020? [Clarity, Plan §Risks, Research §R-1]
- [ ] CHK004 Does the requirement cover "consolidation" (merging/rewriting memories), not only eviction? A merged item may alter reviewer wording. [Gap, Spec §FR-020, Research §R-1]
- [ ] CHK005 Is "the reviewer changes it" defined for all change forms (reply reversal, edit in agentmemory viewer, manual forget)? [Gap, Spec §FR-020, §FR-011]
- [ ] CHK006 Is FR-020's "MUST NOT be flagged for review automatically" consistent with FR-011's "flagged as changed"? [Consistency, Spec §FR-011, §FR-020, US4 §3]
- [ ] CHK007 Is a verifiable retention success criterion defined (e.g. item recalled intact after N days/ a decay cycle)? [Measurability, Gap]
- [ ] CHK008 Is the detection and visibility of a silently evicted item specified (the index.jsonl mirror vs store reconciliation)? [Gap, Research §R-1]

## Dedup and supersede (FR-010, FR-011)

- [ ] CHK009 Is "the same fact" defined (exact, paraphrase, semantic threshold) so dedup is testable? [Clarity, Spec §FR-010]
- [ ] CHK010 Does FR-010 state its scope across ADRs, spec lines and memories, given US4 names them but the validator owns only its memories? [Ambiguity, Spec §FR-010, US4]
- [ ] CHK011 Is "concise" quantified (max length, fields) rather than only "concise rule"? [Measurability, Spec §FR-010, US4 §4]
- [ ] CHK012 Is the supersede request/contract (fields, history retained, rollback) specified in requirements, not left to VERIFY? [Gap, Research §R-1 Open items]
- [ ] CHK013 Is the version history of superseded items reconciled with "the old statement is replaced, not kept" (history kept in agentmemory)? [Conflict, Spec §US4, Research §R-1 version chain]
- [ ] CHK014 Is the rule for deciding that a reply reverses a stored decision (vs refines or scopes it) defined? [Gap, Spec §FR-011]
- [ ] CHK015 Is the precedence among conflicting sources (ADR vs reviewer reply vs stored item) in the requirements, not only an edge case? [Completeness, Spec §Edge Cases]
- [ ] CHK016 Is SC-005 ("0 duplicates on audit") tied to a defined audit method and frequency? [Measurability, Spec §SC-005]

## Scoping, recall and availability

- [ ] CHK017 Is the attach target rule defined when a reply fits several specs/stories/tasks or none ("nothing stored against the wrong spec")? [Clarity, Spec §FR-008, Edge Cases]
- [ ] CHK018 Is the recall requirement (which items load for an answer, ranking, limit) specified, given SC-004 relies on it? [Gap, Spec §SC-004]
- [ ] CHK019 Is behaviour when agentmemory is down or port 3111 is taken defined (visible failure, no silent fallback, no loss of the pending reply)? [Completeness, Spec §FR-017, Plan §Risks, Research §R-1]
- [ ] CHK020 Is the "rebuildable store" claim (index.jsonl mirror) stated as a requirement with a recovery criterion? [Gap, Research §R-1, Plan §Storage]
- [ ] CHK021 Is "work can start from anywhere" (Goal) covered for a new workspace/machine, given the store is a per-user shared server outside the repo? [Gap, Research §R-1 one shared server]
- [ ] CHK022 Does the spec's Assumption "adds no new source type" conflict with adding an external agentmemory server? [Conflict, Spec §Assumptions, Plan §Technical Context]
- [ ] CHK023 Are examples (FR-008 "MAY") given storage and dedup rules consistent with FR-010? [Consistency, Spec §FR-008, §FR-010]

## Notes

- Highest-risk item: CHK001 (FR-020 vs agentmemory decay).
