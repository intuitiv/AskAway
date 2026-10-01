# Contract — Commentary tab validator entry (shared component)

Reuses `CommentaryStore` (`src/commentary/commentary.ts`) and the shared trace-row render block; no new tab or look-alike.

## Input (converted at the data boundary)
`CommentaryItem { id, ts, kind: 'validator', text, turnId }` plus a `detail` payload rendered as expandable trace rows:
`answer`, `sources[]`, `observations`, `summary`, `impact`, `match` (matched / mismatched with diff, FR-021), `contextSuggestions[]` (each dismissible), `usage`.

## Behaviour
- Newest at the bottom; expand/collapse, colours and labels identical to existing Commentary items.
- The 20-word cap applies only to `update` and `heads-up`; `validator` text is the one-line summary, details expand.
- Dismissing a context suggestion removes it from the proposal (US3.2); nothing is sent to the agent.
- A failed run renders as a visible validator error entry (FR-017).
- Cost goes to the shared banner through `recordSpecTurn` with source `validator`, not through the entry.

## Tests
Output of the render block contains the shared trace-row output; kind `validator` item appears after an `update` item in time order; dismiss removes only that suggestion.
