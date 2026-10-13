# ADR 0022: A cloud change is merged locally, tested, then pushed

- Status: Proposed
- Date: 2026-10-13
- Goal: G9 in [GOALS.md](../../GOALS.md)
- Supersedes: "Nothing is pulled, merged or pushed automatically" in [ADR 0019](0019-cloud-task-done-shares-pr-link.md)

## Context

006 T016 asked for automatic records and pushes, which conflicted with ADR 0019. The reviewer resolved it.

## Decision

> Pushing to remote branch from local changes is okay. But when we get some change from cloud, we need to validate it doesnt break anything from local and all, so run some tests after merge and push to branch. (2026-10-13)

- When a cloud task's change arrives on the active PR branch, AskAway merges it into the local branch and runs the task's verification commands.
- It pushes to the branch (never force) only when the merge is clean and the tests pass.
- On a conflict or a failing test nothing is pushed, the local branch returns to its pre-merge commit, and the task shows why.
- It does not run when the checkout is not on the PR branch or has uncommitted changes.
- The PR link is still shared when the task is done (ADR 0019).

## Consequences

- Cloud work reaches the branch only after it passed local tests.
- Guarded by `tasksync-chat/test-cloud-merge.cjs` EV-CLOUD-MERGE; rows R-CLOUD-17/18 in `tasksync-chat/docs/requirements/cloud-tasks.md`.
