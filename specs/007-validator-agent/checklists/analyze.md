# Analyze Findings — 007 Validator Agent

Source: `/sk.check` (analyze) review after tasks, read-only. Paths relative to `specs/007-validator-agent/` unless a `tasksync-chat/` path. Task budget: `TASK-BUDGET 007-validator-agent: PASS open=10/12 largestCycle=4/6`. Constitution is an unfilled template, so `AGENTS.md` was the gate.

Counts: CRITICAL 0, HIGH 4, MEDIUM 10, LOW 6.

| ID | Severity | Location | Finding | Recommendation | Status |
|---|---|---|---|---|---|
| A1 | HIGH | spec.md FR-020; research.md R-1 Lifecycle caveat + Consequence; tasks.md T001, T008 | FR-020 (kept until the reviewer changes it) cannot hold on a shared agentmemory: auto-forget, consolidation and decay are process-wide, with no per-agentId exemption (R-1). R-1 offers two incompatible Consequences (re-save job, or disable the globals for every agent). T001 only "confirms" an exemption that R-1 already says does not exist, so its pass/fail is unclear. Consolidation can also rewrite reviewer wording. | Make T001 a go/no-go: PASS only if validator items survive a forced forget/consolidation cycle intact. Name the fallback now. | Needs reviewer (T001 now measures all three options and reports; it no longer confirms an exemption) — options: (a) run a dedicated validator-only agentmemory instance with `AUTO_FORGET_ENABLED=false`, `CONSOLIDATION_ENABLED=false` (own `--port`/`--data-dir`/`--instance`); (b) shared instance plus re-save job from `index.jsonl` (survives eviction, not consolidation rewrites); (c) fall back to `memoryStore.ts`. |
| A2 | HIGH | contracts/commentary-validator-entry.md; tasks.md T003; `tasksync-chat/src/commentary/commentary.ts:8,190` | `COMMENTARY_KINDS` also feeds the agent-facing MCP tool `z.enum(COMMENTARY_KINDS)` and `post()` validation. Adding `validator` to it lets an agent post kind `validator`, forging validator output. `CommentaryItem` has no `detail` field, but the contract needs one. | T003: keep the agent-facing enum as `update`/`heads-up`; add `validator` only on an internal path (separate `postValidator`). Add `detail` to the item type. Test that an agent post with kind `validator` is REJECTED. | Fixed — tasks.md T003; contracts/commentary-validator-entry.md Input/Tests; research.md R-3; plan.md source tree |
| A3 | HIGH | tasks.md T003; data-model.md ValidatorResponse.usage; R-4; `tasksync-chat/src/specs/specCostLedger.ts:5-13` | `SpecCostTurn` has `requests`, `inputTokens`, `outputTokens`, `nanoAiu`, and no `source`, reasoning or cache fields. FR-013 and SC-007 need all five fields and per-source attribution. T003 says only "source validator on `recordSpecTurn`" and does not extend the row. `turnKey` collisions with the observed turn could double-count (cost-evals CHK014). | T003: add optional `source` plus reasoning/cache fields (backward-compatible rows); define the turnKey for validator runs. Test: banner total includes the validator once. | Fixed — tasks.md T003; research.md R-4; data-model.md ValidatorResponse.usage |
| A4 | HIGH | spec.md FR-006 vs FR-017/SC-008; beta-privacy CHK008, CHK009; tasks.md T006 | "validator FIRST" can read as holding the reviewer reply until the validator finishes. No timeout or ordering is defined, and T006 tests only "delivered before the agent". A slow validator then blocks the flow. | Define: the pair is enqueued to the validator first, the agent send is never awaited on it, with a bounded timeout. Add to FR-006 and T006 test (slow validator, agent still receives the reply). | Needs reviewer — options: (a) fire-and-forget ordering (validator first in queue, no wait); (b) wait up to N seconds then proceed. In beta (a) is simplest. |
| A5 | MEDIUM | spec.md FR-020 vs FR-011/US4 §3; knowledge-store CHK006, CHK013; research R-1 | "MUST NOT be flagged for review automatically" vs "flagged as changed"; "old statement replaced" vs agentmemory version chain keeps history. | Clarify: changed flag is informational; history is retained but never loaded. Reword FR-011/US4 §3. | Open — wording lives in spec.md (reviewer-owned); data-model.md KnowledgeItem.changed now states informational only |
| A6 | MEDIUM | research.md R-1 Decision vs contracts/knowledge-store.md; data-model.md KnowledgeItem.changed | Supersede: research says `POST /agentmemory/evolve` and "not a `changed` flag"; the contract lists only remember/smart-search/health and `supersededId`; the data model has `changed`. Contract `remember` has no `evolve` call. | Align contract with R-1 (evolve with `memoryId`); define `changed` as derived. T001(b) "supersede call" is already answered in R-1 (re-verify only). | Fixed — contracts/knowledge-store.md Behaviour; data-model.md KnowledgeItem.changed; tasks.md T001(b) |
| A7 | MEDIUM | research.md R-1 (c); contracts/knowledge-store.md recall; tasks.md T005 | smart-search has no concepts filter; `agentId` filtering works in isolated mode only (`AGENTMEMORY_AGENT_SCOPE=isolated`). Spec/story/task scoping (FR-008, US2.6, SC-004) rests on query text. A wrong-spec recall could leak across specs. | T005 test: recall for spec A never returns spec B items; post-filter by `spec:` tag on results. Record the isolated-mode requirement in T001. | Fixed — tasks.md T001(c), T005 test; contracts/knowledge-store.md Behaviour |
| A8 | MEDIUM | tasks.md T001(e); research R-1 (e); contracts/knowledge-store.md | T001(e) says `AGENTMEMORY_SECRET` is "read from VS Code SecretStorage", but R-1 says the secret is set in the server env/`.env`; the extension is only the client. Where the client secret is stored is unspecified; nothing says the key is never in logs. | State: server holds the secret in env; extension stores its copy in SecretStorage; never logged. Add to T005 test. | Fixed — tasks.md T001(e), T005 test; contracts/knowledge-store.md Behaviour |
| A9 | MEDIUM | beta-privacy CHK013, CHK014, CHK016, CHK021; spec.md FR-016, Edge Cases; tasks.md T002 | "Drop the whole item when uncertain" exists only in R-6/T002. The Edge Case covers a secret in a "response" only, not the reviewer's reply or the sources (ADRs, memories) read by the validator. Dropped-item visibility is unspecified. Reuse target exists: `CREDENTIAL_ANYWHERE` in `src/commentary/commentary.ts:67`, not worker transcripts. | Put the drop rule and the reply/source coverage in FR-016; T002: reuse `CREDENTIAL_ANYWHERE`; test seeded secrets in all sinks (agentmemory body, jsonl, Commentary, cost). | Fixed — tasks.md T002; research.md R-6 (verified: `CREDENTIAL_ANYWHERE` is a non-exported const, T002 exports it). FR-016 wording in spec.md stays reviewer-owned |
| A10 | MEDIUM | beta-privacy CHK001, CHK007, CHK015; spec.md FR-018, SC-001..SC-009; tasks.md T004 | FR-018 has no SC, and "nothing sent to the agent" is checked only in T004. The channels (chat input, worker input, MCP tool result, hooks, prompt text) are not enumerated; T006 (closeLoop) and T007 (proposeContext) have no beta-isolation assertion, only T004. FR-016 likewise has no SC. | Add SC for "0 validator outputs reached an agent" and "0 seeded secrets in any sink"; add the isolation assertion to T006 and T007 tests (prompt byte-identical in T007 already). | Fixed for tasks — tasks.md T006, T007 isolation assertions. New SC rows need spec.md (reviewer-owned): Open |
| A11 | MEDIUM | spec.md SC-002, SC-004; tasks.md T010 | SC-002 is unmeasurable in beta and has no task; SC-004 relies on a "pre-launch average" baseline that no task records; SC-003/SC-001 need a counting method (cost-evals CHK015, CHK016, CHK020). T010 records only a first-week plan. | T010: define the baseline capture for SC-001, SC-003, SC-004 and mark SC-002 deferred to the link release. | Needs reviewer — options: (a) defer SC-002 and SC-004 baselines to the first-week measurement; (b) capture a baseline before launch by sampling past replies. |
| A12 | MEDIUM | spec.md Assumptions ("adds no new source type") vs plan.md Technical Context, research R-1; knowledge-store CHK021, CHK022 | An external agentmemory server (per-user, outside the repo) contradicts the assumption and "work can start from anywhere" on a new machine. `index.jsonl` mirror is claimed rebuildable but no task builds or tests a rebuild. | Amend the Assumption; add a rebuild-from-index test or state it is not required. | Open — Assumption is in spec.md (reviewer-owned) |
| A13 | MEDIUM | tasks.md T005, T006, T007 | Three tasks edit/extend `observer.ts` or are large: T004 (observer, cheap check, Commentary entry, Storybook, 4+ test cases), T006 (closeLoop, extraction, match display), T009 (suites, baselines, correction path, package.json wiring). Several exceed one session (budget tool passes, but item size is high). T004 also hides two features: Storybook story and the Commentary entry. | Split T004 into observer+cheap check and Commentary entry+story; split T009 into suites and baseline/correction path. | Fixed — tasks.md T004a/T004b, T009a/T009b (open 12/12) |
| A14 | MEDIUM | tasks.md T002/T003 vs plan.md Phases; tasks.md Dependencies | T001 spike gates T005+ but T002 (`records.ts`) and T003 are marked parallel with it while US2 `T005` also depends on T002, yet T003 and T004 reference `contracts/` only. The Format line shows `[P]` but T004 and T006 both edit `observer.ts` (T007 too), so T006/T007 cannot run in parallel with each other. Parallel Example shows only T007/T008 in parallel after T005, which is correct, but T005 vs T004 are both in `src/validator/` and fine. | Mark T006 and T007 as sequential on `observer.ts`; keep T008 parallel with T007. | Fixed — tasks.md T007 (depends on T006), Dependencies, Parallel Example |
| A15 | LOW | spec.md FR-001 vs FR-019; cost-evals CHK005, CHK007 | "Every response is observed" vs skips: "observed" and "answered" are not defined; skip visibility unspecified. | Define observed = passed the cheap check; skipped counted and visible in Commentary stats. | Open — task side done (tasks.md T004a skip visible in stats); definition is spec.md wording (reviewer-owned) |
| A16 | LOW | spec.md FR-015 vs FR-019; contracts/validator-evals.md; tasks.md T009 | R-2 says skip miss rate is audited in evals, but the eval suites are three (answer, enhance, store) and none covers the cheap check or secret-leak cases (cost-evals CHK026, beta-privacy CHK020). | Add a cheap-check and secret-leak case to T009 suites. | Fixed — tasks.md T009a |
| A17 | LOW | spec.md FR-009 vs FR-015, US5 "improving the prompt"; contracts/validator-evals.md `enhance` | Naming drift: spec/US3 say "prompt enhancement"/"propose context", FR-015/Goal say "improving the prompt", the suite is `enhance`, code is `proposeContext`. | Pick one term per layer and note the mapping. | Open |
| A18 | LOW | tasks.md T003; plan.md; `src/workers/workerProfiles.ts` | Validator profile "no send-to-agent tool" has no test of the profile's allowed tools beyond T003; MCP tool policy is not stated as portable profile fields (purpose, model, stop condition, evidence contract per AGENTS.md). | State the profile fields in T003 and the evidence contract. | Fixed — tasks.md T003 (profile fields, no-send-tool test) |
| A19 | LOW | tasks.md T010; `tasksync-chat/docs/requirements/` | T010 updates requirements rows for FR-001 to FR-021 but is the only task for docs and quickstart; quickstart has no check for agentmemory ports/health. | Add the health check step to quickstart when T001 lands. | Open |
| A20 | LOW | plan.md Status vs tasks.md Prerequisites; spec.md Status | plan.md Status says approved, spec.md Status still `Draft`; checklists (beta-privacy, knowledge-store, cost-evals) have all items unchecked. | Reviewer marks which CHK items are accepted or deferred. | Needs reviewer — options: (a) resolve the gaps via A1-A12 then tick; (b) accept all gaps as beta limits and record that. |

