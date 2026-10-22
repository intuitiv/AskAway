# Feature Specification: Webex Remote Channel

**Feature Branch**: `009-webex-remote-channel`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "Same thing should just work for webex also." Webex replaces Telegram as the reviewer's active remote channel without losing remote monitoring, documents or replies. Binding sources: [ADR 0018](../../docs/adr/0018-webex-replaces-telegram.md), [Telegram requirements](../../tasksync-chat/docs/requirements/telegram.md), and [GOALS.md](../../GOALS.md) G7, G8 and G16.

## Clarifications

### Session 2026-10-08 — Webex answers

Reviewer verbatim, from GOALS.md section "2026-10-08, Webex answers":

> Keep telegram code, it is just toggled off.
> Token storage is through command.
>
> I am aware of webhooks, but we cannot expose my laptop to public api. So, our option is long poll, like we do for telegram
> There is a concept called team and we can create spaces for those teams. I created a team called `self`. So we follow the same thing as telegram, we create a space per workspace and post message there. And we have a General space also, so we use it same as that of General of telegram.
>
> Once i give token, you can explore alll these spaces in a worker and get all the team ids, and all kinds of things.
>
> And another thing is, we need to change share-with-me script also. This is what caught IT attention. We send docs to self.General space instead of telegram.
>
> 006 T021: For cloud, may be you can share PR link once that task is done so that i'll review and manually do stuff from it
>
> ~/.webex.md file has client id and secret. and other stuff.

Webex has no long-poll endpoint: use outbound reply polling with backoff, not a webhook or public laptop URL. ADR 0018 selects SecretStorage with a macOS Keychain mirror. A personal token does not notify its owner about their own posts; optional bot identity remains an open question in US5. The cloud PR handoff belongs to spec 006; this spec carries it through the shared remote channel without pulling or merging work.

### Session 2026-10-09 — turn thread and command-style tools

Reviewer verbatim (GOALS.md section 4, Webex turn thread):

> I asked for sending attachment and message in same message, for final response. not as a thread.
> I see few messages are sent by my token rather than webhook route. Always send me message through webhooks. If we need to send message to someone else, we need to use my token. In that space, it is always through webhook. I think i see your concern. DOes that webhook api only accpets message not cards or attachments? If thats the case, dont push it. Accept it and proceed.
> Lets do one thing, we'll use webhook for notification, i mean alerting and all. You cannot edit same message and all.
> You can send a message in teh beginnign as an alert that new user message sent and all, to that thread, we can have an updateable card every 2 min or for commentary. At the end we send response handoff and also attach doc to it (this tou can do i guess).
> And as the last message is sent by me, i dont get notification, then bot can alert it and i can reply to the same thread, so that you can poll wit that id or something? See if you can comeup with something better.
>
> In webex spec, can you add some tasks to create command style tools to read messages from webex and so on?

Live facts: incoming webhook = text/markdown only, no cards, ignores `parentId`, returns no message id, notifies. Token posts never notify the reviewer, but can be edited and carry markdown + files in ONE message. US6 supersedes the earlier US5 split delivery and open bot/card proposal: webhook alerts only, token status/final messages in the turn thread. Resolve webhook root ids through outbound polling with a non-secret turn correlation marker, never an assumed POST response id. General now means created **AskAway General** in team `self`, not built-in General (R-TELE-33). [Rules.md](Rules.md) retains the dated reviewer decisions and verbatim sources.

## User Scenarios & Testing *(mandatory)*

### Session 2026-10-08 — confirmed browser OAuth

Reviewer verbatim (GOALS.md, Webex OAuth confirmation):

> http://localhost:5000/callback is redirect url
> COmmand should refresh main token, by opening url in browser and all. I'll do auth in the browser and give back redirected url, from that you can do the rest

[Proposed ADR 0020](../../docs/adr/0020-webex-browser-oauth-manual-callback.md) amends authentication only; ADR 0018 remains Accepted. Callback POC and reviewer confirmation are done, not implementation/testing. The full return URL belongs only in a local masked VS Code prompt, NEVER chat. No listener runs: the browser may show connection refused at localhost; copy its full address-bar URL into that prompt.

### User Story 1 - Set a token and discover destinations safely (Priority: P1)

