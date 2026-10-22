# Contract: Cathy's assistant tools (US8)

Reviewer, 2026-10-22 (afternoon): "After this finsih spec 009. And i need to have all possible tools for Cathy to chat and read and act on behalf of me. As we have aitalk, Cathy can take persmission from me to send any mesage and all. Room ID is internal so dont show it to me. Space name is what is i see. Instead of agent figuring out things by multiple webex calls, we need tools to optimise that. I will add outlook tool also in future so that Cathy can be my PR or something."

Status: built (spec 009 T044 to T046; the tool set, the approval card and the id sweep are tested). Rows: [R-CATHY-01..08](../../../tasksync-chat/docs/requirements/webex-assistant.md). Decision: [ADR 0035](../../../docs/adr/0035-cathy-assistant-tools-and-provider-seam.md). This contract is design only; no tool behaviour changes until the build slices S1 to S4 in `tasks.md`.

## 1. Where the code is today (so slices change the right rule)

| Fact | Where | Consequence |
|---|---|---|
| Nine worker MCP tools (`webex_find_space`, `webex_read`, `webex_thread`, `webex_send`, `webex_reply`, `webex_attachments`, `webex_wait_reply`, `webex_style_card`, `webex_edit_draft`) take `roomId`, `personEmail`, `messageId`, `parentId` and return them | `src/services/webexSuite.ts` | Cathy chains 3 to 5 calls per task and sees ids. Replaced by the macro tools below. |
| Draft `recipientLabel` falls back to the raw room id or email when the room title lookup fails | `webexSuite.ts` send, `src/services/webexDrafts.ts` `WebexDraft` | A card can show an id. The label must be a name or the draft is refused. |
| A send with no AITalk hook asks `deps.approve` (modal, only while Here, else `unavailable`) | `webexSuite.ts` send, `webexToolsHost.ts` `approveWebexSend` | Keep the modal only as the explicit AITalk-unavailable fallback (R-TELE-43), tested; no other path sends. |
| Cards live in the AITalk room of the calling worker's workspace; 👍 sends once, 👎 discards, edit re-queues, pending cards survive reload | `src/aitalk/webexDraftCards.ts`, `webexDrafts.ts` (R-AITALK-19..22) | Keep this behaviour; generalise it to `ApprovalRequest` (section 5). |
| The single LM tool `askaway_webex` (`webexTool` in `src/workers/workerTools.ts`, logic in `src/services/webexTools.ts`) returns ids; `createWebexToolsHost` is not called by the extension, only by `test-webex-tools.cjs` | `workerTools.ts`, `webexTools.ts`, `webexToolsHost.ts` | No code outside Cathy needs it (FR-040: no main-agent LM registration). Remove it; do not keep an id-bearing surface. |
| `.askaway/webex-status.json` and the Output channel carry `workspaceRoomId` | `src/services/webexStatus.ts` | Replace with the space name. |
| The missing-room hint says "Set the room/space ID in Settings → askaway.webex.roomId" | `src/services/webexService.ts` ~line 1105, `package.json` setting `askaway.webex.roomId` | Say "Choose the workspace space"; the setting stays an internal override and is not described as an id the reviewer types. |
| Cathy's prompt says "webex_read for roomId or personEmail" | `worker-profiles/webex.md` | Rewrite for names and the macro tools. |
| Token scopes: `spark:all`, `meeting:schedules_read`, `meeting:participants_read`, transcripts and recordings read. No meeting write. | OAuth integration | Meetings tools are read-only. No `create_event` for Webex. |
| Webex REST has no public reactions API and no mark-as-read API. Editing and deleting one's own messages, and file upload, exist. | Webex API | No reaction tool. "Unread" is computed (section 3). Edit and delete only work on messages the reviewer's token posted. |

## 2. Names, not ids

