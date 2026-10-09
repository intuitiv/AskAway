# ADR 0019: A finished cloud task shares its PR link; the reviewer finishes it by hand

- Status: Accepted (reviewer, 2026-10-10: "accept")
- Date: 2026-10-08
- Goal: G9 in [GOALS.md](../../GOALS.md)
- Supersedes: the "pull latest changes to local" part of [ADR 0009](0009-cloud-tasks-on-demand.md) (2026-10-08)

## Context

Earlier the same day the reviewer asked that a finished cloud story's changes be pulled into the local checkout. He then chose a lighter path for 006 T021.

## Decision

> For cloud, may be you can share PR link once that task is done so that i'll review and manually do stuff from it (2026-10-08)

- Cloud work still commits to the spec's one active PR.
- When a cloud task is done, AskAway shares the active PR link once: a Commentary line (relayed to the remote channel) and the task's Specs card.
- Nothing is pulled, merged or pushed automatically; the reviewer reviews and finishes by hand.

## Consequences

- No risk of overwriting uncommitted local work, and no pull logic to maintain.
- The reviewer gets one link per finished task wherever he is.

## Related

- [Cloud task requirements](../../tasksync-chat/docs/requirements/cloud-tasks.md) R-CLOUD-16
- [006 tasks](../../specs/006-cloud-tasks/tasks.md) T021
