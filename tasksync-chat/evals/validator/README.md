# Validator recorded-output suites

`cases.json` contains answer, enhance and store scenarios with illustrative recorded
fixture outputs, not claims of live model quality. The answer suite also covers the
legacy cheap-check skip and seeded-secret rejection. Skip coverage does not replace
the three beta triggers in FR-019.

Run `node tasksync-chat/test-validator-evals.cjs` from the repository root. It grades
fixtures only and appends three result rows to an isolated temporary results ledger,
then reads that ledger through the existing eval scoreboard. No provider is called,
no user results ledger is touched, and no baseline/regression gate is enforced.

`runRecordedSuites` accepts the existing `evalScoreboard` function and an optional
results file. A later live runner can use the same `gradeCase` predicates on captured
outputs; live dispatch and manual quality review are deliberately deferred.

## Manual review and reviewer corrections

`reviewReport(records)` (in `add-correction.cjs`) prints each suite and case as pass/FAIL with the failed checks,
for a person to read after a prompt change. There is no baseline to compare with in beta.
To add a real reviewer correction (the prediction against the reviewer's reply), run
`node tasksync-chat/evals/validator/add-correction.cjs tasksync-chat/evals/validator/cases.json answer '<case json>'`;
the case is stored with `origin: reviewer-correction` and is graded in every later run.
`node tasksync-chat/test-validator-eval-baseline.cjs` guards both.
