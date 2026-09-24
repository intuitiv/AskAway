# Quickstart: Validate Custom Compaction Payload

## Prerequisites

- Work from the AskAway extension source: `cd tasksync-chat`.
- Use a VS Code workspace folder so a canonical active-workspace path exists.
- The focused external test is `test-custom-compaction-payload.cjs`.

## Validation Scenario

1. Submit a non-empty title and the displayed canonical active-workspace path.
2. Supply an ordered visible transcript containing `user` and `assistant` messages plus attempted `system`, `tool`, reasoning, and credential-like text.
3. Create a payload and inspect it through the local list/get workflow.
4. Confirm the returned record contains the title, active workspace path, only retained visible user/assistant text in chronological order, redaction, byte/message metadata, and a 30-day expiry.
5. Attempt retrieval from a second workspace; it must return `notFound` and reveal no metadata.
6. Delete the record early; subsequent retrieval must return `notFound`.
7. Seed a record past `expiresAt`; list/get must purge it and return no record.

The contract details are in [contracts/custom-compaction-payload.md](contracts/custom-compaction-payload.md); data validation and lifecycle are in [data-model.md](data-model.md).

## Commands

```sh
cd tasksync-chat && npx tsc -p ./ --noEmit
node --check media/webview.js
node test-custom-compaction-payload.cjs
```

Run `node --check media/webview.js` only when that file changes. The focused test must assert externally observable payload behavior: role filtering, secret exclusion, newest-100/64-KB whole-message bounds, workspace isolation, 30-day expiry, and early deletion. It must not assert private provider fields or native Copilot internals.

## Expected Outcome

TypeScript compiles, changed webview JavaScript parses, and the focused test reports every required scenario passing. Native Copilot compaction remains unaffected throughout this validation.
