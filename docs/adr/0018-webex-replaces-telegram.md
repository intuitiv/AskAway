# ADR 0018: Webex replaces Telegram as the remote channel

- Status: Accepted (reviewer's answers, 2026-10-08)
- Date: 2026-10-08
- Goal: G7 in [GOALS.md](../../GOALS.md)
- Amends: [ADR 0007](0007-telegram-is-a-remote-control.md) (the remote control stays; its channel changes)

## Context

The reviewer's org reported an issue with Telegram. He wants Telegram off and the same remote control on Webex.

> And another thing i want to add is, my org reported issue of using telegram, so can we turn telegram off and use webex instead? I can give telegram token. Same thing should just work for webex also.

AskAway already has a Webex service for `ask_user` questions (Adaptive Cards, threaded reply polling, OAuth refresh), but it lacks the Telegram turn features: live commentary in one edited message, a notifying final, the 2-minute status, the cost banner, the handoff PDF, 429 handling, and stopping when VS Code replies. The Telegram callers talk to the Telegram service directly.

## Decision

> can we turn telegram off and use webex instead? (2026-10-08)

> Same thing should just work for webex also. (2026-10-08)

> Keep telegram code, it is just toggled off. (2026-10-08)

> Token storage is through command. (2026-10-08)

> we cannot expose my laptop to public api. So, our option is long poll, like we do for telegram (2026-10-08)

> we create a space per workspace and post message there. And we have a General space also, so we use it same as that of General of telegram. (2026-10-08)

> We send docs to self.General space instead of telegram. (2026-10-08)

- Telegram is toggled off (`askaway.telegram.enabled: false`); its code stays. When off it makes no Telegram calls.
- One remote-channel interface serves every caller; Telegram and Webex are two adapters behind it, so both show the same thing (G16).
- Webex reaches parity with every row of [telegram.md](../../tasksync-chat/docs/requirements/telegram.md).
- The token is set by the command "AskAway: Set Webex Token" into VS Code SecretStorage, mirrored to the macOS Keychain for share-with-me; never in settings or chat. The integration's client id and secret come from `~/.webex.md`.
- Replies are polled (Webex has no long poll; the poll interval backs off like Telegram's). No webhook, no public endpoint.
- Team `self`: one space per workspace, created when missing; the team's General space is used like Telegram's General.
- share-with-me sends documents to self.General instead of Telegram.
- Notifications: posts made with his own token never notify him and bots are disabled in his org, so messages that must notify go through each space's Incoming Webhooks URL, configured from a startup prompt (or automatically if an API allows). The setup is linked to `askaway.webex.enabled`.

> And bots are not enabled in our org. (2026-10-08)

> webex integration setting is marked as disabled. link our setup to that setting. (2026-10-08)

## Consequences

- The org's Telegram issue goes away without losing remote monitoring.
- Callers stop depending on Telegram types; a third channel would be one more adapter.
- Telegram tests keep guarding the shared behaviour; Webex gets the same caller-view tests.

## Related

- [Telegram requirements](../../tasksync-chat/docs/requirements/telegram.md) R-TELE-18
