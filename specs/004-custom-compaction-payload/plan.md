# Implementation Plan: Custom Compaction Payload

**Feature**: `004-custom-compaction-payload`  
**Branch**: `main`  
**Date**: 2026-09-03  
**Status**: Ready for implementation

## Objective

Provide a local, workspace-scoped custom-compaction payload with a title and canonical workspace-path input. It captures only visible user/assistant text incrementally, redacts secrets, keeps the newest 100 messages and at most 64 KB (65,536 UTF-8 bytes), expires after 30 days, supports early deletion, and remains strictly supplemental to native Copilot compaction.

## Technical Context

| Area | Decision |
| --- | --- |
| Activation | `tasksync-chat/src/extension.ts` continues to activate/register `AskAwayWebviewProvider`; no native Copilot compaction hook is added. |
| Provider and persistence | `tasksync-chat/src/webview/webviewProvider.ts` validates webview commands, derives active workspace identity, owns payload construction/redaction/bounding, and persists only workspace-scoped local records. |
| UI capture | `tasksync-chat/media/webview.js` maintains a small visible-only transcript projection as user/assistant text is rendered and sends it with title/path on create. It never serializes tool-history state or system/reasoning content. |
| Manifest | `tasksync-chat/package.json` remains the extension manifest; add no external service or permission. |
| Tests | New `tasksync-chat/test-custom-compaction-payload.cjs` is an outside-in Node test of the payload contract, storage scope, expiry, and deletion. |
| Constraints | No cloud upload; no native Copilot compaction control; no system prompts, raw tools, hidden reasoning, credentials, or secrets in input/output/storage. |

## Constitution Check

| Gate | Result | Basis |
| --- | --- | --- |
| Local privacy boundary | Pass | Positive role allowlist, provider-side redaction, workspace-state storage, expiry, and deletion. |
| Root ownership | Pass | Provider owns trusted validation/persistence; UI owns only visible display projection. |
| Existing patterns | Pass | Uses existing webview/provider message boundary and extension activation path. |
| E2E behavior test | Pass | Focused caller-observable test is required in P3. |
| Native Copilot boundary | Pass | Feature neither reads native private transcript/logs nor controls native compaction. |
| Unresolved decisions | Pass | Decision Register in `research.md` contains only resolved entries. |

## Delivery Waterfall

### P0 - Define Trusted Payload Core

- **Entry**: Feature specification and this plan accepted; no implementation begins before provider-owned model and contract tests are named.
- **Ownership**: Provider/data-model owner: `tasksync-chat/src/webview/webviewProvider.ts`; test owner: `tasksync-chat/test-custom-compaction-payload.cjs`.
- **Work**: Introduce payload/domain types and a deterministic builder that accepts only visible `user`/`assistant` text, redacts secret-bearing values, rejects blank title/no retained text, retains newest complete messages within 100 and 65,536 UTF-8 bytes, and produces explicit truncation metadata.
- **Acceptance ID**: `P0-AC-01`.
- **Assert**: A mixed transcript produces only redacted user/assistant entries in chronological order; system/tool/reasoning content is absent; message and byte limits retain only whole newest messages.
- **Verify**: `cd tasksync-chat && node test-custom-compaction-payload.cjs`.
- **Expected**: The focused test reports passing privacy, ordering, secret-redaction, 100-message, and 64-KB assertions.
- **Evidence**: Named test cases and command output recorded by the implementer.
- **Security/privacy**: Positive allowlist and redaction execute in provider code before serialization or storage.
- **Rollback**: Remove the unused builder/types and its test; no persisted record migration exists.
- **Exit**: `P0-AC-01` passes and no input type admits excluded transcript classes.

### P1 - Add Workspace-Scoped Local Lifecycle

- **Entry**: P0 exit accepted.
- **Ownership**: Provider/storage owner: `tasksync-chat/src/webview/webviewProvider.ts`.
- **Work**: Derive the active canonical workspace path, reject mismatched submitted paths, persist records only in workspace state, set exact 30-day expiry, purge expired records on create/list/get, and provide same-workspace get/list/delete operations.
- **Acceptance ID**: `P1-AC-02`.
- **Assert**: A payload is available only in its source workspace before expiry; a foreign workspace returns `notFound`; expired content is purged; early delete removes it immediately.
- **Verify**: `cd tasksync-chat && node test-custom-compaction-payload.cjs`.
- **Expected**: The focused test reports passing workspace-isolation, retention-expiry, and early-deletion assertions.
- **Evidence**: Test output and inspected serialized record metadata showing `expiresAt = createdAt + 30d`.
- **Security/privacy**: No global index; foreign IDs disclose neither presence nor title; expiry is enforced on reads, not a best-effort timer.
- **Rollback**: Delete the workspace-state key and remove lifecycle handlers; local-only records are intentionally disposable.
- **Exit**: `P1-AC-02` passes with no cross-workspace read path.

