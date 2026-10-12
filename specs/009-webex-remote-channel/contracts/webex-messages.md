# Webex destination and message contract

Binding: spec 009 FR-022/024/025/026/031/033–036; GOALS G7 and dated Webex answers. Newer availability and single-message final decisions supersede earlier split delivery.

## Destination records

`.askaway/webex-spaces.json` stores teams `{id,name,rooms:[{id,title}]}` and `self:{teamId,workspaceRoomId,generalRoomId}` only. Resolve exactly one team named self; refuse ambiguous teams or duplicate workspace/AskAway General spaces. Create missing spaces once. General means owned **AskAway General**, not built-in General. Workspace identity scopes the metadata file; never route another workspace's Commentary into it. No tokens, refresh tokens, OAuth credentials or incoming URLs belong in metadata.

## Message ledger

`.askaway/webex-messages.json` is workspace-local: `{roomId,posted:[string],processed:[string],tasks:[{taskId,messageId,question,timestamp,handoff?,choices?,turnRoot?,allowRoomReply?}]}`. IDs are opaque strings, not person identities. Restore only for the matching room; atomically persist accepted posts, consumed replies and pending tasks. Bound each collection to 500. Exclude recorded own-post IDs, not all messages sharing the reviewer's person ID. Deliver genuine replies once across polls/reload; local resolution and a new turn cancel old tracking.

## Wire and failure behavior

Outbound polling only: no inbound listener/public laptop endpoint or Webex long-poll claim. Token REST messages support markdown/text; rejection retries plain text. Await Retry-After before retrying post/edit/upload/poll; failures remain observable and must not claim delivery. PDF/Markdown files are multipart uploads with exact bytes. Final handoff and document share ONE token message; webhook alerts carry only text/markdown, return no usable message ID and cannot thread. Resolve roots by polling, never invent them. Credentials stay behind injected auth/SecretStorage/Keychain boundaries; notices, ledger and results must be secret-free. Every test fakes credential access.

## Evidence limits

`test-webex-remote-adapter.cjs` guards routing, create/reuse/ambiguity, POST/PUT/upload/poll rate-limit delay, formatting fallback, upload bytes/errors, automatic transient edit retries, 7000-character transport bounds, same-person replies/reload and secrecy/disabled gating. Retries are bounded to three; exhausted failures return false for caller recovery. Same-basename workspace identity remains a gap; contract text does not imply implementation acceptance.