## Coverage summary (FR/SC to tasks)

| Requirement | Task(s) | Note |
|---|---|---|
| FR-001, FR-002, FR-003, FR-004, FR-005 | T004 | cited sources, "no source" |
| FR-006 | T006 | ordering vs non-blocking undefined (A4) |
| FR-007, FR-021 | T006 (+T003 kind, T004 entry) | match definition (cost-evals CHK016) |
| FR-008 | T005, T006 | scoping (A7) |
| FR-009 | T007 | |
| FR-010, FR-011 | T008 (T005) | A5, A6 |
| FR-012 | T003, T004 | A2 |
| FR-013 | T003, T004 | A3 |
| FR-014 | T004 | no test of the later backend swap (interface only) |
| FR-015 | T009 | A16 |
| FR-016 | T002, T005 | no SC, A9, A10 |
| FR-017 | T004 | SC-008 test only in T004; add to T005/T006 (store down) |
| FR-018 | T003, T004 | T006/T007 lack isolation assertion (A10) |
| FR-019 | T004 | |
| FR-020 | T001, T008 | A1 |
| SC-001, SC-003 | T010 (plan only) | no measuring task |
| SC-002, SC-004 | none | A11 |
| SC-005 | T008 | |
| SC-006 | T003, T004 | |
| SC-007 | none (T010 plan) | denominator undefined (cost-evals CHK008) |
| SC-008 | T004 | |
| SC-009 | T009 | |

