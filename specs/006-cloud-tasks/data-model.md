# Data Model — 006 Cloud Tasks

## Cloud-eligible task (in `tasks.md`)
Tag after the ID: `[cloud]` or `[local: <reason>]`. Scanner exposes `task.tags` (005 D-21). Rules (all must hold for `[cloud]`): self-contained, estimated ≤ ~45 min, no open question, no local service.

## Task packet (committed)
See [contracts/packet.md](contracts/packet.md). Immutable once pushed; a re-queue writes attempt `n+1`.

## Cloud task run (local, gitignored)
See [contracts/cloud-run.schema.json](contracts/cloud-run.schema.json). Written only by the extension's poller/queue (one writer). `history[]` is append-only.

### States and transitions

| From | Signal | To |
|---|---|---|
| (new) | overlap / one-at-a-time rule | Held |
| Held | blocking task terminal | Queued (comment posted) |
| Queued | 👀 on our comment or started-work event | Working |
| Queued | 10 min without either | No response |
| Working / Pushed | agent commit after `base` on PR branch | Pushed |
| Pushed | all check runs completed | Checks passed / Checks failed |
| Pushed | any check `action_required` | Checks waiting for approval |
| any active | agent comment `Report <taskId>` or question | Needs review |
| any active | ceiling / 59 min exceeded | Timed out |
| any active | PR closed/merged, agent opened a new PR/branch | Returned |
| Needs review | acceptance pass | Accepted |
| Needs review | acceptance fail / out-of-scope / Status changed | Returned |

Terminal: Accepted, Returned, Timed out, No response.

## Evidence note
See [contracts/evidence-note.md](contracts/evidence-note.md).

## Morning digest line (per changed run)
`<taskId> · <state> · PR #<n> · <duration> · <model> · evidence: <link|last verify line> · blocker: <text|none> · decision: <text|none>` — no price.

## 005 run record (on terminal state)
`kind: worker`, `command: cloud:<taskId>`, `stageAfter: null`, `agentMs` = startedAt→endedAt, `cost: {nanoAiu: 0, requests: 0}`, plus `model` and `state` fields.
