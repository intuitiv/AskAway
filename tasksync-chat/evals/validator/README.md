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