Tasks with no FR: T001 (spike, serves FR-020/FR-008), T010 (polish). All other tasks map to an FR. FRs without a task: none. SCs without a task: SC-002, SC-004, SC-007 (measurement only).

Beta rule FR-018: respected by T002–T010 by design (no task writes to agent input). Verified weakly: only T004 asserts it (A10); A2 shows a forgeable path via the Commentary kind.

Naming drift vs repo: `CommentaryStore` and `recordSpecTurn` match; `workerProfiles.ts`, `evalScoreboard.ts` exist per R-4/R-5 reuse; the "worker transcript redaction" named in T002/R-6 does not exist, the real one is `CREDENTIAL_ANYWHERE` in `commentary.ts` (A9).

## Re-run 2026-10-06

Source: `/sk.check` re-run, read-only, before implement. Re-read Goal, Rules, spec, plan, research, data-model, contracts, tasks, checklists and the new `.specify/memory/constitution.md` v1.0.0 (ratified 2026-10-06). Budget: `TASK-BUDGET 007-validator-agent: PASS open=12/12 largestCycle=(NO CYCLE):4/6`. Code check: `tasksync-chat/src/validator/` does not exist yet; `COMMENTARY_KINDS` is still `update`/`heads-up` (`commentary.ts:8`) and `CREDENTIAL_ANYWHERE` is still non-exported (`commentary.ts:65`), so every "Fixed" below means fixed in the artifacts, not in code.