The reviewer runs "AskAway: Set Webex Token", ~~enters the token in a masked command prompt~~ completes fresh browser OAuth and pastes the full redirected URL into a local masked VS Code prompt (superseded by the 2026-10-08 confirmation above). The command privately reads integration credentials from `~/.webex.md`, uses exactly `http://localhost:5000/callback`, validates the returned URL and state, exchanges the code, and securely stores access and refresh tokens. No local listener runs. SecretStorage holds both tokens; the macOS Keychain access-token mirror lets share-with-me use it. Discovery writes only non-secret team/space metadata to `.askaway/webex-spaces.json`.

**Why this priority**: Safe authentication and known destinations are the smallest usable foundation for sending anything to Webex.

**Independent Test**: Extend existing `tasksync-chat/test-webex-token-command.cjs` from the caller's view for fresh browser opening, exact redirect, no listener, masked URL return, state/URL rejection, code exchange, storage, cancellation and no secret leakage; run it and `tasksync-chat/test-webex-discover.cjs` with fake storage/API boundaries. Builder and independent gates must pass before closing OAuth tasks.

**Acceptance Scenarios**:

1. **Given** absent or existing stored tokens, **When** the command runs, **Then** fresh browser authorization opens with exactly `http://localhost:5000/callback`, without starting a listener; valid state and the pasted return URL permit code exchange and access/refresh-token SecretStorage storage plus the access-token Keychain mirror, never settings, chat, logs or discovery metadata.
2. **Given** the command prompt, **When** the reviewer cancels, **Then** stored credentials remain unchanged and no discovery request uses an empty token.
3. **Given** a stored token and paginated teams/spaces, **When** discovery runs, **Then** `.askaway/webex-spaces.json` contains their identifiers and names, including team `self` and its General space, but no secrets.
4. **Given** a storage or discovery failure, **When** the command completes, **Then** it reports a sanitized failure without claiming successful storage or exposing credentials.
5. **Given** a wrong redirect, missing code, mismatched state or OAuth error in the pasted URL, **When** it is submitted, **Then** the command rejects it without exchange, credential replacement or secret-bearing diagnostics.
6. **Given** stored tokens after authorization, **When** later requests need authentication, **Then** they reuse and refresh through the existing credential boundary; invoking the command still starts fresh browser authorization.

---

### User Story 2 - Keep one remote experience across channels (Priority: P1)

One `RemoteChannel` interface serves live Commentary, turn lifecycle, handoff and PDF, shared-banner status, cloud digest and ask_user replies. Telegram and Webex implement it; callers do not duplicate channel-specific behavior. Telegram code and regression tests stay, but its enabled toggle is off and it makes no network calls while disabled.

**Why this priority**: Channel parity and consistency are the reason for the migration; separate caller paths would immediately drift.

**Independent Test**: Replay the same turn, queued message, heads-up, metrics, handoff, digest and reply through both adapters in `tasksync-chat/test-remote-channel-parity.cjs`; compare caller-visible content, ordering and lifecycle, then prove disabled Telegram receives no calls.

**Acceptance Scenarios**:

1. **Given** either adapter, **When** a new user or queued message starts a turn, **Then** a new live message opens, the previous turn stops reply polling, and Commentary edits the current message with distinct heads-up styling.
2. **Given** an active turn, **When** two minutes elapse or it ends, **Then** status refreshes with stuck/error indicators and shared metrics, and a new final message replaces the live message; personal-token notification limits are disclosed.
3. **Given** a final response, **When** handoff is sent, **Then** text contains banner then current handoff, the full response is attached as a mobile-friendly PDF, and conversion failure attaches Markdown instead.
4. **Given** a remote reply or VS Code reply, **When** it arrives, **Then** the remote reply reaches the correct conversation once, or the VS Code reply stops that turn's remote polling respectively.
5. **Given** two workspaces and Telegram disabled, **When** monitoring and a cloud digest run, **Then** each workspace sees only its own Commentary and live status, the digest includes PR/evidence/duration/model/blocker/decision without invented cloud price, and no Telegram request occurs.
6. **Given** an ask_user side-channel question, **When** the reviewer answers remotely, **Then** the same shared reply path resolves it without reinstating a separate legacy conversation flow.

---

### User Story 3 - Deliver and receive reliably in workspace spaces (Priority: P1)

