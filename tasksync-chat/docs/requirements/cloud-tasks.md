# Cloud tasks (GitHub Copilot cloud agent)

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-CLOUD-01 | Flagged tasks are delegated to the GitHub Copilot cloud agent so work runs while the reviewer is offline. | "This is where we'll go eventually, plan this part very carefully. I am counting on this feature." (2026-09-30) | gap |
| R-CLOUD-02 | The cloud agent works on the spec's one active PR branch, not a new branch per task. | "Update the same branch (the active PR), not a new branch per task." (Rules.md 005, 2026-09-30) | `PASS test-cloud-proof` |
| R-CLOUD-03 | A committed, self-contained packet per task states stage, task, scope, checks and stop condition, and the PR comment only references it. | "context is referenced from committed artifacts, not repeated" (Rules.md 005, 2026-09-30) | `PASS test-cloud-proof` |
| R-CLOUD-04 | The model is selectable where GitHub allows it. | "The model should be selectable." (Rules.md 005, 2026-09-30) | `PASS test-cloud-proof` |
| R-CLOUD-05 | Secrets never go in packets or comments. | "secrets never go in packets or comments" (2026-09-30) | `PASS test-cloud-secrets` |
| R-CLOUD-06 | A flagged task shows a button to queue it. | "A flagged task has a button to queue it" (Rules.md 005, 2026-09-30) | gap |
| R-CLOUD-07 | The extension polls the PR and shows each task's status from Queued to Accepted or Returned. | "the extension polls periodically and updates its status" (Rules.md 005, 2026-09-30) | gap |
| R-CLOUD-08 | A queued task is ticked only after a local verify worker confirms its named evidence. | "a queued task is ticked only after a local verify worker pulls the branch and the task's named evidence passes" (2026-09-30) | gap |
| R-CLOUD-09 | Never two cloud tasks on the same files at once, and developer-versus-cloud pushes are surfaced. | "never two cloud tasks on the same files at once" (2026-09-30) | gap |
| R-CLOUD-10 | The first slice is a live proof on a real PR before any full UI. | "First slice is a live proof: post one comment on a real PR" (2026-09-30) | `PASS test-cloud-proof` |
| R-CLOUD-11 | The extension shows duration and model, never an invented price. | "no per-session price is exposed, so the extension shows duration and model, never an invented price" (2026-09-30) | gap |
| R-CLOUD-12 | Cloud work runs only on the reviewer's demand, for online work while away or for parallel work. | "Cloud actions are more for running taks online when I am away or run things in parallel. This is completely when user needs it." (2026-10-08) | gap |
| R-CLOUD-13 | Any independently runnable user story or single task can be delegated to the cloud. | "Whatever part is independly runnable that can be delegated to Cloud." (2026-10-08) | gap |
| R-CLOUD-14 | Cloud work runs on GitHub with tracked progress and notifies the reviewer when done so he can review and merge the PR. | "This should trigger on GitHub actions and track the progress and when done it should notify me." (2026-10-08) | gap |