### Status of A1-A20

| ID | Status 2026-10-06 | Note |
|---|---|---|
| A1 | Still open (reviewer) | Store choice a/b/c not made; R-1 Consequence (research.md:24) still offers two paths. Blocks T005, T008 |
| A2 | Fixed (artifacts) | tasks.md T003, R-3, contract agree |
| A3 | Fixed (artifacts) | T003, R-4, data-model |
| A4 | Still open (reviewer) | FR-006 ordering/timeout undecided. Blocks T006 |
| A5 | Still open | spec.md wording (reviewer-owned) |
| A6 | Fixed | contract and data-model aligned with R-1 evolve |
| A7 | Fixed | T001(c), T005 test |
| A8 | Fixed | T001(e), T005 test |
| A9 | Fixed in tasks | FR-016 wording in spec.md still reviewer-owned |
| A10 | Still open (spec side) | tasks isolation assertions done; new SC rows need spec.md |
| A11 | Still open (reviewer) | SC-002/SC-004 baselines; affects T010 only |
| A12 | Still open | Assumption in spec.md says "no new source type" |
| A13 | Fixed | T004a/b, T009a/b; budget 12/12 verified |
| A14 | Fixed | T007 depends on T006, no cycle |
| A15 | Still open | task side done, definition is spec.md wording |
| A16 | Fixed | T009a |
| A17 | Still open | naming drift (prompt enhancement / improving the prompt / enhance / proposeContext) |
| A18 | Fixed | T003 profile fields |
| A19 | Still open | quickstart health step when T001 lands |
| A20 | Still open (reviewer) | spec.md Status `Draft` vs plan approved; checklists unticked |

Counts as of 2026-10-06 (historical): open 10 (A1, A4, A5, A10, A11, A12, A15, A17, A19, A20), fixed 10 (A2, A3, A6, A7, A8, A9, A13, A14, A16, A18). See the 2026-10-07 status update below.

### New findings

