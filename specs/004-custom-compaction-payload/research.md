# Research: Custom Compaction Payload

## Decision 1: Own the feature at the AskAway provider/webview boundary

- **Decision**: Add an AskAway-local feature owned by `tasksync-chat/src/webview/webviewProvider.ts`. The webview (`tasksync-chat/media/webview.js`) supplies only the visible user/assistant text it renders; the provider validates, sanitizes, bounds, scopes, stores, retrieves, and deletes payloads.
- **Rationale**: `AskAwayWebviewProvider` already owns webview message contracts and its in-memory current-session tool-call history. `media/webview.js` owns the user-facing state and posts typed messages. `src/extension.ts` activates and registers the provider, so it needs no compaction integration.
- **Alternatives considered**: Reading Copilot debug logs is rejected because logs can contain system prompts, tools, reasoning metadata, and broader workspace material. Integrating `summarizeConversationHistory` is rejected because native Copilot compaction is closed-host behavior and outside AskAway control.

## Decision 2: Treat visibility and role as a positive allowlist

- **Decision**: The browser sends only records with `role: 'user' | 'assistant'` and a visible-text value. The provider independently accepts only those roles and serializes only text after secret redaction. It never accepts system, tool, reasoning, attachment, or arbitrary metadata fields.
- **Rationale**: A positive allowlist makes the privacy rule enforceable on both sides of the extension boundary. The provider remains authoritative if a compromised or stale webview sends extra fields.
- **Alternatives considered**: Filtering a general transcript by exclusion labels is rejected because new transcript categories could leak by default.

## Decision 3: Scope local storage by canonical workspace URI

- **Decision**: Require a title and canonical workspace path input. The provider derives the active workspace identity from VS Code's workspace folder URI, normalizes it as a file-system path, and rejects a submitted path that does not equal the active workspace path. Persist records under a workspace-specific key in `ExtensionContext.workspaceState` (or a workspace-state-backed store), never in global state.
- **Rationale**: The explicit path makes scope visible to the user while provider validation prevents the webview from selecting another workspace. VS Code workspace state provides local, workspace-bound persistence without a cross-workspace index.
- **Alternatives considered**: A user-provided path alone is rejected because it is untrusted. Global state with a workspace field is rejected because it creates a cross-workspace retrieval surface.

## Decision 4: Bound newest eligible text at message boundaries

- **Decision**: Scan eligible visible messages newest-to-oldest, retaining at most 100 messages and at most 65,536 UTF-8 bytes; then restore chronological order. A message that would exceed the byte limit is excluded whole. Mark `truncated` and record `truncationReason` as `message-limit`, `byte-limit`, or `both`.
- **Rationale**: The requirement says latest 100 messages / 64 KB and prohibits partial message capture. UTF-8 byte measurement reflects persisted payload size rather than JavaScript character count.
- **Alternatives considered**: Taking the first 100 messages is rejected because it omits the most recent context. Character-counting and slicing an individual message are rejected because they do not preserve the specified byte/message boundary.

## Decision 5: Redact before storage and apply expiry on every access

- **Decision**: Redact recognized secret-bearing spans before byte accounting and persistence, reject empty results, set `expiresAt = createdAt + 30 days`, and purge expired records on create/list/get. Delete is an explicit provider command and immediately removes the workspace-scoped record.
- **Rationale**: No unredacted eligible text may be stored. Access-time expiry prevents stale content from becoming visible if scheduled cleanup has not run.
- **Alternatives considered**: Client-only redaction is rejected because it can be bypassed. A timer-only expiry is rejected because it is not reliable across extension restarts.

## Decision Register

| ID | Decision | Status | Evidence |
| --- | --- | --- | --- |
| DR-001 | Use a local supplemental payload, not native Copilot compaction. | Resolved | FR-010; provider/webview boundary |
| DR-002 | Capture only visible `user` and `assistant` text with server-side allowlisting. | Resolved | FR-002, FR-003 |
| DR-003 | Require and verify canonical active-workspace path; persist workspace-scoped. | Resolved | FR-001, FR-005, FR-006 |
| DR-004 | Keep newest whole messages within 100 messages and 65,536 UTF-8 bytes. | Resolved | FR-007 |
| DR-005 | Redact before persistence; expire at 30 days and support early deletion. | Resolved | FR-003, FR-008, FR-009 |
