# ADR 0018: Webex replaces Telegram as the remote channel

- Status: Proposed
- Date: 2026-10-08
- Goal: G7 in [GOALS.md](../../GOALS.md)
- Amends: [ADR 0007](0007-telegram-is-a-remote-control.md) (the remote control stays; its channel changes)

## Context

The reviewer's org reported an issue with Telegram. He wants Telegram off and the same remote control on Webex.

> And another thing i want to add is, my org reported issue of using telegram, so can we turn telegram off and use webex instead? I can give telegram token. Same thing should just work for webex also.

AskAway already has a Webex service for `ask_user` questions (Adaptive Cards, threaded reply polling, OAuth refresh), but it lacks the Telegram turn features: live commentary in one edited message, a notifying final, the 2-minute status, the cost banner, the handoff PDF, 429 handling, and stopping when VS Code replies. The Telegram callers talk to the Telegram service directly.

## Decision

Proposed, pending open question 11 in GOALS.md.

> can we turn telegram off and use webex instead? (2026-10-08)

> Same thing should just work for webex also. (2026-10-08)

- Telegram is off (`askaway.telegram.enabled: false`); when off it makes no Telegram calls.
- One remote-channel interface serves every caller; Telegram and Webex are two adapters behind it, so both show the same thing (G16).
- Webex reaches parity with every row of [telegram.md](../../tasksync-chat/docs/requirements/telegram.md).
- Recommended defaults, to confirm: a Webex bot token (its posts notify him; his own token's posts would not), stored in VS Code SecretStorage through a command and never pasted into chat; replies read by polling the bot's 1:1 space (no webhook, no public URL, no new SDK); one channel picker setting.

## Consequences

- The org's Telegram issue goes away without losing remote monitoring.
- Callers stop depending on Telegram types; a third channel would be one more adapter.
- Telegram tests keep guarding the shared behaviour; Webex gets the same caller-view tests.

## Related

- [Telegram requirements](../../tasksync-chat/docs/requirements/telegram.md) R-TELE-18