1. Every tool input takes a human name: a space name, a person name or an email. Every result returns names, times and text.
2. Where a follow-up call needs to point at something (a message to reply to, a thread, a wait start point), the result carries a short opaque `ref` (`s3` space, `m12` message, `p4` person). Refs are small counters issued by the host, valid for the workspace session. A raw Webex id never leaves the service.
3. A stale ref (after reload) returns `{status: 'stale_ref', hint: 'Call webex_inbox or webex_find again.'}`. Never a guess.
4. An ambiguous name returns `{status: 'ambiguous', candidates: [{ref, label, kind, detail}]}` with at most 10 candidates (`detail` is a name-only hint such as the last message time or the team name). The caller picks a `ref` and repeats; the host never picks for it.
5. Ids may live only inside internal state (the ref table, the seen-watermark file under AskAway's own storage). They never appear in: tool results the model relays, AITalk cards and replies, Team or Settings text, `webex-status.json`, the Output channel lines shown to the reviewer, or error text. `assertHumanLabel` (`src/services/assistant/provider.ts`) is the guard for card labels; the id-leak sweep (S3) adds a caller-view test that seeds a Webex-shaped id into every fake response and asserts it appears nowhere in results, cards, status file or log lines.
6. A name that cannot be found returns `{status: 'not_found', query}`; the tool creates nothing (no room, no person lookup side effects).

Internal interface the slices share (webexResolver.ts implements it, webexActions.ts and the tools consume it; tests fake it). Reconciled in S3 with what shipped:

```ts
class WebexResolver {
  space(nameOrRef: string): Promise<Resolved>;                    // by name, or a ref
  person(nameOrEmail: string): Promise<Resolved>;
  message(ref: string): Promise<
    | { status: 'ok'; space: Resolved; thread?: Resolved; mine: boolean; created?: string;
        messageId: string; rootId: string;                          // the message's own internal id and its thread root's (the message itself when it starts one)
        author?: string; snippet?: string }                          // who wrote it and a short scrubbed quote, so a card can name the message in words
    | { status: 'stale_ref'; ref: string; hint: string }>;
  latestFrom(person: string, space: string): Promise<Resolved>;    // 'latest from <person> in <space>' (a message ref)
}
// Resolved = {status:'ok', ref, label, kind, _internal: {id, ...}} | {status:'ambiguous', query, candidates} | {status:'not_found', query} | {status:'stale_ref', ref, hint}
```

`messageId` and `rootId` are what edit, delete and reply need: edit and delete act on `messageId`, a reply goes under `rootId`. webexActions.ts also accepts a `message: Resolved` and a `thread` Resolved from a fake. Nothing in `_internal`, `messageId` or `rootId` is ever shown.

`_internal` never serialises into tool output; the output mapper picks `ref` and `label` only.

## 3. The tools (at most 12)

All tools are strict zod objects, bounded (default 20 items, max 50, `hasMore`, `truncated` flags), secret-redacted (as `webexSuite.ts` `clean`), and return `{status}` plus fields below. They replace the nine old tools; none of the old names stays except `webex_read`, `webex_send`, `webex_reply`, `webex_edit_draft` and `webex_style_card`, whose shapes change as described.

| Tool | Input | Output | Notes |
|---|---|---|---|
| `webex_inbox` | `unreadOnly?`, `mentionsOnly?`, `since?`, `limit?` | Spaces by name: `space`, `ref`, `lastMessage {author, time, text}`, `mentionsMe`, `waitingOnMe`, `unseen` | Webex has no unread API. `unseen` = messages newer than AskAway's per-space seen watermark (stored internally, advanced when `webex_read` returns them); `waitingOnMe` = last message is not from the reviewer. Both are labelled "AskAway's view, not Webex's". |
| `webex_find` | `query`, `kind?` (`space`, `person`, default both) | `spaces[]` and `people[]`, each `{label, ref, detail}`; a person also has `{email, title?, presence?}` | Replaces `webex_find_space` and the separate person-profile tool (merged to keep the set at 12). Presence only if the token returns it; otherwise omitted, never invented. Names and emails only. |
| `webex_read` | `space` or `person`, `thread?` (a `ref`), `since?`, `limit?`, `includeFiles?` | `messages[] {ref, author, time, text, threadOf?, files[] {name, text?}}` | One call: resolves the name internally, reads the thread, downloads and extracts attachment text (existing cache and `extract` rules). Creates nothing. Advances the seen watermark. |
| `webex_search` | `query`, `space?`, `person?`, `since?` | `matches[] {space, author, time, text, ref}` | Bounded: scans recent messages per space and says so (`scope`). |
| `webex_wait` | `space` or `person`, `thread?`, `sinceRef?`, `timeoutSeconds` (max 120) | `messages[]` newer than `sinceRef`, or `{status: 'timeout'}` | Replaces `webex_wait_reply`. Polls with backoff inside the host; one tool call, not a loop in the model. |
| `webex_meetings` | `from?`, `to?`, `person?` | `meetings[] {title, start, end, host, participants[]}` | Read only (`meeting:schedules_read`, `meeting:participants_read`). No create or edit. |
| `webex_send` | `to` (space or person name, or ref), `text`, `thread?`, `files?` | `{status: 'pending', draftId, target, text}` | Queues an approval card. Never `sent` from this call. |
| `webex_reply` | `to`: a message `ref`, or `latest from <person> in <space>`, `text` | as `webex_send` | Resolves space and thread inside the host. |
| `webex_edit_message` | `ref`, `text` | `pending` | Own messages only; refuses others' messages before queuing. |
| `webex_delete_message` | `ref` | `pending` | Own messages only. |
| `webex_edit_draft` | `draftId`, `text` | `pending` with a new `draftId` | An edit voids the old approval (existing behaviour). |
| `webex_style_card` | none | style card text | Unchanged. |

`draftId` is an internal AskAway draft id (a UUID the model must pass back), not a Webex id; it is shown nowhere to the reviewer. The set is exactly 12 tools: inbox, find, read, search, wait, meetings, send, reply, edit_message, delete_message, edit_draft, style_card. The reviewer's list had a separate `webex_person`; it is folded into `webex_find` so the cap of 12 holds. A new tool needs another to merge or retire.

Out of scope: reactions (no API), mark-as-read (no API), creating rooms or meetings, bot provisioning, any inbound webhook.

## 4. Approval (R-CATHY-05, R-CATHY-06)

1. Every outbound action (send, reply, edit, delete, upload) calls `requestApproval(ApprovalRequest)` from `src/services/assistant/provider.ts`. The AITalk draft-card code implements the one generic handler: a card from the calling worker showing provider, action, target NAME, thread context, the full never-collapsed text and any file names.
2. 👍 from the reviewer executes the action exactly once; 👎 discards; an edit voids the old approval and the card asks again; the outcome is the reply to the worker's card; pending cards survive a reload. This is today's R-AITALK-19..22 behaviour, generalised from Webex-only drafts to `ApprovalRequest`.
3. No code path sends without the approved card. The `!hasWebexDraftHook() && deps.approve(...)` branch in `webexSuite.ts` is removed. `requestApproval` fails closed (`unavailable`) when no handler is registered.
4. Only when AITalk is unavailable may the host offer the R-TELE-43 modal, and only through an explicit `modalFallback` dependency supplied by the host. A test asserts that without the dependency, an AITalk-less send stays `unavailable` and posts nothing.
5. The card label comes from the resolver's `label`. A draft whose target label looks like an id is refused (`assertHumanLabel`), not shown.
6. Reads (inbox, find, read, search, wait, person, meetings) need no approval. Cathy may ask the reviewer a question with the `aitalk` tool, tagging `@main`, `@validator` or in general, before acting (members post questions only, R-AITALK-45).
7. Live checks never spam: a live reply goes only to the reviewer-named message with the text the reviewer named ("Thank you!"), after an explicit opt-in.

## 5. Provider seam (R-CATHY-07)

`src/services/assistant/provider.ts` (delivered with this design) exports `AssistantProvider {id, label, tools(), resolve?()}`, `ApprovalRequest {provider, action, targetLabel, body, details?, files?}` (no id field), `requestApproval`, `setApprovalHandler`, `assertHumanLabel`, `assertApprovalRequest`, `isOpaqueRef`, `registerAssistantProvider` and `assistantTools()`. Webex registers as provider `webex`; a later Outlook provider registers as `outlook` with tools such as `outlook_inbox`, `outlook_read`, `outlook_send` and `create_event` approvals, and reuses the same card. The guard is `test-assistant-provider-seam.cjs` (EV-ASSISTANT-SEAM).

## 6. Evidence per slice

| Slice | Caller-view test |
|---|---|
| S1 | `test-webex-name-resolver.cjs` (names to refs, ambiguity, stale ref, not found, nothing created), `test-webex-macro-tools.cjs` (inbox, read with attachments, search, wait, person, meetings with a fake Webex API, call counts) |
| S2 | `test-webex-approval-card.cjs` (generic card shows name, thread, full text, files; 👍 once; 👎; edit; reload; no send without card; modal only as explicit fallback), existing `test-aitalk-webex-draft.cjs` and `test-webex-draft-workspace.cjs` stay green |
| S3 | `test-webex-assistant-tools.cjs` (the registered set is at most 12, old names gone, strict schemas), `test-webex-no-ids.cjs` (seeded id appears nowhere), `test-webex-prompt-graders.cjs` updated for the new profile |
| S4 | `ASKAWAY_WEBEX_LIVE=1` smoke, sanitized evidence in `specs/009-webex-remote-channel/evidence/` |
