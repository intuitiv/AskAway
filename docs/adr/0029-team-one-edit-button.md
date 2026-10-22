# ADR 0029: Team cards have one Edit button and Month under Turn

- Status: Accepted (reviewer, 2026-10-22)
- Date: 2026-10-21
- Goal: G18 in [GOALS.md](../../GOALS.md)
- Supersedes: R-TEAM-60 and R-TEAM-63 of ADR 0028. ADR 0028 otherwise stands.

## Context

In the Round 2 cards, expanding showed model and thinking, and Edit then opened a second form for name and the rest. Editing was split over a chevron, a menu and a button.

## Decision

> Cant we keep all edit under oen thing? And move monthly $ in someother place? That way we'll have edit button no chevron?? (2026-10-21)

- Each card has one Edit button; no chevron and no menu. It opens one inline panel with name, role, picture, model, thinking, profile, Agent file and Reset model to default (R-TEAM-66).
- Month cost is a small muted line under Turn on every card; agy shows $0.00 (R-TEAM-65).
- Availability is one global state, seeded once from the newest per-workspace file (R-TEAM-67).
- Member portraits become realistic faces the reviewer supplies (R-TEAM-68).

## Consequences

The expanded card no longer exists; the task tray stays behind the Trace/tasks button.