Webex posts to one space per workspace in team `self`, creating the space if absent, and uses that team's General space for general delivery. Replies use outbound polling. Because AskAway and the reviewer may use the same personal identity, AskAway tracks its posted message IDs rather than rejecting every message from that identity. The adapter uploads documents and respects rate limits.

**Why this priority**: Reliable delivery and genuine replies must work before Webex can replace the current channel.

**Independent Test**: In `tasksync-chat/test-webex-remote-adapter.cjs`, use a fake Webex API with existing/missing spaces, same-person messages, duplicate polls, PDF upload and 429 responses; observe routing, reply delivery, retries and zero inbound endpoint creation.

**Acceptance Scenarios**:

1. **Given** team `self` and an existing workspace space, **When** delivery starts, **Then** that space is reused; a missing workspace space is created once and its non-secret mapping survives reload.
2. **Given** a workspace turn and General space, **When** workspace and general messages are sent, **Then** each reaches its own intended space, never another workspace.
3. **Given** AskAway and the reviewer share a person ID, **When** polling sees AskAway's recorded post ID and a new reviewer message ID, **Then** it ignores only the recorded own post and delivers the reviewer reply once, including after re-poll or reload.
4. **Given** a 429 with Retry-After, **When** delivery or polling retries, **Then** no retry happens before the instructed delay and the pending operation is retained.
5. **Given** oversized or rejected formatted content, or a failed live edit, **When** delivery retries, **Then** content is safely bounded before conversion, plain text is used for formatting rejection, and failed edits are retried without silently losing the update.
6. **Given** a handoff document, **When** Webex delivery runs, **Then** the PDF is uploaded as a file, or Markdown is uploaded if conversion failed; no webhook or public laptop endpoint is opened.

---

### User Story 4 - Receive shared documents in self.General (Priority: P1)

The reviewer uses `~/.local/bin/share-with-me` as before, but documents go to Webex self.General rather than Telegram. The script was already switched on 2026-10-08 with `SHARE_CHANNEL=webex` as its default; this story verifies it live rather than repeating the switch.

**Why this priority**: The script caused the IT concern and must be checked alongside extension delivery.

**Independent Test**: Run `tasksync-chat/test-share-with-me-webex.cjs` in an explicitly enabled live mode with a harmless document; record its arrival in self.General and confirm no Telegram request, without printing tokens.

**Acceptance Scenarios**:

1. **Given** the switched script and Keychain credentials, **When** the reviewer shares a harmless document with the default channel, **Then** the document arrives in self.General and no Telegram call occurs.
2. **Given** unavailable Webex credentials or a failed upload, **When** sharing runs, **Then** it reports a sanitized failure instead of falling back silently to Telegram or claiming delivery.

---

### User Story 5 - Notify through per-space incoming webhooks (Priority: P1)

The reviewer confirmed (2026-10-08): "this integration is logged in with my credentials. So, if message is posted, i'll not get any notifications." and "And bots are not enabled in our org." Configure per-space Incoming Webhooks URLs manually through AppHub; no API for creating incoming endpoints was found. The command copies the selected space title, opens AppHub and accepts a validated URL in a masked local prompt. SecretStorage holds each room's URL; General is mirrored to Keychain. Startup and space resolution offer Configure / Later / Don't ask in this workspace when enabled, signed in and missing a webhook.

**Why this priority**: OAuth self-posts do not notify, and bots are disabled in his org.

**Independent Test**: `tasksync-chat/test-webex-incoming-webhook.cjs` verifies secure setup, webhook text, token files/fallback and threaded replies with fake local servers. Live phone notification remains separate evidence.

**Acceptance Scenarios**:

1. **Given** a stored room webhook, **When** final or heads-up text is sent, **Then** incoming webhook JSON carries markdown/text only; PDF/Markdown files still use OAuth.
2. **Given** no room webhook, **When** enabled and signed in, **Then** a named reminder offers secure manual configuration and text falls back to OAuth.
3. **Given** webhook posts and a threaded reviewer answer, **When** polling runs, **Then** sender posts are ignored and the answer resolves the latest open handoff once.

---

### User Story 6 - Turn thread with webhook alerts (Priority: P1)

Each turn starts with a notifying webhook alert containing a prompt excerpt and serving as the thread root. One token status message in that thread is edited for live Commentary and the two-minute shared-banner status. Turn end posts one token message in the thread with Response Handoff text AND the PDF attached together (Markdown fallback), then a webhook finish alert carrying the **Next question**. The finish alert is top-level because the webhook ignores `parentId`. Webhooks are only for alerts in his own spaces; token messages serve editable status, combined finals and messages to other people. Cards are not pushed.

