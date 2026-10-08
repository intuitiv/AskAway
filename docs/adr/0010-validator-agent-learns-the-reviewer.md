# ADR 0010: Validator agent learns the reviewer
- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G10 in [GOALS.md](../../GOALS.md)

## Context
The reviewer wants the validator to know his instructions, guidelines, best practices, ultimate goal and immediate goal. It needs to learn his answers before it can act for him while he is away. Beta gives him a way to see how well it predicts his replies.

## Decision
The validator is a decisioning engine with memory, not a simple memory tool: it decides what the reviewer would decide from his goals, decisions and requirements, and memory is one of its inputs. Teach the validator from the reviewer's real responses, comparing them with its predictions. In beta, it observes user messages and assistant messages occasionally or through an agent-called tool; the agent-called tool comes first. It predicts the reply to the final assistant response, shows the prediction and how good it is, and always reads the reviewer's actual reply to learn. It also serves as the memory tool: load existing memories without deleting them, store new memories from the agent, and return existing memories. When live, it answers for the unavailable reviewer, keeps the same memory role, and reads commentary to tell him what is going wrong.

> Validator knows everything about what I want. All instructions and guidelines and best practices and ultimate goal and immediate goal and everything. It'll learn from my responses and try to answer agents questions and compare teh same with my responses and learn. Over the time it will start picking my brain so that validator agent can do stuff when I am away over night or not near laptop and all. (2026-10-08)

> Remember validator is not a simple memory tool. It is a decisioning engine, with memory. (2026-10-08)

> validator - tool first (2026-10-08)

> - Predict response from final assistant response and show it to me on how good it is. I'll read assistant response and read validators answers to it and give my reply (2026-10-08)

> - Serves as a memory tool, loads existing ones, without deleting them. Creates new memories form agent, gives existing ones back to agent (2026-10-08)

> - It serves as me when I am not online or available. (2026-10-08)

## Consequences
- Its output is a decision with its sources; memory supports the decision, it is not the product.
- Beta predictions are visible to the reviewer for comparison with his reply.
- Every real reviewer response feeds learning for later answers.
- Existing memories are preserved, and agents can store and retrieve memories.
- Live operation answers for the reviewer when he is unavailable.
- Live commentary observation helps tell the reviewer what is wrong.
- The agent-called tool is built before periodic observation.
- The unfinished line remains unresolved.

## Related
- [Availability and validator requirements](../../tasksync-chat/docs/requirements/availability-and-validator.md)
- [Validator agent spec](../../specs/007-validator-agent/spec.md)

## Answered
**Unfinished line (G10), 2026-10-08:** "I mean Validator agent should behave as below, in beta phase and when it is in prod." The lists above are the beta and prod behaviour.

**Live phase, 2026-10-08:** "It should act as me when i am away from keyboard." Its live design is discussed against spec 007 before tasks are written.

**Memory, 2026-10-08:** "We remove vscode memory tool from the agent' tool list, tahts how it will ask new memory tool instead of vscode one." Agents reach memory only through the AskAway memory tool.
