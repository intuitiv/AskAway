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
