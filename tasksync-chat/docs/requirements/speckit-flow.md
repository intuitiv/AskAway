# Spec Kit guided flow

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-SKFLOW-01 | The reviewer only says what they want, answers a few questions, and approves three gates (what, how, done). | "approves at three gates: what (spec accepted), how (plan accepted), done (converge + readiness)" (2026-09-29) | gap |
| R-SKFLOW-02 | Each spec's current stage is tracked with Spec Kit's own stage names. | "Always track the current stage per spec, named as Spec Kit names it." (Rules.md 005, 2026-09-29) | `PASS test-spec-stages` |
| R-SKFLOW-03 | The flow runs specify, check, plan, check, tasks, check, implement, check; required stages are never skipped. | "specify → /sk.check (clarify) → plan → /sk.check (checklist) → tasks → /sk.check (analyze) → implement → /sk.check (converge)" (Rules.md 005, 2026-09-29) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR |
| R-SKFLOW-04 | Clarify, checklist, analyze and converge are all one command, `/sk.check`. | "ONE command, /sk.check, not separate commands." (Rules.md 005, 2026-09-29) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR |
| R-SKFLOW-05 | `/sk.check` asks at most five questions, and only when two answers would change code or tests. | "asks at most five questions, and only asks when two answers would change code or tests" (2026-09-29) | gap |
| R-SKFLOW-06 | Plain text works without Spec Kit knowledge: new work, continue, answers, "this is wrong" and "done?" are routed to the right stage. | "Link all of them through comamnds so that if i give normal text, i can work without speckit." (2026-09-29) | gap |
| R-SKFLOW-07 | Small changes (typo, dependency bump, already-specified bug) go straight to a change with a test, with no spec. | "small, e.g. typo, dependency bump, bug whose behavior is already specified → direct change with a test, no spec" (2026-09-29) | gap |
| R-SKFLOW-08 | Stories, not custom phases and cycles, are the unit of work, each verified by its Independent Test and success criteria. | "can we use stories instead of phases and cycles?" (2026-09-29) | `PASS test-spec-stories` |
| R-SKFLOW-09 | Tasks use the standard `[USn]` story tag and `[P]` parallel marker. | "Parallel work uses the standard [P] marker." (Rules.md 005, 2026-09-30) | gap |
| R-SKFLOW-10 | A story is 3-5 days to a week of work and is merged through one active PR per spec, never one PR per day. | "One active PR per spec... Never one PR per day." (Rules.md 005, 2026-09-30) | gap |
| R-SKFLOW-11 | Spec Kit may not flood a spec with tasks. | "speckit goes crazy and creates 100s of tasks. We should keep them in control." (2026-09-28) | test-task-budget.cjs EV-049 |
| R-SKFLOW-12 | Derived artifacts are marked stale when an upstream one changed later. | "the derived one is shown stale and the next step is to refresh the earliest owning artifact" (2026-09-29) | `PASS test-spec-staleness` |
| R-SKFLOW-13 | The done gate reports one readiness receipt; no evidence means BLOCKED, never PASS. | "a check that could not run is never a pass" (2026-09-29) | `PASS test-spec-readiness` |
| R-SKFLOW-14 | `/pr-daily` makes the PR merge-ready each day, fixing what it can, never pausing for work in progress, and asking before merging. | "what is 30 min pause window? Why pause? We fix as much as we can" (2026-09-29) | test-pr-daily-facts.cjs EV-PR-DAILY |
| R-SKFLOW-15 | `/pr-daily` runs in the reviewer's own workspace, with no central service. | "I'll run this agent on that respective workspace. I dont want some central thing" (2026-09-29) | test-pr-daily-facts.cjs EV-PR-DAILY |
| R-SKFLOW-16 | Spec Kit's own `speckit.*` agent files are not edited; customisation lives in `/sk.*` wrappers. | "Spec Kit's own speckit.* agent files are org-owned and must not be edited" (2026-09-29) | gap |
| R-SKFLOW-17 | Working on a non-active feature needs no active-feature guard. | "Generally i dont make frequent swithces so, i think i am good here on working on non-active feature." (2026-09-29) | gap |
| R-SKFLOW-18 | Every task belongs to a spec. | "speckit should be native. all tasks should be associated to spec." (2026-09-28) | gap |
