# ADR 0028: Team uses compact vibrant cards with a Show all toggle

- Status: Proposed
- Date: 2026-10-21
- Goal: G18 in [GOALS.md](../../GOALS.md)
- Supersedes: R-TEAM-50 in part (one header toggle is allowed) and the status line in R-TEAM-48. ADR 0027 otherwise stands.

## Context

The 420px Team cards were tall, and the reviewer wanted to see more at a glance and to edit members that spent nothing this turn.

## Decision

> I want the UI to be pleasing and like to see more and make sense of something. It should be vibrant. (2026-10-21)

- Cards are compact and expandable: role, model and thinking chips, Turn, Trace button and a rotating hard-coded status always show; Month shows when expanded (R-TEAM-58 to R-TEAM-60).
- Members order by Turn spend; one 'Show all members' toggle reveals passive ones for editing (R-TEAM-61, R-TEAM-62).
- Secondary controls sit in a menu and the summary carries integration health chips (R-TEAM-63, R-TEAM-64).
- Storybook comes first; the production Team tab switches over after the reviewer approves the look.

## Consequences

The status line is no longer editable; stored status overrides are ignored.