**Why this priority**: Notifications, a final text/document in one message and mobile replies must work together.

**Independent Test**: `tasksync-chat/test-webex-turn-thread.cjs` replays the whole shared-caller turn against fake webhook/token APIs and a controlled clock. `tasksync-chat/test-webex-keychain-isolation.cjs` proves every Webex test uses fake credential storage, never the real Keychain.

**Acceptance Scenarios**:

1. **Given** an enabled own-space webhook and new turn, **When** it starts, **Then** a text/markdown alert contains the prompt excerpt, polling resolves its thread-root id despite no returned id, and one token status message is posted under that root; no cards or inbound laptop endpoint are used.
2. **Given** the turn thread, **When** Commentary arrives or two minutes elapse, **Then** the same token status message is edited with Commentary, current shared metrics and stuck/error indicators, without a webhook alert for each update.
3. **Given** a completed response, **When** handoff runs, **Then** one token message under the root contains banner then current handoff AND the full PDF together (Markdown on conversion failure); after successful delivery a top-level webhook finish alert carries the Next question.
4. **Given** an open handoff, **When** the reviewer replies in the turn thread, on the finish alert, or top-level after it, **Then** outbound polling routes the reply to the correct conversation once, excludes recorded own posts and preserves reload deduplication; a local reply or next turn cancels prior polling.
5. **Given** an unresolved webhook root or failed upload, **When** delivery cannot complete, **Then** it reports sanitized pending/failure and retries within rate limits, never invents an id, claims completion or silently splits the final into two messages.
6. **Given** test credentials, **When** any Webex test runs, **Then** all SecretStorage/Keychain reads and writes use fakes and cannot touch the real Keychain, including `askaway-general`, which a test wrote there on 2026-10-09.

---

### User Story 7 - Command-style Webex tools (Priority: P2)

Reviewer: "In webex spec, can you add some tasks to create command style tools to read messages from webex and so on?" (2026-10-09). Agents use one `askaway_webex` tool exposed as a VS Code LM tool and an AskAway MCP tool through one shared boundary, without handling credentials.

**Why this priority**: Agents need remote context and messaging without parallel tool implementations.

**Independent Test**: `tasksync-chat/test-webex-tools.cjs` exercises both public tool adapters with fake APIs; `tasksync-chat/test-orchestrator-policy.cjs` verifies Build and worker guidance chooses the tool appropriately.

**Acceptance Scenarios**:

1. **Given** authorized fake data, **When** `spaces`, `read`, `thread` or `search` runs, **Then** results contain teams/spaces, recent messages in a space, a thread by message id, or text matches within the selected space respectively, with bounded output and explicit truncation/pagination information.
2. **Given** `send`, **When** the destination is another person or space, **Then** delivery uses the token; an alert to his own configured spaces uses the webhook, without claiming token self-posts notify.
3. **Given** either LM or MCP invocation, **When** arguments/results/errors are observed, **Then** no token, webhook URL or private OAuth credential appears; both surfaces share validation, enabled gating, policy and sanitized observability.
4. **Given** Build or a worker needs Webex context, **When** choosing tools, **Then** its profile teaches the matching `askaway_webex` command instead of raw credential-bearing HTTP/shell calls and the own-space alert versus token-send distinction.

---

### User Story 8 - Cathy acts for me (Priority: P1)

Reviewer, 2026-10-22: "After this finsih spec 009. And i need to have all possible tools for Cathy to chat and read and act on behalf of me. As we have aitalk, Cathy can take persmission from me to send any mesage and all. Room ID is internal so dont show it to me. Space name is what is i see. Instead of agent figuring out things by multiple webex calls, we need tools to optimise that. I will add outlook tool also in future so that Cathy can be my PR or something." Design: [contracts/assistant-tools.md](contracts/assistant-tools.md); decision: [ADR 0035](../../docs/adr/0035-cathy-assistant-tools-and-provider-seam.md); rows R-CATHY-01..08.

**Why this priority**: The reviewer asked for it to follow the rest of 009, and it replaces the id-bearing tools of US7 with the surface he will actually use.

