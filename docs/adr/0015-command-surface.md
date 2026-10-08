# ADR 0015: Command surface
- Status: Proposed
- Date: 2026-10-08
- Goal: G15 in [GOALS.md](../../GOALS.md)

## Context
The reviewer names commands for starting, continuing, planning, tracking, checking and handing off work. He also wants a recurring PR command. These are shortcuts, not a requirement to know Spec Kit commands before using the flow.

## Decision
Keep /sk.start, /sk.continue, /sk.plan, /sk.tasks, /sk.check and /sk.handoff as the command surface. Plain text reaches the same stages. Include recurring /pr-daily; the reviewer wrote /pr_daily, while the repo's command is /pr-daily.

> Commands like /sk.continue, /sk.start, /sk.handoff, /sk.check, /sk.tasks, /sk.plan (2026-10-08)

> Recurring commands like /pr_daily (2026-10-08)

> Speckit is mandatory and it has lot of steps. This extension should help user do without knowing about internals or commands of speckit. (2026-10-08)

## Consequences
- All six named /sk.* shortcuts remain available.
- Plain-language requests can reach the same stages.
- Users need not learn Spec Kit internals to use the flow.
- The recurring command is /pr-daily, with the reviewer's /pr_daily wording preserved in the quote.

## Related
- [Spec Kit flow requirements](../../tasksync-chat/docs/requirements/speckit-flow.md)
- [Spec Kit guided flow rules](../../specs/005-speckit-guided-flow/Rules.md)
