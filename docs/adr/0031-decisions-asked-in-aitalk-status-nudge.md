# ADR 0031: Decisions are asked in AITalk as they arise; a two-minute status nudge

- Status: Proposed
- Date: 2026-10-21
- Goal: G4 and G8 in [GOALS.md](../../GOALS.md)
- Supersedes: ADR 0003 in part (questions no longer wait for the end of the turn) and R-ORCH-26 (four minutes becomes two).

## Context

With AITalk delivering messages on the next tool call, the agent no longer has to hold every question until the last turn, and the reviewer is blind when the agent stays quiet for minutes.

## Decision

> we should update our prompts to ask questions in aitalk about deicsions so that agent need not hold all questions/updates till last turn to post all questions. (2026-10-21)

- A decision or needed input is asked at once as an AITalk heads-up with options and a recommended default; the agent carries on with the default and the answer arrives with a later tool result (R-ORCH-33).
- Questions still open at the end of the turn stay in the one Response Handoff batch, so ADR 0003 still holds for those.
- After two minutes without a post, PostToolUse reminds the agent to send a short status update; the agent talks through the commentary tool (R-ORCH-32).

## Consequences

The reviewer may get several small questions during a turn instead of one batch; the recommended default keeps the agent moving, and the Validator can answer when he is away.
