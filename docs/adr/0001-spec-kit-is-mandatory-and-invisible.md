# ADR 0001: Spec Kit is mandatory and invisible

- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G1, G2 in [GOALS.md](../../GOALS.md)

## Context

The reviewer dictates requirements and chats in VS Code. He wants Spec Kit to run behind the scenes without learning its internals or commands. Once the agent knows what he needs, implementation should continue without him. The Specs tab must reflect that same flow.

## Decision

Use Spec Kit for every feature flow, from plain dictation through specification, clarification, planning, tasks and implementation. Use standard user stories, acceptance criteria and tasks per story. Mark parallel tasks with `[P]` and actually run them in parallel. Put later tasks and recommendations into Spec Kit tasks, and show the same state in the Specs tab.

> My flow is generally like I dictate some requirement and chat with vscode and behind the scenes it should go through spec creation, clarify, plan, tasks and so on and once agent knows about what I need, then onwards feature should be implemented without me also. (2026-10-08)

> Speckit is mandatory and it has lot of steps. This extension should help user do without knowing about internals or commands of speckit. (2026-10-08)

> Use standard speck kit structure like user story and acceptance criteria. Tasks for each story and parallel tasks and, these parallel tasks can be run in parallel. (2026-10-08)

> I should get seamless speck usage through this extension. And specs tab should reflect the same. (2026-10-08)

## Consequences

- Plain words must reach the same flow as Spec Kit commands.
- The reviewer need not learn Spec Kit internals to get a feature implemented.
- Interruptions are limited to a batch of questions, approval gates or a genuine blocker.
- New tasks and recommendations become tracked Spec Kit tasks.
- Standard stories, acceptance criteria and `[P]` tasks replace custom artifact structures.
- The Specs tab shows the flow's actual state, not a separate version of it.

## Related

- [Spec Kit flow requirements](../../tasksync-chat/docs/requirements/speckit-flow.md)
- [Specs tab requirements](../../tasksync-chat/docs/requirements/specs-tab.md)
- [005 Spec Kit guided flow](../../specs/005-speckit-guided-flow/spec.md)
