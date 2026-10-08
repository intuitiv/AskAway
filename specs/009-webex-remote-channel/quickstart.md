# Quickstart: US1 confirmed browser OAuth

## Verified command flow (installed; Reload Window required; live browser authorization UNVERIFIED)

2026-10-08 reviewer source:

> http://localhost:5000/callback is redirect url
> COmmand should refresh main token, by opening url in browser and all. I'll do auth in the browser and give back redirected url, from that you can do the rest

1. Run **AskAway: Set Webex Token**. It must open fresh browser authorization using private local integration credentials, not request a raw token.
2. Complete authorization in the browser. The exact redirect is `http://localhost:5000/callback`. There is **no local listener**, so the browser may show **connection refused**; this does not mean you should send credentials to chat.
3. Copy the **full address-bar URL** into the **local masked VS Code prompt only, NEVER chat**. The command must validate the return URL/state and exchange the code, then securely store access/refresh tokens and mirror the access token to Keychain. Do not include the URL, code or tokens in evidence.
4. Later requests reuse stored credentials and refresh when needed. Rerunning the command starts fresh browser authorization.

## Gates

T024–T028 are complete for implementation and caller-view testing. T007 remains open: legacy secret-settings fallback removal/migration is not confirmed complete. Deployment is verified as installed on 2026-10-08; **Developer: Reload Window is mandatory before using the updated extension**. Live browser OAuth remains **UNVERIFIED**; no browser opening, user sign-in, live authentication, broad Webex parity, delivery or notification success is claimed.

## Verified evidence — 2026-10-08

Evidence supplied by the main orchestrator for this documentation closure (not rerun by this docs packet):

- Code: `tasksync-chat/src/services/webexAuth.ts` and `webexService.ts` implement command OAuth, secure storage and refresh; `tasksync-chat/src/extension.ts` uses the corrected static activation import instead of invalid await import.
- Builder and independent review: PASS on all three original defects. Existing `tasksync-chat/test-webex-token-command.cjs` passes five named caller-view checks: manual URL/state and secure stores; service refresh; fresh-auth stale-refresh protection; legacy postText 401 retry once; unchanged-reload rotation. There is no separate auth-storage test file.
- Full `test:workers` gate: explicit `WORKER_GATE_EXIT=0`, reported by the main orchestrator. This closes the OAuth verification gate, not unfinished parity or live checks.
- Actual extension compile: `node node_modules/typescript/bin/tsc -p ./ --noEmit`, run from `tasksync-chat/`, with explicit `TSC_EXIT=0`. Root `rtk npx` compilation is not evidence: it resolves the wrong package.
- Installed deployment — 2026-10-08: MAIN's final fail-fast sequence after the static activation fix confirmed `WORKER_GATE_EXIT=0` and actual compiler `TSC_EXIT=0`, then a Node esbuild build and bundle/package copy into `~/.vscode/extensions/intuitiv.askaway-1.0.35`. Byte comparison reported **`DEPLOYED OK: bundle byte-identical`**. This is supplied installation evidence, not a deployment performed by this docs packet. **Developer: Reload Window is required**; reload and live browser OAuth are not verified by the byte comparison.

These gates support T024/T025 and exact redirect/browser/paste-flow tasks T026–T028 only. They do not close T007's residual migration or unrelated stories.

Docs check: `rtk node tasksync-chat/test-goals-docs.cjs`.