**Independent Test**: Fake Webex API tests (`test-webex-name-resolver.cjs`, `test-webex-macro-tools.cjs`, `test-webex-approval-card.cjs`, `test-webex-assistant-tools.cjs`, `test-webex-no-ids.cjs`) plus `test-assistant-provider-seam.cjs`; live smoke only on explicit opt-in.

**Acceptance Scenarios**:

1. **Given** a space or person name, **When** Cathy reads, searches, waits or checks the inbox, **Then** one call returns names, times, authors, thread markers and attachment text, with a short opaque `ref` where a follow-up needs one, and an ambiguous name returns candidates instead of a guess.
2. **Given** any tool result, AITalk card, Team or Settings text, status file or UI log line, **When** a Webex-shaped id is present in the fake API data, **Then** it appears nowhere the reviewer sees.
3. **Given** a send, reply, edit, delete or upload, **When** Cathy calls the tool, **Then** an AITalk card shows the space or person name, thread context, full text and files; 👍 executes once, 👎 discards, an edit asks again, and no path sends without the approved card; the modal is used only as the explicit fallback when AITalk is unavailable.
4. **Given** a future Outlook provider, **When** it registers through `src/services/assistant/provider.ts`, **Then** its tools list in the registry and its approvals use the same card with a human target label.

---

### User Story 9 - Webex digest from one shared in-memory sync (Priority: P2)

Reviewer, 2026-10-22: "I think we should consider everything not just what we sent thru askaway." "Our webex thing can be a 1 sync call may be recurring if not before any tool call, and store stuff in memory and everything should be served from in memory data structures, so we can reuse across workspaces." "From in memry we can do daily report on the fly(when asked, like a tool. call)." "Sure we can exclude some spaces. But not becaue of privacy but because they will become spam." "See the spaces which are recurring and i havent read them or i havent posted anything in them in the past 5-6 months." "I am not very clear about reply alert yet." "I dont care where it will be."

**Why this priority**: It follows the Cathy tools (US8) and replaces many id-free but chatty reads with one report; it does not block spec 005.

**Independent Test**: Fake Webex API caller-view test `test-webex-digest.cjs`; no live call without the reviewer's opt-in.

**Acceptance Scenarios**:

1. **Given** 1:1 spaces, group spaces and threads where the reviewer is tagged or posted, **When** the sync runs, **Then** they are all in one in-memory index held by the process that owns the AskAway MCP server; a second workspace's tool call reads the same data with no second sync, and no message text is written to disk.
2. **Given** the index is older than a few minutes, **When** any Webex tool is called, **Then** one sync runs first; a fresh index causes no Webex call.
3. **Given** the reviewer asks for the report, **When** `inbox` runs with `mode: digest`, **Then** it lists mentions, replies to his threads and unanswered direct messages by name, built from memory, with no id and no send.
4. **Given** a space where he posted nothing and was not mentioned for six months but that stays active, **When** the report runs, **Then** it is left out and counted in one line; a direct mention or a reply to his message in that space still shows; a space on his mute list is left out the same way.
5. **Given** someone replies to a thread he sent, **When** the report runs, **Then** the reply appears; no push alert is sent (open until he clarifies).

---

### Edge Cases

- Missing or ambiguous team `self` or General destination: report the unresolved destination, never guess another team/space.
- Expired tokens or denied membership: report a sanitized authentication/permission failure; refresh only through the credential boundary.
- Same workspace names: route by workspace identity, not display name alone.
- Reload during a turn: retain own-post IDs and reply deduplication so the reviewer is not echoed or replayed.
- Disabled channel during a retry: stop its pending network work; do not send through Telegram as an implicit fallback.
- User preferences or personal-token behavior suppress a notification: delivery evidence is not notification evidence.

## Requirements *(mandatory)*

### Functional Requirements

Each existing requirement row maps explicitly below; its behavior is preserved through the selected adapter unless the documented personal-token notification limitation applies.

