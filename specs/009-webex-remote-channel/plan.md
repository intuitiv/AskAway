# Plan: Webex Remote Channel — US1 OAuth amendment

Date: 2026-10-08. This narrow authentication plan does not close T003 or plan the remaining migration.

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
