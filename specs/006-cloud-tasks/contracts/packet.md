# Contract — Task packet and PR comment

## Packet file

Path: `.askaway/specs/<slug>/packets/<taskId>-<n>.md` (`n` = queue attempt, starting at 1). Committed and pushed to the active PR branch before the comment is posted.

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
- Change only `allowedPaths`. Do not change any `**Status**:` line.
```

Required fields (SC-004 counts nine): `stage`, `story`, `task`, task details (body section), `base`, `allowedPaths`, `verify`, `stopCondition`, `reportFormat`. `draft: true` when `stage` is `specify`, `clarify` or `plan`.

## Comment (≤ 5 lines)

Line 1 states the task, its story and stage; lines 2-3 state what to do. Everything else is referenced from the committed packet, not repeated. The packet commit message carries the trailer `AskAway-Commit: packet`.

```
@copilot Please do T014 (US2, stage implement) of 006-cloud-tasks: follow .askaway/specs/006-cloud-tasks/packets/T014-1.md at 1a2b3c4.
Work on this PR's branch only; stay inside allowedPaths; run the packet's verify commands.
Stop and ask on anything undecided; reply using the packet's reportFormat.
```

Posted with `gh pr comment <n> --body-file <tmpfile>`; the tmp file is deleted after posting.

## Refusals (before any write, first failing check wins)

`gh not authenticated` · `no active PR for <slug>` · `no push permission on <repo>` · `<taskId> is not cloud-eligible: <reason>` · `<taskId> already queued (<state>)` · `secret detected in <field>` · `held: <taskId> overlaps <paths> of working <otherTask>` / `held: one cloud task at a time on this PR`.
