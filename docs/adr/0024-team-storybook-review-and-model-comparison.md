# ADR 0024: Team Storybook keeps the existing format; simple names and profiles; one prompt before a model comparison

- Status: Proposed
- Date: 2026-10-16
- Goal: G18, G5, G13 in [GOALS.md](../../GOALS.md)
- Supersedes: ADR 0023 visible naming (role-prefixed names, CPO label), persona/skills editing and the end-of-turn member cost rollup. Other ADR 0023 rules stand.

## Context

The reviewer rejected parts of the first Team prototype: a standalone page with extra AITalk/Team buttons, summary pills, role-prefixed names, persona/skills editors and an end-of-turn cost rollup. He asked for one shared prompt and a three-model comparison before production.

## Decision

> Check current story book, i want to have in the same format. Same tabs and all. But i see some random buttons, AITalk, Team, whic i didnt like. (2026-10-16)

> Not sure why do we have pills on top. Remove them. (2026-10-16)

> Use names, Bhaskar, Cathy, Priya and so on. (2026-10-16)

> And names in the top also simple names, No aliases like Build, Reviewer and so on. (2026-10-16)

> Instead of CPO, use user name, (2026-10-16)

> No need of Persona or Skill, Just give me the link to agent file. When i click it, i can edit the prompt. (2026-10-16)

> Have a pill n tasks, wheh i click on it, task will expand. (2026-10-16)

> Why do i need end of turn member cost rollup? (2026-10-16)

> prepare one prompt and spawn 3 workers, one for each models, sol6.1, opus 5.5 and agy. (2026-10-16)

Team lives in the existing extension tab shell, replacing only Workers. Participants use simple names (Bhaskar, Cathy, Priya, Mahesh) and the user's own name; role is a separate field. A member row shows a larger portrait, status, profile, model and effort dropdowns, an agent-file link and a counted `n tasks` pill that expands existing-format task cards. No persona/skills editors, no top pills, no end-of-turn rollup. One reviewed prompt drives an isolated comparison of the candidate models before production.

## Consequences

- [Team requirements](../../tasksync-chat/docs/requirements/team.md) R-TEAM-20 to R-TEAM-25 carry these rows; they stay gaps until caller-view tests pass.
- [010 tasks](../../specs/010-team/tasks.md) T024 to T035 sequence prompt, prototype revision and comparison.
- Outcome 2026-10-16: Sol was dropped from the comparison and Argon High was chosen ("did pretty well"); production proceeds with Argon workers.
