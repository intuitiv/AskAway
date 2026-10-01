# Contract — Validator observer (input and output)

## Entry points
- `observe(response: {id, source, text, specSlug?})` — called for every agent/worker response (FR-001).
- `closeLoop(prev: {id, text}, reply: {id, text})` — called first when the reviewer replies (FR-006); also valid for a response never observed.
- `proposeContext(prompt: {text, specSlug?})` — Story 3.

## Flow for observe
1. Cheap check (no model): pure progress update -> return `{skipped: true}` and record the skip (FR-019).
2. Redact secrets (FR-016).
3. Recall from `KnowledgeStore` + Goal.md, Rules.md, ADRs, memories, spec resources.
4. Run the validator worker (read-only profile; no tool that writes to agents).
5. Return `ValidatorResponse` (data-model.md), store `Prediction`, post to Commentary, record cost.

## Guarantees
- Never blocks: runs asynchronously with a timeout; on error returns `ValidatorResponse.error` (FR-017).
- Never delivers output to an agent or worker in beta (FR-018). Advisory only; no gate approval or destructive action.
- `answer = null` with a statement when no source supports it (FR-005).
- closeLoop with "ok"-like reply stores nothing (US2.5); unrelated reply stores nothing against a spec.
- The interface does not change when the validator later moves to the backend (FR-014).

## Tests (from the caller's view)
Sample spec with a rule: covered question -> cited answer in Commentary; uncovered -> "no source"; agent send surface untouched; banner cost rises; failure injected -> flow unblocked and error shown.
