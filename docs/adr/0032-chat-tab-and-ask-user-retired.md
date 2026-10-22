# ADR 0032: Chat tab and ask_user are retired

- Status: Proposed
- Date: 2026-10-22
- Goal: G4 in [GOALS.md](../../GOALS.md)
- Supersedes: R-AITALK-02 clause "Chat remains last until A3"; R-TELE-11.

## Context

AITalk delivers messages and questions. The Chat tab and the `ask_user` tool no longer have users.

## Decision

> Yes retire Chat tab and ask_user. (2026-10-22)

- The tab bar is AITalk, Specs, Trace, Workers, Settings (R-LIVE-26, R-LIVE-27).
- Telegram and Webex remote question and reply handling stays.
- Chat Autopilot and the pending-request queue are removed together with `ask_user`; worker-autopilot remains a separate feature.

## Consequences

Docs, README and Storybook show no Chat column or ask_user tool.
