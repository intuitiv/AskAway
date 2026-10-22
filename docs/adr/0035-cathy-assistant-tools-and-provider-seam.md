# ADR 0035: Cathy's assistant tools use names, macro calls and AITalk approval, behind a provider seam

- Status: Proposed
- Date: 2026-10-22
- Goal: Webex as the remote channel (G7) in [GOALS.md](../../GOALS.md)
- Supersedes: nothing. It extends [ADR 0018](0018-webex-replaces-telegram.md) and refines R-TELE-43 and R-AITALK-19..22.

## Context

Cathy, the Webex worker, has nine tools that take Webex room, person and message ids. One task needs three to five calls, and ids leak into draft cards (the recipient label falls back to the raw room id), find results, the status file, the logs and the Settings hint. A send with no AITalk hook falls back to a modal. The reviewer wants Cathy to act for him, and later to cover Outlook too.

## Decision

> After this finsih spec 009. And i need to have all possible tools for Cathy to chat and read and act on behalf of me. As we have aitalk, Cathy can take persmission from me to send any mesage and all. Room ID is internal so dont show it to me. Space name is what is i see. Instead of agent figuring out things by multiple webex calls, we need tools to optimise that. I will add outlook tool also in future so that Cathy can be my PR or something. (2026-10-22)

- Tools take and return names. Where a follow-up call must point at something, results carry a short opaque `ref` the host resolves; raw Webex ids stay inside the service. Ambiguous names return candidates, never a guess.
- Macro tools (inbox, find, read, search, wait, meetings, plus send, reply, edit, delete, edit draft, style card; at most 12) replace the nine old tools. Nothing outside Cathy uses the old surface, so it is removed.
- Every outbound action is an AITalk draft card (name, thread, full text, files); the reviewer's thumbs-up executes it once. No path sends without the card; the modal remains only as the explicit fallback when AITalk is unavailable.
- Webex is one provider behind `src/services/assistant/provider.ts` (provider, approval request with a human label and no id field, registry), so an Outlook provider reuses the card and the registry.
- Spec 009 finishes first, as story US8 with four build slices.

## Consequences

Cathy needs fewer calls and the reviewer sees only names. "Unread" is AskAway's own view (a seen watermark), because Webex has no unread or mark-as-read API; there is no reaction tool for the same reason, and meetings are read-only because the token has no meeting write scope. Refs reset on reload, so a stale ref asks the caller to look the thing up again. The old LM tool `askaway_webex` and its id-bearing result shape are deleted. Design: [assistant-tools contract](../../specs/009-webex-remote-channel/contracts/assistant-tools.md); rows: [R-CATHY-01..08](../../tasksync-chat/docs/requirements/webex-assistant.md).