### P2 - Wire Incremental Visible UI Capture

- **Entry**: P1 exit accepted.
- **Ownership**: UI owner: `tasksync-chat/media/webview.js`; provider-message owner: `tasksync-chat/src/webview/webviewProvider.ts`; activation review: `tasksync-chat/src/extension.ts`; manifest review: `tasksync-chat/package.json`.
- **Work**: Add title and canonical-workspace-path input plus create/list/get/delete UI commands. Incrementally append only text visibly rendered as user or assistant to the UI projection. Send contract-shaped commands; display local success/error/truncation/expiry state without presenting it as native Copilot compaction.
- **Acceptance ID**: `P2-AC-03`.
- **Assert**: The UI sends no tool-history, system, reasoning, attachment, or arbitrary object data; it labels the result as optional local handoff/custom-compaction input and leaves native Copilot behavior unchanged.
- **Verify**: `cd tasksync-chat && node --check media/webview.js` (when changed), then `cd tasksync-chat && npx tsc -p ./ --noEmit`.
- **Expected**: JavaScript syntax check and TypeScript compilation both succeed.
- **Evidence**: Command output plus code review of the typed webview command/response contract.
- **Security/privacy**: Browser projection is minimized, but provider validation remains mandatory; canonical path is derived and checked provider-side.
- **Rollback**: Remove UI controls and command handlers; P1 local records can be purged without affecting Copilot.
- **Exit**: `P2-AC-03` passes and the UI has no control path to native compaction.

### P3 - Prove End-to-End Contract and Build

- **Entry**: P2 exit accepted.
- **Ownership**: Test owner: `tasksync-chat/test-custom-compaction-payload.cjs`; release owner: extension maintainer.
- **Work**: Complete the focused external test through public payload commands or a public test harness. Cover title/path rejection, visible-role filtering, secret exclusion, newest whole-message bounds, same-workspace retrieval, foreign-workspace `notFound`, 30-day expiry, early delete, and the no-native-compaction boundary. Run compile and parsing validation.
- **Acceptance ID**: `P3-AC-04`.
- **Assert**: Every contract behavior listed above is observable without asserting private fields, call order, or Copilot internals.
- **Verify**: `cd tasksync-chat && npx tsc -p ./ --noEmit`; `node --check media/webview.js` if changed; `node test-custom-compaction-payload.cjs`.
- **Expected**: All commands exit 0 and the focused test reports all named scenarios passing.
- **Evidence**: Exact command output retained with the implementation record; no deployment required for plan acceptance.
- **Security/privacy**: Test fixtures include system/tool/reasoning/credential-like material and prove it cannot appear in payload output.
- **Rollback**: Revert the feature implementation and remove its workspace-state key; no external data or native Copilot setting is affected.
- **Exit**: `P3-AC-04` passes; all Constitution Check gates are still pass.

## Cloud Worker Packet

| Field | Value |
| --- | --- |
| Current branch | `main` |
| Feature | `004-custom-compaction-payload` |
| Target branch provenance | `004-custom-compaction-payload` |
| Exact base | `2eaeba0d3f45e8ee191f6b802cc30bbda1df3941` |
| Scope | `tasksync-chat/src/extension.ts`, `tasksync-chat/src/webview/webviewProvider.ts`, `tasksync-chat/media/webview.js`, `tasksync-chat/package.json`, and new `tasksync-chat/test-custom-compaction-payload.cjs` only. |
| Required commands | `cd tasksync-chat && npx tsc -p ./ --noEmit`; `node --check media/webview.js` if changed; `node test-custom-compaction-payload.cjs` |
| Prohibited work | Native Copilot compaction integration/control; debug-log transcript ingestion; network/cloud persistence; changes outside the listed source/test scope. |
| Completion evidence | P0-P3 acceptance IDs, command output, and test names/assertions. |

## Post-Design Constitution Check

All gates pass. The design uses a provider-trusted allowlist and workspace state, has explicit limits/expiry/delete behavior, includes a behavior-level test, and deliberately does not interact with native Copilot compaction. No clarification remains.
