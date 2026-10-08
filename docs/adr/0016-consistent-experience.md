# ADR 0016: Consistent experience
- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G16 in [GOALS.md](../../GOALS.md)

## Context
The reviewer wants the same kind of information to look and behave the same across tabs. Separate look-alikes would undermine that experience. Consistency across tabs outranks every other UI concern.

## Decision
Reuse one shared component for each kind of thing. Convert new data into that component's input format rather than building another look-alike. Preserve the same ordering, interactions, colours and labels everywhere.

> "If we reuse the same component and send data by converting into single format, we get consistent
> experience." (2026-09-24)

> - Same behaviour everywhere: ordering (newest at the bottom), expand/collapse, colours, labels, switches. (2026-09-24)

> - Tests assert the reuse: the new view's output contains the shared component's output. (2026-09-24)

## Consequences
- Existing components are reused before any new UI piece is built.
- New data is converted to the shared input format at its boundary.
- A second look-alike for the same kind of information is forbidden.
- Ordering stays newest at the bottom, with the same expand/collapse, colours, labels and switches.
- Tests assert that a new view contains the shared component's output.

## Related
- [Standing Consistent Experience decision](../../AGENTS.md#consistent-experience--top-priority-reviewer-2026-09-24)
