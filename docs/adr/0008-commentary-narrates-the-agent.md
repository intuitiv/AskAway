# ADR 0008: Commentary narrates the agent

- Status: Proposed
- Date: 2026-10-08
- Goal: G8 in [GOALS.md](../../GOALS.md)

## Context

The reviewer cannot wait until the final response to understand what the agent is doing. He cannot read, digest and respond within five minutes. He needs time to prepare, see blockers and steer work that is heading in a different direction.

## Decision

In orchestrator mode, use commentary to give a high-level view of what the agent is doing, where it is blocked and whether it needs help. Let the reviewer prepare for the response and steer the work. Once the validator has proven its worth, let it monitor the flow and suggest to the agent immediately; the agent can also ask it when in doubt.

> In Orchestrator mode, Commentary gives some high level idea what agent is doing where it is blocking so that I'll be prepared as a human, I cannot read, digest and respond with in 5 min. But… once Validator agent proves to be worth then it can monitor the flow and suggest immediately to the agent or agent can ask validator when in doubt. (2026-10-08)

> Commentary is important in agents these days. I am not able to understand what's going on with in agent till the very end. Where it is did it stuck somewhere or does it need any help and all. Comentary will help me understand the thought process and prepare for agent response and guide when it is going in a dfiferent direction. (2026-10-08)

## Consequences

- Commentary gives a high-level view during work, not only at its end.
- Blockers and requests for help become visible early.
- The reviewer has time to prepare and redirect the agent.
- Validator monitoring and suggestions follow proof that the validator is worthwhile.

## Related

- [Live tab requirements](../../tasksync-chat/docs/requirements/live-tab.md)
- [Orchestrator requirements](../../tasksync-chat/docs/requirements/orchestrator.md)
