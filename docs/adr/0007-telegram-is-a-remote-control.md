# ADR 0007: Telegram is a remote control

- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G7 in [GOALS.md](../../GOALS.md)

## Context

The reviewer is not always near VS Code. He needs to monitor what happens there remotely. Monitoring alone is not enough; he also needs to respond from Telegram.

## Decision

Make whatever happens in VS Code available in Telegram for remote monitoring. Let the reviewer respond to VS Code from Telegram. Telegram is a remote control, not a notification-only channel.

> - I should get whatever is happening in vscode in telegram and monitor remotely. (2026-10-08)

> - I should be able to respond to vscode from telegram (2026-10-08)

## Consequences

- The reviewer can monitor VS Code activity without being at his laptop.
- Telegram receives what is happening in VS Code, not just completion notices.
- Replies from Telegram reach VS Code so the reviewer can respond remotely.

## Related

- [Telegram requirements](../../tasksync-chat/docs/requirements/telegram.md)
