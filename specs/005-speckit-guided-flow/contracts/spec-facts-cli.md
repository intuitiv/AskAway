# Contract — `tools/spec-facts.cjs`

One read-only CLI that every extension flow (`/sk.continue`, `/sk.handoff`, `/pr-daily`, wrappers) uses to learn a spec's stage, so they all agree with the Specs tab (FR-013, SC-005). It calls the same compiled module the Specs tab uses.

```
node tasksync-chat/tools/spec-facts.cjs [<slug>|<NNN>] [--json] [--root <workspace>]
```

- No slug → active feature from `.specify/feature.json`; if none, exit 2 with `no active feature; pass a slug`.
- Unknown slug → exit 2 with `unknown spec: <arg>`.
- `--json` output (exit 0):

```json
{
  "slug": "005-speckit-guided-flow",
  "storedStage": "plan", "stageSource": "records|artifacts",
  "impliedStage": "plan", "mismatch": null,
  "nextStep": "/sk.check (checklist)", "stageButton": "Tasks",
  "stale": [{ "artifact": "tasks.md", "upstream": "plan.md", "reason": "upstream-newer" }],
  "branch": "005-us1-stage", "activePr": "https://github.com/o/r/pull/12",
  "costAiu": 12.4, "agentMinutes": 83, "runs": 7, "skippedRecords": 0,
  "stories": [{ "id": "US1", "done": 4, "total": 6, "independentTest": "...", "checkpoint": null }],
  "readiness": null
}
```

- Text output: `<slug> · stage <storedStage> · next <nextStep>` then one line per stale artifact / mismatch.
- Never writes. Never prints secrets or prompt text.
