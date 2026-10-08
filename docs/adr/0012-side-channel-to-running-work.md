# ADR 0012: Side channel to running work
- Status: Proposed
- Date: 2026-10-08
- Goal: G12 in [GOALS.md](../../GOALS.md)

## Context
The reviewer cannot see what is happening inside worker tools. He needs to know whether he should act and wants to steer the agent's thinking. Asking a side question in the main conversation currently diverts the task and makes the agent forget its work.

## Decision
Provide a side channel into running work. Let the reviewer see what is happening, decide whether he must act, nudge the agent, and ask side questions without losing the main task.

> With worker tools, I am not able to see what's going in side. This helps me (2026-10-08)

> - Decide if I need to do anything, like run some commands and all (2026-10-08)

> - Nudge agent to think in a different way (2026-10-08)

> - Ask some side question while doing current task. This is important. Currently when I ask in main agent, then topic gets diverted to a different direction altogether and forgets what it has been doing. (2026-10-08)

## Consequences
- Running worker activity is visible enough to judge whether help is needed.
- The reviewer can offer a different direction of thought during work.
- Side questions can be answered while the current task continues.
- A side question must not make the main agent forget or abandon its topic.

## Related
- [Side-channel requirements](../../tasksync-chat/docs/requirements/side-channel.md)
- [Worker side-channel spec](../../specs/003-worker-side-channel/spec.md)
