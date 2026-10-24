# ADR 0040: AITalk shows an unread count and plays a sound for every new message

- Status: Proposed
- Date: 2026-10-24
- Goal: the AITalk goal in [GOALS.md](../../GOALS.md) (G12)
- Supersedes in part: the "makes no sound" clause of requirement R-AITALK-71, which was an agent's reading of the reviewer's first ask, not his words.

## Context

On 2026-10-23 the reviewer asked for an unread count in the AITalk tab title and, as an alternative, "some small notificatoin sound". The first build showed the count only and kept the view silent. On 2026-10-24 he stated what he wants.

## Decision

> Unread count on tab, and when i click open on aitalk or click on main content of aitalk, count should go away. ANd i need sound for every new message. (2026-10-24)

The decision below is Proposed until the reviewer confirms it.

1. The AITalk tab shows how many messages from others he has not seen.
2. The count goes away when he opens the AITalk tab or clicks in its content.
3. Every new message from anyone but him makes a short sound, including while AITalk is the open tab.

## Consequences

The sound follows the existing notification sound switch, so he can silence it in one place. A busy room is louder: one sound per message, not one per batch. The slower update reminders (R-ORCH-36) keep the room from filling with progress lines.
