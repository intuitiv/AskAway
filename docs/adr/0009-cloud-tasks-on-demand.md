# ADR 0009: Cloud tasks on demand
- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G9 in [GOALS.md](../../GOALS.md)

## Context
The reviewer wants work to run online while he is away or alongside other work. Cloud work is useful only when he asks for it. An independently runnable part may be a whole user story or one task.

## Decision
Run cloud work only on the reviewer's demand. Allow delegation at story or task level. Run it on GitHub, track progress, and notify the reviewer when the work is done and the PR is ready for review and merge.

> Cloud actions are more for running taks online when I am away or run things in parallel. This is completely when user needs it. (2026-10-08)

> It could be at User story level or it can also be at task level. Whatever part is independly runnable that can be delegated to Cloud. (2026-10-08)

> This should trigger on GitHub actions and track the progress and when done it should notify me. So that I can take that PR back and review and merge. (2026-10-08)

## Consequences
- Cloud work does not start merely because the reviewer is away.
- Both independently runnable stories and individual tasks can be delegated.
- GitHub work has visible progress and a completion notification.
- The reviewer can return to review and merge the PR.
- The PR arrangement remains an open question, not a new decision here.

## Related
- [Cloud task requirements](../../tasksync-chat/docs/requirements/cloud-tasks.md)
- [Cloud tasks spec](../../specs/006-cloud-tasks/spec.md)

## Answered
**Cloud PR (G9), 2026-10-08:** "Sure same PR will reduce the load, but we need to pull latest changes to local, once the story is done." Cloud work commits to the spec's one active PR; when the story is done, its latest changes are pulled to the local checkout.