- **FR-001**: A new user message MUST open a new live message and stop polling the previous turn (R-TELE-01; US2).
- **FR-002**: Commentary MUST update the current live message in place (R-TELE-02; US2).
- **FR-003**: Heads-up Commentary MUST be visibly distinguished (R-TELE-03; US2).
- **FR-004**: Live status MUST refresh about every two minutes and warn of stuck/error states (R-TELE-04; US2).
- **FR-005**: The final MUST be a new message replacing the live one; Telegram's notifying behavior MUST remain, while Webex personal-token self-posts MUST disclose their notification limit and bot notification remains subject to US5 (R-TELE-05).
- **FR-006**: Status and final MUST carry cost and tokens, requests and the number of workers spawned this turn; totals MUST include workers (R-TELE-06; US2).
- **FR-007**: Handoff text MUST order banner then current handoff, with no later-turn lag; response details belong in the document (R-TELE-07; US2).
- **FR-008**: Remote replies MUST reach the correct conversation; VS Code replies MUST stop that turn's remote polling (R-TELE-08; US2).
- **FR-009**: Queued messages MUST remain watchable remotely and the next queued message MUST close the previous turn (R-TELE-09; US2).
- **FR-010**: Other workspaces MUST receive only their own live conversation status, never this workspace's Commentary (R-TELE-10; US2/US3).
- **FR-011**: ask_user MUST be reused as a side channel through the shared reply path, not a separate legacy flow (R-TELE-11; US2).
- **FR-012**: Cloud morning digests MUST deliver PR, evidence, duration, model, blocker and decision needed through the selected channel, with no invented cloud price (R-TELE-12; US2).
- **FR-013**: Delivery MUST bound oversized content before formatting conversion, retry formatting rejection as plain text, honor rate-limit delays and retry failed live edits; Telegram's safe HTML handling MUST remain (R-TELE-13; US2/US3).
- **FR-014**: Text MUST contain only banner and response handoff; the whole response MUST be a mobile-friendly PDF attachment, or Markdown when conversion fails (R-TELE-14; US2/US3).
- **FR-015**: VS Code remote-monitoring events MUST reach the selected channel without losing existing coverage (R-TELE-15; US2).
- **FR-016**: Turn observability MUST reuse the shared banner data: cost, workers' share, requests, input/output tokens, cache percent, worker count/details and efficiency score (R-TELE-16; US2).
- **FR-017**: Commentary MUST relay live, not only in periodic status (R-TELE-17; US2).
- **FR-018**: One RemoteChannel interface implemented by Telegram and Webex MUST serve every caller: Commentary, turn lifecycle, handoff/PDF, banner status, cloud digest and ask_user replies; disabled Telegram MUST make zero network calls (R-TELE-18; US2).
- **FR-019**: Telegram implementation and regression tests MUST remain; Telegram MUST be toggled off rather than deleted for this migration (R-TELE-19; US2).
- **FR-020**: "AskAway: Set Webex Token" MUST store credentials in SecretStorage and mirror the access token to macOS Keychain; tokens MUST NOT enter settings, chat, logs or discovery metadata (R-TELE-20; US1).
- **FR-021**: Webex replies MUST use outbound polling with backoff, no webhook, no public endpoint and no claim of a Webex long-poll API (R-TELE-21; US3).
- **FR-022**: Each workspace MUST use one space in team `self`, created if missing; that team's General space MUST serve general delivery (R-TELE-22; US3).
- **FR-023**: share-with-me MUST default to Webex self.General, not Telegram; the already switched script MUST receive a live delivery check (R-TELE-23; US4).
- **FR-024**: Discovery MUST enumerate teams and spaces and persist only non-secret IDs/names/mappings in `.askaway/webex-spaces.json` (US1).
- **FR-025**: Webex MUST track AskAway's posted message IDs and deduplicate replies across polling/reload; it MUST NOT filter every reviewer message solely because it has the posting token's person ID (US3).
- **FR-026**: Webex MUST honor HTTP 429 Retry-After for posting, editing, file upload and reply polling and MUST upload PDF/Markdown documents as files (US3).
- **FR-027**: OAuth client credentials MUST be read privately from `~/.webex.md` when needed, never copied into discovery, test evidence or chat; refreshed access tokens MUST use the same storage/mirror boundary (US1/US3).
- **FR-028**: Final and heads-up text MUST use the destination's stored incoming webhook, with OAuth fallback when absent; files remain OAuth uploads. URLs MUST stay in SecretStorage (General mirrored to Keychain), setup MUST offer a named reminder, and Incoming Webhooks posts MUST NOT become replies. Bots MUST NOT be provisioned (R-TELE-29..31; US5).
- **FR-029**: The command MUST start fresh browser OAuth using private integration credentials and exactly `http://localhost:5000/callback`, with no local listener; a local masked VS Code prompt MUST accept the full return URL, NEVER chat, validate redirect/state/code, exchange it and securely store access/refresh tokens (R-TELE-24/25/27/28; US1; T024/T026–T028).
- **FR-030**: Later requests MUST reuse stored tokens and refresh/rotate them when needed through the credential boundary; this MUST NOT replace fresh browser authorization on command invocation (R-TELE-26; US1; T007/T025).

