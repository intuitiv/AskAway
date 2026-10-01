# Beta Boundary and Privacy Checklist: Validator Agent

**Purpose**: Unit tests for the requirements on the beta (Commentary-only) boundary and secrets handling
**Created**: 2026-10-02
**Feature**: [spec.md](../spec.md) (FR-016, FR-018), [plan.md](../plan.md), [research.md](../research.md) R-6, R-7

**Note**: Tests the quality of the written requirements, not the implementation.

## Beta boundary (FR-018)

- [ ] CHK001 Is "nothing is sent to the agent" defined for every channel (chat input, worker input, MCP tool result, hooks, prompt text)? [Completeness, Spec §FR-018, Research §R-7]
- [ ] CHK002 Is the boundary stated identically for answers (FR-018), prompt proposals (FR-009) and match/prediction display (FR-021)? [Consistency, Spec §FR-009, §FR-018]
- [ ] CHK003 Is "advisory" defined (what counts as approving a gate or a destructive action)? [Clarity, Spec §FR-018, Edge Cases]
- [ ] CHK004 Is the reviewer-triggered path (copying a Commentary answer into a reply) specified as inside or outside the boundary? [Gap]
- [ ] CHK005 Is the exit criterion for beta ("once confident", "with cautions") measurable, or explicitly deferred with an owner? [Ambiguity, Spec §Assumptions, Rules.md Beta]
- [ ] CHK006 Does a requirement forbid the validator's own run from holding tools that can send to the agent (read-only profile)? [Gap, Plan §Phases, Research §R-5]
- [ ] CHK007 Is the success criterion for the beta boundary measurable (an SC like SC-006 for "0 validator outputs reached an agent")? [Measurability, Gap]
- [ ] CHK008 Is the FR-006 "validator FIRST" ordering reconciled with the beta rule (reviewer reply still reaches the agent without waiting on the validator, FR-017/SC-008)? [Conflict, Spec §FR-006, §FR-017]
- [ ] CHK009 Is the behaviour when the validator is slow (is the agent reply held until the validator finishes?) specified with a timeout? [Gap, Spec §FR-006, §FR-017]
- [ ] CHK010 Is the destructive-advice edge case traceable to a requirement on how advice is worded/flagged in Commentary? [Traceability, Spec §Edge Cases, §FR-018]

## Secrets and privacy (FR-016)

- [ ] CHK011 Is "secret" defined (token formats, .env values, keys, passwords, PII) with a reference list? [Clarity, Spec §FR-016, Research §R-6]
- [ ] CHK012 Does FR-016 cover all four sinks consistently: validator input, storage (agentmemory and jsonl), UI, cost records, plus transcripts and index.jsonl? [Completeness, Spec §FR-016, Plan §Storage]
- [ ] CHK013 Is the "drop the whole item if redaction is uncertain" rule in the spec rather than only in research, and is "uncertain" defined? [Gap, Research §R-6]
- [ ] CHK014 Is the user-visible outcome of a dropped item specified (silently dropped vs a visible notice in Commentary)? [Gap, Spec §Edge Cases]
- [ ] CHK015 Is there a measurable criterion for FR-016 (e.g. 0 secrets in seeded-secret fixtures across all sinks)? [Measurability, Gap]
- [ ] CHK016 Are secrets in the reviewer's reply (not only the agent's response) covered by the Edge Case, which names only "a response"? [Gap, Spec §Edge Cases]
- [ ] CHK017 Is the handling of the agentmemory credential (`AGENTMEMORY_SECRET` from SecretStorage) a stated requirement or only a research note? [Gap, Research §R-1]
- [ ] CHK018 Are the data-flow limits to the external agentmemory server (local-only 127.0.0.1, no network egress, embedding model download) stated as requirements? [Gap, Research §R-1]
- [ ] CHK019 Is the retention/deletion of already-stored content that later proves to hold a secret specified (forget path vs FR-020)? [Gap, Spec §FR-020]
- [ ] CHK020 Do the eval suites (FR-015) include secret-leak cases? [Coverage, Spec §FR-015, §FR-016]
- [ ] CHK021 Is it clear whether sources read by the validator (ADRs, memories, spec files) are redacted before use, not only agent responses? [Ambiguity, Spec §FR-002, §FR-016]

## Notes

- Items check requirement quality only; resolve gaps by editing spec/plan (reviewer).
