# Quickstart — verify 006

Prerequisites: `gh auth status` logged in with write access; Copilot cloud agent enabled for the repo; an open active PR for the spec.

1. Live proof (US1)
   ```bash
   node tasksync-chat/tools/cloud-proof.cjs --pr <n> --task PROOF-1
   ```
   Expect: `specs/006-cloud-tasks/evidence/proof-<date>.md` with no "unknown" rows and a fixture in `tasksync-chat/test-fixtures/`.
2. Offline tests
   ```bash
   cd tasksync-chat && npx tsc -p ./ --noEmit && node esbuild.js && npm run test:workers   # 0 failed
   ```
3. Queue (US2): enable `askaway.cloudTasks.enabled`, open Specs tab, press "Queue in cloud" on a `[cloud]` task → task row shows Queued; PR has one ≤5-line comment; packet committed.
4. Status (US3): wait one poll interval → Working/Pushed on the row, in the Workers feed and Telegram.
5. Acceptance (US4): on Needs review → verify worker result; Accepted ticks `tasks.md`, Returned shows failing output.
6. Safety (US5): queue two overlapping tasks → second Held with paths; push a local commit during Working → conflict warning.