- **FR-031**: Setup MUST follow `askaway.webex.enabled`: completing setup enables it, enabling starts setup and disabling stops all calls. General delivery/share-with-me MUST use created AskAway General in team `self` (R-TELE-32/33; US1/US3/US4).
- **FR-032**: Webex MUST expose Telegram-equivalent polling status/countdown and accept genuine space replies (R-TELE-34/35; US2/US3/US6).
- **FR-033**: A turn MUST start with a webhook prompt-excerpt alert, resolve its root id by polling and keep one threaded token status message edited for Commentary and two-minute status. Webhooks MUST be text/markdown only; ignored parentId and absent returned id MUST NOT be treated as threading support; cards MUST NOT be pushed (R-TELE-38/39; US6; T031 delivers T010).
- **FR-034**: Final handoff markdown AND PDF MUST be in ONE token message under the root (Markdown fallback), followed by a webhook finish alert carrying the Next question. This supersedes FR-028's earlier split final routing and R-TELE-36/37; token posts never notify, bots MUST NOT be provisioned (R-TELE-38/39; US6).
- **FR-035**: Replies in the turn thread, on the finish alert or top-level after it MUST reach the correct conversation once, retaining own-post exclusion, reload deduplication and prior-turn/local-reply polling cancellation (R-TELE-40; US6).
- **FR-036**: Every Webex test MUST fake SecretStorage and Keychain reads/writes, never touch the real Keychain; guard the 2026-10-09 `askaway-general` contamination (US6; T032).
- **FR-037**: One `askaway_webex` LM + AskAway MCP tool MUST support `spaces` (teams/spaces), `read` (recent space messages), `thread` (message-id thread), `search` (text within a space) and `send` (person/space), with bounded output and explicit truncation/pagination; arguments/results/errors MUST contain no secrets (R-TELE-41; US7; T033).
- **FR-038**: Sends MUST use the token for other people/spaces and webhook only for own-space alerts; AskAway Build and worker profiles MUST teach when to use the shared tool and its secret/policy boundary (R-TELE-38/41; US7; T033/T034).
- **FR-040**: Reviewer 2026-10-12 supersedes FR-037's single LM tool: eight separate Webex worker MCP tools, no main-agent LM registration; pending AITalk drafts send once on approval, with modal fallback (R-TELE-43).
- **FR-041**: Plain Node fetches up to 200 own messages across active spaces; weekly style card condenses tone, casing, openers, length, emoji habits and six verbatim examples into at most 40 lines (R-TELE-44).
- **FR-042**: Cathy's tools MUST take and return space and person names; Webex ids MUST NOT appear in tool results, AITalk cards, Team or Settings text, status files or UI log lines. Follow-ups use short opaque refs resolved in the host; ambiguous names return candidates (R-CATHY-02/03; US8; S1/S3).
- **FR-043**: Macro tools (inbox, find, read, search, wait, meetings, send, reply, edit message, delete message, edit draft, style card; at most 12) MUST replace the nine id-based tools and the LM `askaway_webex` surface; meetings are read-only and "unread" is AskAway's own seen watermark (R-CATHY-01/04; US8; S1/S3).
- **FR-044**: Every outbound action MUST be an AITalk approval card showing the target name, thread context, full text and files; 👍 executes once; no code path sends without it; the R-TELE-43 modal is only the explicit AITalk-unavailable fallback (R-CATHY-05/06; US8; S2).
- **FR-045**: Webex MUST be one provider behind `src/services/assistant/provider.ts` (provider, approval request without an id field, registry) so an Outlook provider can be added without changing the card (R-CATHY-07; US8).

