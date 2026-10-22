# ADR 0037: Webex digest from one shared in-memory index

- Status: Proposed
- Date: 2026-10-22
- Goal: the Webex goal in [GOALS.md](../../GOALS.md) (G7)

## Context

The reviewer wants a daily report of what needs him in Webex, covering everything he is part of, without reading it all each time. Each workspace window can call Webex on its own, which repeats the same reads and hits rate limits. One VS Code window owns the AskAway MCP server, so one process already serves every workspace.

## Decision

> Our webex thing can be a 1 sync call may be recurring if not before any tool call, and store stuff in memory and everything should be served from in memory data structures, so we can reuse across workspaces. From in memry we can do daily report on the fly(when asked, like a tool. call). (2026-10-22)

- One sync loads his spaces, last activity, own posts, mentions and replies into in-memory structures in the MCP-owning process. It runs before a Webex tool call when the data is older than a few minutes. A recurring refresh may be added later.
- Nothing but the mute list and the seen watermark is persisted; message text never touches disk.
- The report is `inbox` with `mode: digest`, not a thirteenth tool (R-CATHY-01 caps the set at 12). It is read-only.
- Spaces are excluded as spam, never for privacy: a mute list plus a six-month quiet rule. A mention or a reply to him always shows. Webex has no read receipts, so his own posts and mentions stand in for "read".
- A push reply alert is not built; the reviewer is "not very clear about reply alert yet".

## Consequences

Every workspace sees the same data and one sync serves all. If the owning window closes, another window takes ownership and the index rebuilds with one sync. The digest can be stale by the freshness limit. Reply alerts remain a later decision.
