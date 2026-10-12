# Implementation Plan: Webex Remote Channel

Date: 2026-10-12. Branch: `009-webex-remote-channel`. Input: [spec.md](spec.md). This migration plan preserves the earlier US1 OAuth amendment below.

## Summary

Reuse one RemoteChannel boundary for Webex and retained, toggled-off Telegram. Migrate callers without duplicate content/render logic. Personal-token self-posts never notify; outbound incoming-webhook calls provide alerts, not inbound laptop endpoints. Reply polling uses REST with backoff, not a claimed long-poll API. General is owned AskAway General in team self.

## Technical Context

TypeScript VS Code extension on Node; existing fetch/FormData and esbuild fake-backed Node caller-view tests. SecretStorage plus macOS Keychain mirror hold credentials. Workspace-local `.askaway/webex-spaces.json` and `.askaway/webex-messages.json` hold non-secret mappings and bounded posted/processed IDs. Tests inject auth/HTTP and forbid real Keychain/network by default. No new service or UI is planned.

## Constitution Check

AGENTS.md requires shared components, caller-view tests, preserved reviewer wording and no requirement regressions. Existing ADR 0018 is Accepted; proposed ADR 0020 changes authentication only. Latest availability and combined-final decisions win. No ADR status or reviewer wording changes. Implementation gaps cannot close by rewriting requirements.

## Project Structure and Existing Callers

| Boundary / caller | Existing source | Verification |
|---|---|---|
| Shared adapters | tasksync-chat/src/services/remoteChannel.ts; webexService.ts; telegramService.ts | test-remote-channel-contract.cjs; test-remote-channel-parity.cjs |
| Space/auth/ledger | tasksync-chat/src/services/webexSpaces.ts; webexDiscover.ts; webexAuth.ts; webexService.ts | test-webex-workspace-space.cjs; test-webex-remote-adapter.cjs |
| Commentary/new/queued turns, two-minute status | tasksync-chat/src/commentary/telegramLive.ts; src/extension.ts | test-telegram-turn-lifecycle.cjs; test-webex-turn-thread.cjs |
| Handoff/PDF/Markdown/shared banner | tasksync-chat/src/services/handoffNotifier.ts | test-remote-handoff.cjs; test-remote-channel-parity.cjs |
| Cloud digest | tasksync-chat/src/cloud/cloudDigest.ts | test-cloud-digest.cjs |
| ask_user and local reply cancellation | tasksync-chat/src/tools.ts; src/webview/webviewProvider.ts; src/services/webexWiring.ts | test-webex-ask-user.cjs |
| External share-with-me | ~/.local/bin/share-with-me (do not read credentials) | test-share-with-me-webex.cjs, explicit live opt-in only |

## Decision Register

| Decision | Source | Consequence |
|---|---|---|
| Retain Telegram, toggle off | GOALS G7 / ADR 0018 | Disabled adapter makes zero network calls; regressions remain. |
| Team self, workspace identity, AskAway General | GOALS Webex answers/General; R-TELE-22/33 | Refuse ambiguity, create missing spaces once, persist mappings per workspace. |
| Outbound polling, own-post IDs | FR-021/025 | Same-person reviewer replies remain valid; reload must not echo/replay. |
| Webhook alerts, token status/final+file | GOALS Webex turn thread; FR-033/034 | No cards, assumed webhook ids, or silently split final. |
| Per-send availability | R-TELE-01/38/39 | Here silent, Away full flow, Offline silent reply-tracked final. |
| US5 deferred verification | Current packet; research.md | No live notification closure; bots remain prohibited, not an undecided bot design. |

## Story Scenarios and Delivery Order

1. T003/T004: Given the migration artifacts, When planning/docs guards run, Then callers and all requirement mappings are checked before closure.
2. T006/T014 (US3): Given fake spaces/messages, When sending/polling/reloading/uploading, Then routing, same-person exclusion/deduplication, Retry-After, formatting/edit recovery and secret-free output pass. Extend tests before changing the owning adapter rule.
3. T008 (US2): Given identical new/queued turns and metrics, When either adapter carries Commentary/status/final/digest/replies, Then content, ordering, documents and cancellation match; disabled Telegram makes zero calls.
4. T023: Given passing named guards, When requirement rows are cited, Then original wording and honest gaps stay intact.
5. US4/T018 and live delivery T022: Given ASKAWAY_WEBEX_LIVE=1 and safe credential injection, When the script shares a harmless document, Then independently observe arrival and no Telegram fallback. Otherwise print SKIP, never claim a live pass.

## Cloud Worker Packet

Explicit base commit: `4068059` (packet base, not an inferred branch or current HEAD). No cloud run authorized. Any delegated packet must declare exact allowed paths, tests and evidence. The current packet allows src/webex/**, src/telegram/**, src/remote/**, but actual adapters live in src/services/** and Commentary in src/commentary/**: request corrected scope, never relocate source to bypass it. Preserve concurrent changes.

## Verification

`rtk node tasksync-chat/test-spec-planning-contract.cjs` and `rtk node tasksync-chat/test-goals-docs.cjs` guard planning and all-row artifact coverage. `rtk npm --prefix tasksync-chat run test:workers` is the acceptance gate; `rtk npx tsc -p tasksync-chat --noEmit` must report its real exit code. Zero matched tests and skipped live evidence are not passes. No deployment is part of this plan.

## Confirmed source

> http://localhost:5000/callback is redirect url
> COmmand should refresh main token, by opening url in browser and all. I'll do auth in the browser and give back redirected url, from that you can do the rest

Source: [GOALS.md](../../GOALS.md), Webex OAuth confirmation; [proposed ADR 0020](../../docs/adr/0020-webex-browser-oauth-manual-callback.md). ADR 0018 remains Accepted.

## US1 boundary and order

1. T026: use exactly `http://localhost:5000/callback` for authorization and exchange. No local listener, webhook or public endpoint.
2. T027: each Set Webex Token invocation privately loads integration credentials and opens fresh browser authorization, even if tokens exist.
3. T028: the reviewer completes browser sign-in and pastes the full return URL into a local masked VS Code prompt, NEVER chat. Warn that localhost may show connection refused; copy the address-bar URL anyway. Validate redirect/state/code before exchange; cancellation/rejection leaves credentials unchanged. Store access/refresh tokens in SecretStorage and mirror the access token to Keychain. Never log credentials, codes or return URLs.
4. T007/T025: later requests reuse stored access tokens and refresh/rotate through the credential boundary, not another command-driven browser sign-in.

## Verification and closure

Builder extends existing `tasksync-chat/test-webex-token-command.cjs` for caller-visible browser/prompt/exchange/storage/rejection/cancellation behavior and absence of a listener; `test-webex-auth-storage.cjs` guards reuse/refresh. Compile/type-check belongs to that implementation packet. Both builder and independent gates must pass before T024–T028 or T007 close. Callback POC and reviewer confirmation are done; implementation/testing are not. Docs verification: `rtk node tasksync-chat/test-goals-docs.cjs`. No deployment claimed.
