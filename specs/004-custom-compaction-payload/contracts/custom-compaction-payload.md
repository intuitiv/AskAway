# Custom Compaction Payload Contract

## Boundary

This is an internal AskAway webview-to-provider contract. It is local to the active VS Code workspace and is not a Copilot compaction API. It must not invoke, configure, replace, or block native Copilot compaction.

## Webview to Provider

### `createCustomCompactionPayload`

```json
{
  "type": "createCustomCompactionPayload",
  "title": "Investigate cache misses",
  "workspacePath": "/Users/example/project",
  "visibleMessages": [
    { "role": "user", "text": "Find the cause." },
    { "role": "assistant", "text": "I will inspect the request path." }
  ]
}
```

Provider behavior:

- Canonicalizes and verifies `workspacePath` against the active workspace.
- Accepts only `role` values `user` and `assistant`.
- Redacts secrets, removes empty text, keeps newest whole eligible messages inside 100 messages and 65,536 UTF-8 bytes, and marks truncation.
- Persists locally under the active workspace only with a 30-day expiry.
- Rejects blank titles, absent workspace, workspace mismatch, and conversations with no retainable text.

### `listCustomCompactionPayloads`

```json
{ "type": "listCustomCompactionPayloads" }
```

Provider purges expired active-workspace records and returns only metadata for the active workspace.

### `getCustomCompactionPayload`

```json
{ "type": "getCustomCompactionPayload", "id": "payload-opaque-id" }
```

Provider returns the complete local record only when it belongs to the active workspace and has not expired. Otherwise return `notFound`; do not disclose foreign-record existence.

### `deleteCustomCompactionPayload`

```json
{ "type": "deleteCustomCompactionPayload", "id": "payload-opaque-id" }
```

Provider immediately deletes an active-workspace record. Missing, expired, and foreign IDs return `notFound`.

## Provider to Webview

### Success

```json
{
  "type": "customCompactionPayloadCreated",
  "payload": {
    "id": "payload-opaque-id",
    "title": "Investigate cache misses",
    "workspacePath": "/Users/example/project",
    "messages": [
      { "role": "user", "text": "Find the cause." },
      { "role": "assistant", "text": "I will inspect the request path." }
    ],
    "textBytes": 56,
    "truncated": false,
    "truncationReason": "none",
    "createdAt": "2026-09-03T12:00:00.000Z",
    "expiresAt": "2026-10-03T12:00:00.000Z"
  }
}
```

### Failure

```json
{
  "type": "customCompactionPayloadError",
  "code": "TITLE_REQUIRED | WORKSPACE_MISMATCH | NO_VISIBLE_CONTENT | NOT_FOUND",
  "message": "Human-readable local error."
}
```

## Privacy Contract

The provider must never persist or return system prompts, raw tool calls/results, hidden reasoning, attachments, credentials, or detected secret values. Unknown fields from the webview are ignored. The contract exposes only local payload data and never submits it to a service or Copilot native-compaction endpoint.
