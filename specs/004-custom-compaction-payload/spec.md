# Feature Specification: Custom Compaction Payload

**Feature Branch**: No branch created by this invocation. The spec directory `004-custom-compaction-payload` is a feature identity and is independent of any Git branch identity.

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "Given conversation title and the workspace, create a simplistic input where we simply remove system prompt, and tool response and create a a simple payload it is more like custom compaction."

The first delivery is a local script that filters an exported JSONL conversation by title, removes
system content, and replaces each raw tool-response body with the literal `Pruned`. It reports input
and output bytes so a user can judge the compression ratio before using the output as a handoff.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a focused handoff payload (Priority: P1)

A user provides a conversation title and selects the current workspace to produce a compact, locally stored handoff payload containing only the conversation's user and assistant text.

**Why this priority**: It gives a user a bounded, portable summary input without exposing system instructions or raw tool activity.

**Independent Test**: A user can run the script against a JSONL fixture containing two titles, user,
assistant, system, and tool content, then inspect the selected-title handoff and its byte ratio.

**Acceptance Scenarios**:

1. **Given** a selected workspace, a non-empty title, and eligible user and assistant messages, **When** the user creates a payload, **Then** the result contains the title, the selected workspace identity, and the eligible messages in conversation order.
2. **Given** a conversation that also includes system prompts and tool responses, **When** the user
	creates a payload, **Then** system content is absent and every tool-response body is `Pruned`.
3. **Given** a user has created a payload, **When** they access it from the same workspace, **Then** they can retrieve the locally stored payload for handoff or custom-compaction use.

---

### User Story 2 - Keep workspace data isolated (Priority: P2)

A user can create payloads in more than one workspace without one workspace's payloads becoming visible or reusable in another.

**Why this priority**: Conversation context can include sensitive project information, so workspace boundaries must remain intact even in the minimal version.

**Independent Test**: Payloads created in two distinct workspaces can be listed or retrieved only from their originating workspace.

**Acceptance Scenarios**:

1. **Given** payloads exist for two workspaces, **When** a user views payloads while working in one workspace, **Then** only payloads associated with that workspace are available.
2. **Given** a payload was created for one workspace, **When** its workspace identity no longer matches the active workspace, **Then** the payload is not used as context for the active workspace.

### Edge Cases

- A missing or blank conversation title prevents payload creation and explains that a title is required.
- A conversation containing no eligible user or assistant text does not create a payload and explains that there is no shareable conversation content.
- Content that would exceed the payload size boundary is truncated at a message boundary, with the result marked as truncated.
- Payloads that reach the retention boundary are no longer available for retrieval or use.
- Credential-like values present in otherwise eligible text are omitted from the payload when they are identified as secrets.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a simple input that accepts a non-empty conversation title and a workspace selection.
- **FR-002**: The system MUST create a payload from conversation content associated with the selected workspace using only user-authored and assistant-authored visible text, preserving their original order.
- **FR-003**: The system MUST exclude system prompts, raw tool calls, tool responses, hidden reasoning, credentials, and other secret values from every payload.
- **FR-004**: The system MUST include the supplied conversation title and the selected workspace identity in each payload.
- **FR-005**: The system MUST store payloads locally and associate each payload with exactly one workspace.
- **FR-006**: The system MUST prevent a payload created in one workspace from being listed, retrieved, or used in another workspace.
- **FR-007**: The system MUST limit each payload to at most 100 eligible messages or 64 KB of text, whichever limit is reached first, and MUST identify payloads truncated by either limit.
- **FR-008**: The system MUST retain a locally stored payload for at most 30 days, after which it MUST no longer be retrievable or used.
- **FR-009**: The system MUST allow a user to remove a locally stored payload before its retention period ends.
- **FR-010**: The system MUST make clear that this payload is an optional handoff/custom-compaction input and does not replace, alter, or control native Copilot compaction.

### Key Entities *(include if feature involves data)*

- **Custom Compaction Payload**: A bounded local handoff record containing a title, workspace identity, ordered eligible conversation text, creation time, expiry time, and truncation status.
- **Workspace Identity**: The local identifier that scopes a payload to the workspace in which it was created.
- **Eligible Conversation Message**: Visible user or assistant text that may be included after excluded content and secret values are removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a payload from a title and a conversation with up to 100 eligible messages in 30 seconds or less.
- **SC-002**: In acceptance testing, 100% of generated payloads exclude supplied system prompts, raw tool content, hidden reasoning, and test credentials.
- **SC-003**: In acceptance testing across two workspaces, 100% of retrieval attempts expose only payloads from the active workspace.
- **SC-004**: In usability testing, at least 90% of participants can create and identify a bounded handoff payload on their first attempt without mistaking it for native Copilot compaction.
- **SC-005**: Each retained payload stays within 64 KB of text and becomes unavailable no later than 30 days after creation.

## Assumptions

- The first version operates on the current conversation available to the user and does not import, merge, or summarize external conversations.
- The title is user-provided metadata and is not transformed into an inferred summary.
- Local storage means the payload remains on the user's device and is not automatically shared with another user or workspace.
- The 100-message, 64 KB, and 30-day boundaries are conservative defaults for this intentionally simplistic scope and may be revised by a future feature.
- The feature is a supplemental user-controlled input for handoff or custom compaction; native Copilot conversation compaction remains outside its scope.