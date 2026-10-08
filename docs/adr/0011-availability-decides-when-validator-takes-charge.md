# ADR 0011: Availability decides when the validator takes charge
- Status: Proposed
- Date: 2026-10-08
- Goal: G11 in [GOALS.md](../../GOALS.md)

## Context
The reviewer often starts work and then leaves or logs off for the day. He may be away briefly, for hours, or until he announces his return. The validator needs to know when he is unavailable.

## Decision
Let the reviewer set his availability for a duration or until he says he is back. Use that availability to tell the validator when to take charge.

> Generally I run something and go away or log off for the day. In such case, I set the availability like away for next 30 min or few hours or away till say I am online and all. (2026-10-08)

> This helps validator agent when to take charge. (2026-10-08)

## Consequences
- The reviewer can declare an absence of 30 minutes or a few hours.
- He can stay marked away until he says he is online again.
- Availability guides when the validator acts for him.
- Starting work alone does not express how long the reviewer will be away.

## Related
- [Availability and validator requirements](../../tasksync-chat/docs/requirements/availability-and-validator.md)
- [Validator agent spec](../../specs/007-validator-agent/spec.md)
