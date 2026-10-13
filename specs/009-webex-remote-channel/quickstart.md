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

## Scoped adapter/parity checks — 2026-10-12

### Follow-up evidence (supersedes earlier gate failure)

Latest T008/T023 continuation: real provider final snapshot now passes combined requests, worker count/IDs/dollars, cache percent and canonical efficiency to the existing formatter. Only getTurnMetricsSnapshot changed; no presence region or commentary.ts edits; CRLF explicitly asserted. `rtk node tasksync-chat/test-remote-channel-parity.cjs` passes `PASS EV-REMOTE-CHANNEL-PARITY matched=2 provider metrics; new/queued turns; commentary/heads-up; two-minute/stuck status; full final banner; PDF/Markdown; digest; once-only reply/local stop; disabled Telegram; CRLF` with PARITY_EXIT=0. All five test-telegram-*.cjs exit 0; repository `.bin/tsc -p tasksync-chat --noEmit` TSC_EXIT=0; goals/44-row coverage docs checks PASS. T008/T023 ticked; identity/live gaps remain separate. No network or real credentials used. Earlier provider/full-parity blocker notes below are historical and superseded.

Latest source packet: WebexService bounds text/edit to 7000 characters and retries transient PUT 5xx up to three times with awaited 1000ms delay. Shared final formatter preserves supplied request/worker share/IDs/cache/efficiency fields. Red assertions failed before these fixes; expanded adapter matched=6 and parity matched=2 now exit 0. All five Telegram suites exit 0. Repository `.bin/tsc -p tasksync-chat --noEmit` TSC_EXIT=0. Latest worker gate WORKER_GATE_EXIT=1: `Cannot read properties of undefined (reading 'tab')` at `media/aitalk/talkController.js:53:24` / `test-aitalk-extension.cjs:53:21`; outside this packet. T014 closed; T006 same-basename routing and T008/T023 production-provider/full lifecycle remain blocked. commentary.ts untouched. Sonar quality diagnostics remain in WebexService (complexity/await-in-loop); no unrelated refactoring performed.

- `rtk node tasksync-chat/test-spec-planning-contract.cjs`: `PASS EV-WEBEX-MIGRATION-PLAN callers=6 rules=5 explicit base/scope, decisions and story scenarios`.
- `rtk node tasksync-chat/test-goals-docs.cjs`: `PASS EV-WEBEX-REQUIREMENTS-COVERAGE rows=44 unique FR/story/test-or-gap mappings` and `PASS EV-GOALS-DOCS goals=17 adrs=20 quotes=58 links=231`.
- Adapter matched=5 and parity matched=2 still pass individually; source fixes blocked because actual code lives in src/services/** and src/commentary/**, not allowed source globs.
- Latest `rtk npm --prefix tasksync-chat run test:workers`: `TypeError: browser.ui.traceRowsHtml is not a function` at `test-trace-tab-unification.cjs:71:29`; gate stops in pretest before packet tests.
- Real requested `npx tsc -p tasksync-chat --noEmit` exit **1**: root resolves a non-TypeScript tsc package (`This is not the tsc command you are looking for`). RTK's `TypeScript: No errors found` was not reliable evidence. Checked via a synchronous subprocess, then repository binary `node tasksync-chat/node_modules/typescript/bin/tsc -p tasksync-chat --noEmit` exit **0** (`LOCAL_TSC_EXIT=0`). No package install or tooling changes made.
- T003/T004 close; T006/T008/T014/T023 await source-scope correction. T018/T022 live remain open, US5 live verification deferred. No live calls or deployment.

- `rtk node tasksync-chat/test-webex-remote-adapter.cjs`: `PASS EV-WEBEX-REMOTE-ADAPTER matched=5 routing; Retry-After/plain fallback; upload/error/edit recovery; reload IDs; secrecy/disabled`.
- `rtk node tasksync-chat/test-remote-channel-parity.cjs`: `PASS EV-REMOTE-CHANNEL-PARITY matched=2 Webex/Telegram preserve status fields and shared final cost/token banner`.
- Default share-with-me test: `SKIP EV-SHARE-WITH-ME-WEBEX matched=0 live arrival requires ASKAWAY_WEBEX_LIVE=1; no network or credentials read`. Zero matched live cases is not a pass. FR-036 blocks executing the credential-reading external script without a fake boundary.
- Acceptance `rtk npm --prefix tasksync-chat run test:workers` reached both new PASS lines and live SKIP, then failed outside this packet at `tasksync-chat/test-workers-control-plane.cjs:250:12`: `an expanded row stays open across the 1s re-render`. Later Telegram/docs/planning tests did not run.
- Coverage: partial FR-006/007/013/016/022/025/026, SC-002/004/005/006; not comprehensive closure. See tasks.md's eight explicit dispositions and checklists/requirements.md. No deployment, live upload or phone notification claimed.
