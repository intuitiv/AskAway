# Data Model — 007 Validator Agent

Names follow spec.md Key Entities. Persistence: knowledge in agentmemory (see research R-1); everything else under `.askaway/specs/<slug>/validator/` (jsonl, append-only, one line per record) beside the existing run records.

## ValidatorResponse
| Field | Type | Notes |
|---|---|---|
| id | string | uuid |
| observedId | string | id of the agent/worker response observed |
| source | `agent` \| `worker:<workerId>` | per-source cost attribution |
| specSlug | string \| null | null when no active spec (edge case) |
| answer | string \| null | null when no source supports it (FR-005) |
| observations, summary, impact | string | short |
| sources | string[] | ADR/memory/doc/knowledge-item ids actually used |
| contextSuggestions | ContextAddition[] | Story 3, dismissible |
| usage | {input, output, reasoning, cacheRead, cacheWrite, cost} | feeds shared banner (FR-013) |
| skipped | boolean | true when the cheap check skipped it (FR-019); no answer, no cost |
| error | string \| null | FR-017, visible, non-blocking |
| ts | number | |

## Prediction
`{ id, responseId, decision: string, ts }`. Kept until the reviewer's next reply is matched; then `matched: boolean | null` and `diff: string` are added (FR-007, FR-021). Match measure = matched / compared, per spec.

## KnowledgeItem (stored in agentmemory)
| Field | Notes |
|---|---|
| memoryId | agentmemory id, mirrored in `index.jsonl` |
| kind | `rule` \| `instruction` \| `goal` \| `fact` |
| text | concise canonical statement |
| example | optional, same memory, labelled line |
| specSlug / storyId / taskId | scope; at least specSlug. Tags `spec:`, `story:`, `task:` |
| changed | true when it superseded an earlier item (FR-011) |
| from | reviewer reply id |
No expiry field: kept until the reviewer changes it (FR-020). Dedup key: normalised text within spec scope (FR-010).

## ContextAddition
`{ id, ref (ADR path, memory id, spec resource), reason, dismissed: boolean }`. Dismissal persisted for the session; never changes the agent prompt in beta (FR-009).

## EvalCase
`{ id, suite: answer|enhance|store, input, expected, origin: authored|reviewer-correction }`. Stored in `tasksync-chat/evals/validator/`; results land in the existing `~/.askaway/evals/results.jsonl`.

## Relationships
ValidatorResponse 1—0..1 Prediction; Prediction 0..1—1 reviewer reply; reviewer reply 1—0..n KnowledgeItem; ValidatorResponse 1—0..n ContextAddition.

## State
Prediction: `open` → `compared` (matched/mismatched). KnowledgeItem: `active` → `superseded` (history kept by agentmemory, not loaded).
