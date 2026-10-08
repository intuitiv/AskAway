# ADR 0020: Webex browser OAuth returns through a local masked prompt

- Status: Proposed
- Date: 2026-10-08
- Goal: G7 in [GOALS.md](../../GOALS.md)
- Amends: authentication in [ADR 0018](0018-webex-replaces-telegram.md); its Accepted status and other decisions remain unchanged.

## Context

The reviewer confirmed the redirect and manual browser return after the callback POC. The earlier authorization/token-storage ask remains valid; manual raw-token entry in spec 009 US1 is superseded, not the command or secure storage boundary.

## Decision

Reviewer verbatim, 2026-10-08:

> http://localhost:5000/callback is redirect url
> COmmand should refresh main token, by opening url in browser and all. I'll do auth in the browser and give back redirected url, from that you can do the rest

- Each command invocation starts fresh browser authorization with exactly `http://localhost:5000/callback`.
- No local listener runs. The reviewer returns the full address-bar URL through a local masked VS Code prompt, NEVER chat; validated code exchange completes authorization and secure access/refresh-token storage.
- Later requests reuse stored authorization and refresh when needed; command invocation still opens the browser.

## Consequences

- The browser may show connection refused at localhost; the user must copy the full address-bar URL into the local prompt only.
- Callback POC and confirmation are done; implementation/testing remain open until builder and independent gates pass. No deployment claimed.

## Related

- [Requirements](../../tasksync-chat/docs/requirements/telegram.md) R-TELE-24–28
- [Spec 009](../../specs/009-webex-remote-channel/spec.md) US1, FR-029/030; [tasks](../../specs/009-webex-remote-channel/tasks.md) T024–T028, T007
