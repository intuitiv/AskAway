# Contract — US1 evidence note and signal fixture

## Evidence note — `specs/006-cloud-tasks/evidence/proof-<YYYY-MM-DD>.md`

Every row must have a value; "unknown" is not allowed (SC-001). A route failure is a value ("no response after 10 min").

| Question | Answer | Proof |
|---|---|---|
| Same-branch push | yes/no | commit sha(s) + `gh pr view --json headRefName` + `gh api .../commits/<sha>/pulls` |
| New branch / PR created | yes/no | `gh pr list --author <agent login>` before/after |
| Model that ran | name | session log link / PR timeline text |
| Model selectable from posted comment | yes/no + how tried | comment text used, observed model |
| Signals observed, in order, with timestamps | 👀 reaction, started-work event (exact event name), commits, check runs, report comment | raw `gh api` excerpts |
| Actions on agent push | ran / held for approval / did not run | check-run conclusions (`action_required`?) |
| Repo setting "Require approval for workflow runs" | on/off | observed behaviour |
| Cloud agent login(s) | e.g. commit author + comment author | raw values |
| Two comments → two concurrent sessions on one PR? | yes/no | timeline (drives plan C-5) |
| Session duration | minutes | started-work → report |
| Go / no-go | go / stop for reviewer | reason |

## Signal fixture — `tasksync-chat/test-fixtures/cloud-signals-<date>.json`

```json
{ "pr": 12, "comment": { "id": "...", "createdAt": "..." },
  "polls": [ { "at": "...", "reactions": [], "timeline": [], "commits": [], "checkRuns": [], "comments": [] } ] }
```

Raw `gh api` JSON per poll, trimmed of bodies longer than 500 chars; no tokens. The state machine test replays these polls and asserts the state sequence recorded in the note.
