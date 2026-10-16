# ADR 0023: Verify agy first; Team rows represent members, runs represent tasks

- Status: Proposed
- Date: 2026-10-15
- Goal: G18 in [GOALS.md](../../GOALS.md)
- Supersedes: ADR 0021 worker join-on-post rule only; supersedes backlog AG-1 dropped decision and earlier agy-as-member interpretation. Other actor/routing rules stand.

## Context

The reviewer corrected the runtime/persona distinction and prioritised using Argon for this work. Model discovery alone does not resolve the prior headless write/command denial. Team is not shipped; production changes require a new implementation packet after runtime proof and Storybook approval.

## Decision

> I think we should enable agy as an alternate to opencode first, before this change. (2026-10-15)

> Mahesh is AA.Orchestrator. AskAway Build has more than standups, it is more technical. (2026-10-15)

> As we have so many members, show only the ones whcih are active in a turn. (2026-10-15)

> 5. Its not Team row, btw, its a member row. (2026-10-15)

> Name should change based on the agent i selected. Mahesh can be Orchestrator. What is the name of the build. (2026-10-15)

> CPO should be my photo, it should be in my user specific folder. not in askaway extension. (2026-10-15)

> Build Bhaskar, I should be able to select @Bhaskar also, same goes to other members. (2026-10-15)

Use agy as an alternate runtime and Argon as a model available to any profile, never a persona. Rename only visible Workers/Team and runs/tasks; retain stable internal contracts. Members join at assignment rather than first post; questions use existing mention/side-channel routing. Validator remains a pinned PO profile, subject to active-turn visibility; Mahesh maps to AA.Orchestrator, not AskAway Build. Grouping is delegated. Generate realistic faces first, fallback prompts/upload, shared in both views. Storybook review gates production Team UI.

## Consequences

- Clarification 2026-10-15: selected native agent determines the name/avatar/join banner/Team profile consistently, not a static Manager alias. AA.Orchestrator → Mahesh; AskAway Build is a distinct technical lead, with Build Bhaskar as the approved configurable name. Unknown agents retain their actual display name without guessing.
- Every member has a selectable short-name alias, including @Bhaskar and @Mahesh. Autocomplete displays member identity and binds selection to stable member ID, not literal display-name matching; labels may change without changing routing identity. Retain current-turn active suggestions and existing reply/mention priority. Duplicate short names require role/stable-identity disambiguation, never arbitrary routing. R-TEAM-15 and T006/T010 track planned caller-view checks; no implementation is claimed.
- CPO uses the real user-uploaded photo, not generated member art, in a user-owned folder outside extension install/media, repo and distributed bundles. Suggested reference `~/.askaway/profile/avatar.png` is user-scoped, shared across workspaces and survives extension upgrades. This plan creates no directory/photo and claims no implementation; caller-view continuity and packaging-exclusion checks remain gaps under 010 T006/T008/T013. agy-first and Storybook approval still gate delivery.

- [Team requirements](../../tasksync-chat/docs/requirements/team.md) remain gaps until caller-view tests pass.
- [010 tasks](../../specs/010-team/tasks.md) sequence runtime proof, prototype/review, production, cost summary and regressions; future member creation stays backlog.
- Preserve ADR 0021 history and actor boundary; no duplicated conversation/approval UI. Do not infer free billing from a model name or availability.
