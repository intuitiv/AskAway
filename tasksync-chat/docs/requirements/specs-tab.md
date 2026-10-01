# Specs tab

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-SPECS-01 | Every spec card shows its Spec Kit stage, the stage's button and `/sk.check`. | "The Specs tab shows the stage's button (plan, tasks, implement…) and /sk.check at all times" (Rules.md 005, 2026-09-29) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR |
| R-SPECS-02 | A spec card has one row of command buttons, the stage bar; `spec.md` / `tasks.md` are links in that row, with no bottom button row. | "Buttons at 2 places" (2026-10-01); "I still see buttons on top and at the bottom of the spec card." (2026-10-01) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR, EV-SPECS-ONE-ACTION-ROW |
| R-SPECS-03 | When the next step equals the current stage it reads as continuing, not as a contradiction. | "If next is Implement, why the current stage is implement." (2026-10-01) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR |
| R-SPECS-04 | Staleness is stated in plain words, once per upstream file. | "Lot of text like `changed later`, what do they mean?" (2026-10-01) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR |
| R-SPECS-05 | Each stage has its own pastel colour. | "different colors for different stages of spec. Use pastle colors" (2026-10-01) | test-specs-webview-regression.cjs EV-SPECS-STAGE-BAR |
| R-SPECS-06 | Two switches, All (other specs) and Completed, keep the list short. | "the Specs tab has two switches, All (specs other than the active one) and Completed." (Rules.md 005, 2026-09-30) | test-specs-webview-regression.cjs EV-SPECS-ACTIVE-VISIBLE |
| R-SPECS-07 | The active spec is always visible, even when its tasks are all done. | "001 is active spec but it is hidden and says spec is completed. But we are still working on it." (2026-09-28) | test-specs-webview-regression.cjs EV-SPECS-ACTIVE-VISIBLE |
| R-SPECS-08 | Tasks group under standard user stories (Setup, Foundational, US1.., Polish) instead of custom phases and cycles; legacy cycles still render. | "can we use stories instead of phases and cycles?" (2026-09-29) | `PASS test-spec-stories` |
| R-SPECS-09 | A derived artifact is shown stale when an upstream artifact changed after it. | "When an upstream artifact changes after a derived one, the derived one is shown stale" (2026-09-29) | `PASS test-spec-staleness` |
| R-SPECS-10 | Branch, active PR, cost spent and agent time are stored per spec, mapped by spec name, and displayed. | "we store spec related data like, branch, active PR, cost spent, time spent by agent and so on" (2026-09-29) | `PASS spec cost ledger` |
| R-SPECS-11 | Run records are kept per spec under `.askaway/specs/`. | "in askaway folder, we store spec related data" (2026-09-29) | `PASS test-spec-run-records` |
| R-SPECS-12 | The done gate shows one readiness receipt where a check that could not run is never a pass. | "a check that could not run is never a pass" (2026-09-29) | `PASS test-spec-readiness` |
| R-SPECS-13 | Task creation stays small; speckit must not produce hundreds of tasks. | "speckit goes crazy and creates 100s of tasks. We should keep them in control." (2026-09-28) | test-task-budget.cjs EV-049 |