- **FR-046**: One sync MUST load rooms, memberships' last activity, the reviewer's own messages and mentions into in-memory structures in the process that owns the AskAway MCP server; it MUST run before a Webex tool call when the data is older than the freshness limit, and MUST NOT write message text to disk (R-CATHY-10; US9).
- **FR-047**: The digest MUST cover all spaces and threads the reviewer is in, not only AskAway-sent messages, and MUST be read-only (R-CATHY-09; US9).
- **FR-048**: `inbox` MUST gain `mode: digest`, built from memory on demand; the tool set stays at most 12 (R-CATHY-11; US9).
- **FR-049**: Excluded spaces (mute list or the six-month quiet rule) MUST be skipped as spam, never for privacy; a mention or a reply to the reviewer MUST still show, and the skipped count is shown in one line (R-CATHY-12; US9).
- **FR-050**: Replies to threads the reviewer sent MUST appear in the digest; a push alert MUST NOT be built until the reviewer clarifies (R-CATHY-13; US9).

### Key Entities *(include if feature involves data)*
- **FR-039**: Availability is evaluated at each turn send: Here sends nothing; away-prefixed modes send the full flow; Offline sends only the silent reply-tracked final; entering Away mid-turn opens the thread. Reply polling remains available (2026-10-10; test-availability-updates.cjs).

- **RemoteChannel**: Shared outbound text/edit/final/document and inbound reply lifecycle contract; channel-neutral message identifiers accommodate Telegram numbers and Webex strings.
- **Credential record**: Access/optional refresh token in SecretStorage, access-token Keychain mirror and private OAuth configuration; excluded from all metadata.
- **Space discovery**: Non-secret team/space IDs and names in `.askaway/webex-spaces.json`, with workspace-to-space and self.General destinations.
- **Remote turn**: Workspace, conversation/turn identity, active live/final message and reply-polling state.
- **Message ledger**: Posted IDs and processed reply IDs scoped to workspace/space for self-post exclusion and reload-safe deduplication.
- **Response document**: Whole final response converted to mobile-friendly PDF, with Markdown fallback.
- **Webex index**: In-memory rooms, last activity, the reviewer's own posts, mentions and replies, with a sync time; shared by every workspace through the MCP owner; mute list and seen watermark are the only persisted parts.
- **Assistant ref**: A short opaque handle (s3, m12, p4) for a space, message or person, valid for the workspace session and resolved only inside the host; the raw Webex id never leaves the service.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All R-TELE-01 through R-TELE-28 rows have explicit FR coverage and caller-view verification; no remote-monitoring capability is lost in the parity replay. OAuth guards remain gaps until builder and independent gates pass.
- **SC-002**: In every seeded credential test, zero secrets appear in settings, chat, logs, discovery files or evidence.
- **SC-003**: Disabled Telegram generates zero network calls across all shared caller scenarios.
- **SC-004**: Each tested turn has one active live message, status updates about every two minutes, a new final and exactly one delivery per genuine reviewer reply across re-poll/reload.
- **SC-005**: All two-workspace scenarios route to the correct workspace space with zero cross-workspace Commentary leakage.
- **SC-006**: All rate-limit fixtures wait at least Retry-After; all document scenarios deliver PDF or the named Markdown fallback without silently dropping the response.
- **SC-007**: One explicitly requested live share-with-me check delivers a harmless document to self.General, with zero Telegram calls and no token in evidence.
- **SC-008**: Personal-token notification limitations are disclosed in every tested configuration; webhook phone notification needs separate live evidence, and bots are not provisioned.
- **SC-009**: US6 turn replays produce one start alert, one edited threaded status, one combined final and one finish alert; all supported reply locations route once, with zero real Keychain calls.
- **SC-010**: All five commands pass both tool surfaces with bounded secret-free output; Build/worker policy checks select the shared tool.

## Assumptions

- Existing `tasksync-chat/src/services/webexService.ts` and `webexAuth.ts` are reused for Webex/authentication; current settings/file token fallbacks are not proof of the command-only requirement.
- Existing `telegramService.ts`, `commentary/telegramLive.ts`, `services/handoffNotifier.ts` and `cloud/cloudDigest.ts` are integration points, not parallel implementations to replace with look-alikes.
- The reviewer can access team `self`; discovery determines actual IDs without reading credentials into agent context.
- The script switch and `SHARE_CHANNEL=webex` default were done on 2026-10-08; live share-with-me runs on 2026-10-09 delivered a notifying message plus spec.pdf to AskAway General (T019), not proof of US6's lifecycle.
- This is documentation only. T001/T002 are in progress elsewhere and remain unchecked until their evidence passes. plan.md, contracts and the bot decision precede further implementation where required.