| ID | Severity | Location | Finding | Recommendation | Status |
|---|---|---|---|---|---|
| N1 | MEDIUM | plan.md:33-40 Constitution Check | Plan still says the constitution is an unfilled template and gates on AGENTS.md. v1.0.0 now exists with principles I-VIII, and Governance says every plan Check verifies compliance. Principles VI (per-workspace observability) and VIII (portable profiles) are not named in the plan. | Rewrite the Check against I-VIII (PASS/NA per principle). plan.md is outside this packet: do it in the next plan edit. | Open |
| N2 | MEDIUM | research.md R-1 (shared server, "not per-workspace"); constitution VI | One agentmemory server holding items of many workspaces, separated only by a `project` tag, sits against "never aggregate across unrelated workspaces" and against a single global forget setting. A dedicated instance with its own `--data-dir` per workspace (option A1-a) satisfies VI; shared (b) is weaker. | Count this in the A1 choice; if (a), T001/T005 use a per-workspace `--data-dir`/`--instance`. | Open (with A1) |
| N3 | MEDIUM | tasks.md T003/T004a; constitution IV, VI | Validator runs record no lifecycle events by worker ID and session ID (start, before/after tool, stop, error) and the MCP tool policy, observability event and secret handling are not stated once at the boundary. T004a only tests the banner cost. | Add to T004a: validator run recorded by worker ID + OpenCode session ID through the existing worker-hook pipeline; test asserts the event. | Open |
| N4 | LOW | tasks.md T009a; constitution I | `evals/validator/` is new, but existing evals are `run-evals.cjs`/`graders.cjs` with JSON cases; T009a scores through `evalScoreboard.ts` only. Unclear which runner executes the suites. | Name the runner in T009a (reuse `run-evals.cjs` format or `evalScoreboard.ts`). | Open |
| N5 | LOW | tasks.md (budget) | Budget is 12/12 open; any new task (e.g. N3 as its own task) breaks the budget. | Fold N3 into T004a or split an existing task. | Open |
| N6 | LOW | constitution Governance; spec.md | Constitution says reviewer approval gates apply; spec.md is still `Draft` (A20) and the reviewer has not ticked the three checklists. | Reviewer resolves with A20. | Open (with A20) |

New counts: CRITICAL 0, HIGH 0 new (A1, A4 stay HIGH), MEDIUM 3 new, LOW 3 new.

### Verdict

Ready to implement now (not blocked by A1 or A4): T001 (spike, needs a local agentmemory server), T002, T003 (parallel), then T004a, T004b. Blocked: T005 and T008 by A1, T006 by A4 and T005, T007 by T005/T006, T009a/b by T004a to T007, T010 by all (A11 only for its baseline step). Fold N3 into T004a before starting it.

## Reviewer decisions 2026-10-07 — current statuses

This update supersedes the historical statuses and verdict above. Decisions are recorded in spec.md and Rules.md; changes to tasks, research, contracts and plan are outside this docs packet.

| ID | Current status | Reviewer decision / remaining work |
|---|---|---|
| A1 | Resolved (reviewer) | "a separate agentmemory server only for the validator, with auto-forget off"; install approved. Dedicated validator server selected; see OPEN topology question under A12. |
| A4 | Resolved (reviewer) | "Validator for few turns it is more like trial basis. I manually see the quality of validator how it is responding on behalf of me." FR-006 and US2 now run alongside, never blocking the reviewer's reply. |
| A5 | Resolved (reviewer) | "keep older versions also, hide them". FR-011/FR-020 and US4 retain superseded versions, hidden from recall and default views; changed flag informational. |
| A10 | Drafted by agent, reviewer to approve | Reviewer said "Sure". SC-010: 0 validator outputs reach any agent channel (chat/worker input, MCP results, hooks, prompt text); SC-011: 0 seeded secrets in any sink (validator input, agentmemory, jsonl, Commentary/UI, logs, cost). |
| A11 | Resolved (reviewer) | "I'll manually see them few days". Manual quality review, no automated baseline in beta; SC-002 deferred until linking. |
| A12 / D22 | Resolved migration decision; topology OPEN | "memories md files are source of truth, we can seed memories built so far from them, but we dont use or update them going forward... We are changing memory solution and at the same time, we are using the same for validator also." Assumption and FR-023 draft: agentmemory replaces VS Code `/memories` md files for agents, seeded once then frozen. OPEN: shared agent/validator server conflicts with A1's "only for the validator". Rebuild-from-index is not decided by this statement. |
| A15 | Drafted by agent, reviewer to approve | Reviewer said "Sure". Observed = passed through cheap check; skipped = checked pure progress not sent to answering validator; skips counted and visible in Commentary stats. |
| A20 / N6 | Needs reviewer — more details requested | Spec stays Draft; checklist approval/defer decisions are not inferred. |

New FR-022 records: "if it uses as memory store, agent should be able to call it for memory needs" — agents can query the same store, without routing validator output to agent channels.

Current A1–A20 counts: resolved/fixed 15, awaiting approval or otherwise open 5 (A10, A15, A17, A19, A20). A12's migration decision is resolved, but server topology and rebuild-from-index remain OPEN; N2 workspace isolation is not implicitly resolved. A1/A4 no longer block on reviewer choice; installation/spike and task dependencies still apply.
