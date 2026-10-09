# Contract — Task packet and PR comment

## Packet file

Path: `.askaway/specs/<slug>/packets/<taskId>-<n>.md` (`n` = queue attempt, starting at 1). A task may be re-queued as attempt n+1 after Timed out or No response. The `base` field is the PR head sha before this packet commit; the packet is committed and pushed to the active PR branch before the comment is posted, and the comment references that packet commit sha.

Reviewer GO 2026-10-07: "Sure productise cloud thing. As it is triggered only when i ask for it. Not always." Every queue attempt needs an explicit reviewer request; no automatic eligibility/startup/scheduled launches by default. Hold additional requested tasks locally until the active attempt reaches Needs review/terminal; one posted active attempt per PR including pre-acknowledgment Queued. AskAway never merges ("do not merge PRs").

```markdown
---
stage: implement
story: US2
task: T014
draft: false
base: 1a2b3c4d5e6f
allowedPaths:
  - tasksync-chat/src/cloud/packet.ts
  - tasksync-chat/test-cloud-packet.cjs
verify:
  - cd tasksync-chat && npx tsc -p ./ --noEmit
  - cd tasksync-chat && node test-cloud-packet.cjs
expect: "test-cloud-packet: 9 passed, 0 failed"
ceilingMinutes: 45
stopCondition: Stop and ask on any undecided behaviour instead of guessing. Stop when verify passes.
reportFormat: |
  Report T014
  - Result: done | blocked
  - Commits: <sha list>
   - Verify output: <last line of each command>
   - Model: <self-reported name, or not observed: reason>
  - Question (if blocked): <one question>
---

## Task details
- [ ] T014 [cloud] [US2] Build packet writer in tasksync-chat/src/cloud/packet.ts
  - <indented sub-bullets copied from tasks.md>

## Story Independent Test
<copied from spec.md for the story>

## Read before starting (committed artifacts, not repeated here)
- specs/<slug>/spec.md, plan.md (Decision Register), data-model.md, contracts/
- AGENTS.md, .github/copilot-instructions.md

## Rules
- Push commits to this PR's branch only; prefix each commit message with `[T014]`.
- Never merge a PR; stop and ask rather than pass a human gate.
- Change only `allowedPaths`. Do not change any `**Status**:` line.
```

Required fields (SC-004 counts nine): `stage`, `story`, `task`, task details (body section), `base`, `allowedPaths`, `verify`, `stopCondition`, `reportFormat`. Full `draft` mapping: `true` for `specify`, `clarify`, `plan`, and `tasks`; `false` for `implement` and all later stages (including `converge`/readiness).

## Comment (≤ 5 lines)

Where GitHub allows model selection, prefer Sol 6.1 (`github-copilot/gpt-6.1-sol`) for mid-tier work; Claude Sonnet 5.5 remains an explicit option (reviewer 2026-10-07). This preference does not establish comment-text selection or enforcement; retain the read-only PR-default fallback below.

Line 1 states the task, its story and stage; lines 2-3 state what to do. Everything else is referenced from the committed packet, not repeated. The packet commit message carries the trailer `AskAway-Commit: packet`.

The sha in the comment's packet reference is the packet commit sha, not the packet's `base` sha.

```
@copilot Please do T014 (US2, stage implement) of 006-cloud-tasks: follow .askaway/specs/006-cloud-tasks/packets/T014-1.md at 1a2b3c4.
Work on this PR's branch only; stay inside allowedPaths; run the packet's verify commands.
Stop and ask on anything undecided; reply using the packet's reportFormat.
```

Posted with `gh pr comment <n> --body-file <tmpfile>`; the tmp file is deleted after posting.

## Observed route and report ingestion (2026-10-07)

`evidence/proof-2026-10-07.md`: bot `[PROOF-1]`/`[PROOF-1b]` commits landed on the SAME PR branch; two sessions were sequential. Reactions `eyes`, `copilot_work_started` / `copilot_work_finished`, commits and real bot reports were observed. API author login `Copilot`, app `copilot-swe-agent`, git author `copilot-swe-agent[bot]`; requester `machs_pega` and committer `web-flow` are not report authors to trust.

The first comment appended `Please use Claude Sonnet 5.5 for this task.`; first report claimed that model, second unrequested report claimed GPT-5.6 Terra. Selection/enforcement remains unverified; no comment-text picker enabled, no claim of independently verified runtime model. Read-only PR-default UI plus GitHub picker link follows C-3.

Parse a task-labelled, unquoted `Report <taskId>` line from the authenticated bot, even after a quoted request; never use a whole-body prefix alone or count human/quoted-only echoes. Match task and PR branch/commits before attaching report to the run. Model/verification text is self-reported; set Needs review, never tick or accept without US4 local verification. Actions `copilot` ran without observed approval hold; settings/general workflows not captured, so do not infer approval is off.

## Refusals (before any write, first failing check wins)

`explicit reviewer request required` · `gh not authenticated` · `no active PR for <slug>` · `no push permission on <repo>` · `<taskId> is not cloud-eligible: <reason>` · `<taskId> already queued (<state>)` · `secret detected in <field>`. Holding is not refusal: `held: one cloud task at a time on this PR`; no packet/comment while Held, even for disjoint paths.

## Whole-story delegation (US6)

F23(a), approved 2026-10-10: one explicit story request in `implement` expands to these existing per-task packets/runs on the active PR branch; no aggregate story packet/session or schema change. Every story task must be tagged `cloud` and have no `local:` tag; validate all before posting anything. Existing eligibility, auth/permission and secret checks still apply. Reject an ineligible story rather than delegating a subset.

Expand in `tasks.md` row order, skipping already Accepted tasks without reposting. Preserve each task's exact verification commands, scope, report format and current PR-head base. Only one active attempt per PR; additional explicitly requested work is Held. F24(a): overlap releases at Needs review or terminal just like disjoint work; review does not impose a terminal-only hold.

A queue refusal, blocked report, failing checks/verification, Returned, No response or Timed out stops dispatch of that story's remaining tasks. Unposted tasks stay **Not queued**, without packets/comments; keep them out of generic Held release on failure. A later local failure cannot undo an already-posted task. Retry requires an explicit request for the failed task only; earlier successes are retained and the suffix does not resume automatically. Timed out/No response create attempt n+1; other failed-task retry integration is not built yet. A fresh explicit continuation is required for remaining tasks.

Derive story status from latest task attempts: no runs = Not queued; a failed task = Blocked with task/reason; otherwise show the active task's state, Held when waiting, or Needs review while local acceptance is pending. All tasks Accepted permits the unchanged 005 checkpoint, not immediate story acceptance. Story Accepted requires that checkpoint's local passing evidence; checkpoint failure is Blocked. No report alone ticks tasks, no human gate is passed, and AskAway never merges or starts unrelated work.

F25(b), reviewer 2026-10-10: "dont worry about github internals. If it stops after 60/45 min, so be it." Each packet has its own default-50/max-59-minute ceiling; total story duration may exceed one cap. The guarantee is local Timed out reporting plus GitHub's own hard stop, not remote cancellation or verified remote stop timing. `test-cloud-story.cjs` distinguishes passing existing per-task caller cases from PENDING coordinator/aggregate/checkpoint cases.
