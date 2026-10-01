# Contract — Validator evals

Three suites run by the existing eval harness (`tasksync-chat/evals/`, `run-evals.cjs`, `graders.cjs`); results append to `~/.askaway/evals/results.jsonl` and show on the existing scoreboard (`evalScoreboard.ts`).

| Suite | Input | Expected |
|---|---|---|
| answer | response with a question + fixture spec (Rules.md, ADR, stored items) | decision matches the fixture's reviewer decision, names its source; "no source" when none |
| enhance | short prompt + stored items | proposes exactly the relevant, non-duplicated context; empty when none |
| store | reviewer reply | stores the concise rule (+example) once; nothing for "ok"; supersedes on reversal |

## Gate
A prompt change is accepted only when each suite's score is >= its recorded baseline (FR-015, SC-009). Real reviewer corrections (prediction vs reply) can be added as cases with `origin: reviewer-correction`. Run reports one result per suite.
