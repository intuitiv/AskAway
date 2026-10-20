---

description: "Task list for 009 Webex Remote Channel"
---

# Tasks: Webex Remote Channel

**Input**: Design documents from `/specs/009-webex-remote-channel/`

**Prerequisites**: plan.md (required before further implementation; not authored by this docs packet), spec.md, research.md, data-model.md, contracts/. T001 and T002 are already being built in separate packets; their status remains unchecked here.

**Tests**: Explicitly requested. Every task names its caller-view test; write behavior tests first, prove they fail, then implement. Live delivery requires an explicit request and non-secret evidence. Zero matched tests is failure.

**Organization**: Setup, Foundational, one phase per user story, then Polish. All completion boxes await actual verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies).
- **[Story]**: User story traceability (US1 to US7).
- Include exact file paths and caller-view verification in each task.

## Path Conventions

Extension code: `tasksync-chat/src/`; caller-view tests: `tasksync-chat/test-*.cjs`; fixtures: `tasksync-chat/build/`; discovery: `.askaway/webex-spaces.json`; external script: `~/.local/bin/share-with-me` (US4 live check only).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Record the implementation contract without guessing Webex capabilities or secret values.

- [x] T003 Plan the migration in `specs/009-webex-remote-channel/plan.md` and `research.md`; `test-spec-planning-contract.cjs` PASS EV-WEBEX-MIGRATION-PLAN callers=6 rules=5 (2026-10-12). US5 design is confirmed; live verification deferred.
- [x] T004 [P] Record all R-TELE coverage in `checklists/requirements.md`; `test-goals-docs.cjs` PASS EV-WEBEX-REQUIREMENTS-COVERAGE rows=44 and PASS EV-GOALS-DOCS (2026-10-12); original wording preserved.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the one shared channel boundary and safe metadata before caller migration.

**⚠️ CRITICAL**: Further story implementation depends on this contract; existing T001/T002 packets continue under their own scope.

- [x] T005 Define the RemoteChannel input/output, channel-neutral message IDs, text/edit/final/file/reply lifecycle, enabled gating and sanitized errors in `specs/009-webex-remote-channel/contracts/remote-channel.md`; caller-view test `tasksync-chat/test-remote-channel-contract.cjs` verifies both adapters expose the same contract. Done 2026-10-08: parameterized Telegram/Webex fake-backed suite, five named regressions and TypeScript noEmit pass; separate data records remain T006.
- [x] T006 Define workspace destination and persisted own-post/reply-ID behavior in `specs/009-webex-remote-channel/contracts/webex-messages.md`, including ambiguous self/General refusal and no credential fields; caller-view test `tasksync-chat/test-webex-remote-adapter.cjs` guards routing and reload-safe self-post exclusion (depends on T003, T005). Same-basename identity resolved 2026-10-13 by the reviewer: "We can have counter in such case. `_1`, `_2` and so on." `webexSpaces` keeps a workspace path → title map in `~/.askaway/webex-workspace-spaces.json`; a folder name owned by another workspace gets `<name>_1`, `<name>_2`, …; a room the workspace already recorded keeps its title. Done 2026-10-13: `rtk node tasksync-chat/test-webex-workspace-space.cjs` → `PASS Webex same folder name: second workspace gets <name>_1, mapping persisted and stable on reload`; `test-webex-remote-adapter.cjs` PASS EV-WEBEX-REMOTE-ADAPTER.

**Checkpoint**: The shared contract and data boundaries are ready; no webhook/public URL or secret discovery fields are introduced.

---

## Phase 3: User Story 1 - Set a token and discover destinations safely (Priority: P1) 🎯 MVP

**Goal**: Masked command storage and non-secret team/space discovery.

**Independent Test**: Captured SecretStorage/Keychain and paginated discovery show storage/cancellation/error behavior and non-secret metadata.

### Tests for User Story 1

Write caller-view tests first; T001/T002 include both test and implementation and are already being built, not accepted by this document.

### Implementation for User Story 1

- [x] T001 [US1] Set the Webex token through the command in `tasksync-chat/src/services/webexAuth.ts`, registration in `tasksync-chat/src/extension.ts` and `tasksync-chat/package.json`; caller-view `tasksync-chat/test-webex-token-command.cjs` asserts masked input, SecretStorage and macOS Keychain mirror, cancellation and sanitized failures, with no token in settings/chat/logs (FR-020/FR-027; being built now, unticked).
- [x] T002 [US1] Discover teams/spaces through `tasksync-chat/src/services/webexService.ts` and persist IDs/names to `.askaway/webex-spaces.json`, mirror General destination through `webexAuth.ts`; caller-view `tasksync-chat/test-webex-discover.cjs` asserts pagination, self/General discovery and no secrets in metadata/evidence (FR-024; being built now, unticked; integration after T001).
- [x] T007 [US1] Make command-backed credentials the Webex authentication source and route OAuth refresh through `tasksync-chat/src/services/webexAuth.ts` and `webexService.ts`, removing secret settings dependence without exposing `~/.webex.md`; caller-view `tasksync-chat/test-webex-token-command.cjs` verifies secure storage and refresh (FR-020/FR-027; depends on T001/T002, T005). Evidence (2026-10-10): `rtk node tasksync-chat/test-webex-incoming-webhook.cjs` PASS SecretStorage tokens only; settings/token file ignored. Legacy token-file reads/writes and secret-setting reads removed from startup, expiry and status paths; non-secret room settings, private OAuth integration credentials and secure webhook storage preserved. Touched incoming-webhook/live-reply/one-item/turn-thread tests passed individually; token-command refresh regression PASS; `rtk node tasksync-chat/test-webex-keychain-isolation.cjs` PASS tests=12 securityCalls=0; TypeScript noEmit clean.
- [x] T024 [US1] Replace manual token entry in AskAway: Set Webex Token with browser OAuth using `~/.webex.md` and a manually pasted, state-validated return URL in a local masked VS Code prompt, NEVER chat; retain secure storage, with no local listener (R-TELE-24/25/27/28). Done 2026-10-08: builder and independent review PASS, existing `tasksync-chat/test-webex-token-command.cjs` five named checks, full worker gate `WORKER_GATE_EXIT=0` and actual extension compile `TSC_EXIT=0`; proof in `quickstart.md`. Live browser authorization and deployment remain pending; detailed asks T026–T028.
- [x] T025 [US1] Verify stored access/refresh tokens are reused and rotated when needed through the implemented authentication boundary; existing caller-view `tasksync-chat/test-webex-token-command.cjs` verifies service refresh, fresh-auth stale-refresh protection, legacy postText 401 retry once and unchanged-reload rotation (reviewer 2026-10-08, R-TELE-25/R-TELE-26). Done 2026-10-08: builder and independent review PASS, five named checks plus full worker gate and actual extension compile pass; proof in `quickstart.md`. T007's legacy fallback removal/migration remains separate and open.
- [x] T026 [US1] Use exactly `http://localhost:5000/callback` for browser authorization and code exchange, with no local listener; warn that localhost may show connection refused and the full address-bar URL must go only into the local masked VS Code prompt. Guard: `tasksync-chat/test-webex-token-command.cjs` (R-TELE-27; source: "http://localhost:5000/callback is redirect url", 2026-10-08). Done 2026-10-08: T024's builder/independent review, caller-view checks, worker gate and compile proof in `quickstart.md`; live browser authorization pending.
- [x] T027 [US1] Start fresh browser sign-in on every Set Webex Token invocation, even with stored tokens; guard browser opening and fresh-auth stale-refresh protection from the caller's view in `tasksync-chat/test-webex-token-command.cjs` (R-TELE-28; source: "COmmand should refresh main token, by opening url in browser and all.", 2026-10-08). Done 2026-10-08: T024's verified gates and proof in `quickstart.md`; live browser authorization pending.
- [x] T028 [US1] Accept the full pasted return URL only in a local masked VS Code prompt, NEVER chat; validate redirect/state/code, exchange for access/refresh tokens and retain secure SecretStorage/access-token Keychain storage. Guard rejection, cancellation and sanitized failures in `tasksync-chat/test-webex-token-command.cjs` (R-TELE-25/28; source: "I'll do auth in the browser and give back redirected url, from that you can do the rest", 2026-10-08; depends on T026/T027). Done 2026-10-08: T024's verified gates and proof in `quickstart.md`; deployment and live browser authorization pending. No broad Webex parity or notification closure.

- [x] T029 [US1] Fix the live browser authorization rejection `invalid_scope` reported 2026-10-08 by matching requested scopes to the integration's supported permissions; guard authorization scope construction and safe error handling in `tasksync-chat/test-webex-token-command.cjs`. Implemented and independently verified 2026-10-08: six named checks and full gate `WORKER_GATE_EXIT=0`; validated local `Scopes:` metadata or masked local input replaces the guessed default and preserves stored tokens on failure. [Webex scope documentation](https://developer.webex.com/docs/integration-scopes) lists `spark:all` as valid, but requested scopes must match registered integration permissions. Earlier scope-only retries failed; T030 records the approved working-integration transfer. After the reviewer pasted the browser return URL, a private read-only live check confirmed `ACCESS_TOKEN_PRESENT=true`, Keychain modification UTC `20261008174234`, and `/people/me` returned `WEBEX_HTTP_STATUS=200`, `ACCESS_TOKEN_ACCEPTED=true`. No token, callback state, account details or credentials were displayed. Live refresh-token exchange was not independently tested; later user edits to the credential file were preserved.

T029 follow-up (2026-10-08): authorization still returned `invalid_scope` with the 13 confirmed scope names. The installed bundle matches the local build. The [official scope reference](https://developer.webex.com/docs/integration-scopes) says Webex automatically adds `spark:kms` and manually built authorization URLs must include it for encrypted messaging. Local metadata now retains the original 13 scopes plus `spark:kms`; parser verification passed without displaying credentials. This corrects a documented missing dependency, not a proven explanation of the rejection; registered-scope/client matching and successful live sign-in remain unverified. No callback state is recorded.

T029 subsequent retry (2026-10-08): `invalid_scope` persists with KMS included. Anonymous Webex-only preflights using the full set, a messaging subset, and both `+`/`%20` space encodings reached HTTP 200 pages without login; these do not verify authenticated consent or registered permissions. No tokens were requested or stored. Further scope edits are paused pending the non-secret `scope` value from Webex's generated authorization URL for the same integration, with its client ID compared locally to the credential file. Root cause remains unconfirmed; no callback state or credential values are recorded.

- [x] T030 [US1] Compare AskAway authorization with the working Webex setup in `/Users/machs/PycharmProjects/documentation`, then apply the smallest evidenced correction and guard it from the caller's view in `tasksync-chat/test-webex-token-command.cjs`. Source: "/Users/machs/PycharmProjects/documentation - project has working webex setup. Refer to it." (2026-10-08). Comparison found a different integration in `~/.brainstorm-mcp/config.yaml` and a nine-scope set in `brainstorm-mcp/auth_webex.py`. Reviewer approved private copying with "Sure" (2026-10-08). Copied the working client ID, secret and exact nine scopes atomically into `~/.webex.md`, retaining the localhost5000 callback and unrelated file content; no credential values displayed. Proof: `WEBEX_REFERENCE_CONFIG_OK` verifies equality, mode0600 permissions and unchanged source. Reference project and stored tokens remain untouched; no code change, rebuild or reload is needed because configuration is read on each command invocation. T029 remains open until fresh live sign-in succeeds.

**Checkpoint**: US1's Independent Test passes; token/discovery evidence exists before ticking T001/T002. Live access-token storage and Webex acceptance are verified by T029. Live refresh exchange, legacy settings migration and broader remote-channel delivery remain separate checks.

---

## Phase 4: User Story 2 - Keep one remote experience across channels (Priority: P1)

**Goal**: Every remote caller uses one interface; Telegram stays but is off.

**Independent Test**: The same lifecycle/content/reply replay passes against both adapters with disabled Telegram making no calls.

### Tests for User Story 2

- [x] T008 [US2] Parameterized `test-remote-channel-parity.cjs` PASS EV-REMOTE-CHANNEL-PARITY matched=2 (2026-10-12): real provider snapshot, both adapters/shared relay, new/queued turns, Commentary/heads-up, controlled two-minute/stuck status, final worker/share/IDs/requests/cache/efficiency/cost/tokens, mobile PDF/Markdown fallback, digest, once-only reply/local stop and disabled Telegram. All five Telegram regressions exit 0; repo tsc exit 0; provider CRLF asserted.

### Implementation for User Story 2

- [x] T009 [US2] Implement `tasksync-chat/src/services/remoteChannel.ts` and adapt `telegramService.ts` and `webexService.ts` to the shared contract with channel-neutral IDs and enabled gating; caller-view `tasksync-chat/test-remote-channel-contract.cjs` asserts both adapters against fakes and zero disabled-channel requests. Done 2026-10-08: three PASS lines, five named regressions and TypeScript noEmit pass. No caller rerouting; full caller parity remains T008, persisted message IDs and space creation remain T006/T015/T017.
- [x] T010 [US2] Route live Commentary, turn starts/queued turns, periodic banner status and stop-on-VS-Code-reply through the shared channel in `tasksync-chat/src/commentary/telegramLive.ts`, `src/extension.ts` and `src/webview/webviewProvider.ts`; caller-view `tasksync-chat/test-remote-turn-lifecycle.cjs` asserts in-place edits, heads-up, two-minute refresh, workspace isolation and prior-turn polling cancellation (FR-001 to FR-010/FR-015 to FR-019; depends on T009). Verified 2026-10-09: `rtk node tasksync-chat/test-webex-turn-thread.cjs` PASS for notifying root, edited threaded status, combined final/document, finish alert, turn/alert/top-level replies once and token fallback. Telegram turn-lifecycle, live-commentary and handoff; remote-handoff; Webex live-reply and incoming-webhook regressions pass; TypeScript noEmit clean. Fake-backed evidence, not live device notification.
- [x] T011 [US2] Route handoff and PDF/Markdown upload through the shared channel in `tasksync-chat/src/services/handoffNotifier.ts`; caller-view `tasksync-chat/test-remote-handoff.cjs` asserts banner-then-current-handoff, new final and whole-response document/fallback with no lag (FR-005/FR-007/FR-014/FR-016; depends on T009 and US3 upload T016). Verified 2026-10-09: `rtk node tasksync-chat/test-remote-handoff.cjs` exits 0 with PASS for both Webex and Telegram: shared banner then handoff, notifying final, full PDF/MD, once-only conversation reply and local resolve. Fake-backed delivery evidence; no live device notification claimed.
- [x] T012 [P] [US2] Route cloud digest through the selected shared channel using `tasksync-chat/src/cloud/cloudDigest.ts` and the existing `remoteDigestPoster` boundary; caller-view `tasksync-chat/test-cloud-digest.cjs` asserts PR/evidence/duration/model/blocker/decision, no invented cloud price and no disabled-channel calls (FR-012/FR-018; depends on T009; no concurrent edit of `commentary/telegramLive.ts` with T010). Evidence (2026-10-10): `rtk node tasksync-chat/test-cloud-digest.cjs` → `PASS EV-CLOUD-DIGEST-WEBEX configured Webex preferred; Telegram fallback; Here/Offline suppressed; Away mid-day delivers once; failed/disabled remain pending`; production provider uses the tested shared sendText poster, no turn thread is opened, ASKAWAY_TEST_NO_KEYCHAIN=1, and `rtk npx tsc -p tasksync-chat --noEmit` → `TypeScript: No errors found`.
- [x] T013 [US2] Reuse ask_user as the side channel and route incoming replies through the same contract in `tasksync-chat/src/tools.ts`, `src/extension.ts` and `src/webview/webviewProvider.ts`; caller-view `tasksync-chat/test-webex-ask-user.cjs` asserts once-only matching-question delivery and local reply cancellation; preserve the existing Telegram service (FR-008/FR-011/FR-018/FR-019; depends on T010, T017). Evidence (2026-10-10): `rtk node tasksync-chat/test-webex-ask-user.cjs` → `PASS EV-WEBEX-ASK-USER Away posts question in current turn thread; thread reply resolves matching ask exactly once; unrelated reply ignored`, plus Here/Offline no-send and local cancellation PASS. Provider calls shared postQuestion instead of legacy cards, task identity is checked, existing Webex polling consumes turn-root replies once, and `rtk npx tsc -p tasksync-chat --noEmit` → `TypeScript: No errors found`. Test uses fake API/auth, ASKAWAY_TEST_NO_KEYCHAIN=1 and per-case availability.

**Checkpoint**: All shared callers pass parity and existing Telegram regressions remain green. Personal-token final delivery is not claimed as device notification.

---

## Phase 5: User Story 3 - Deliver and receive reliably in workspace spaces (Priority: P1)

**Goal**: Correct destinations, reliable uploads/retries and genuine same-person replies.

**Independent Test**: Fake Webex API exercises missing/existing spaces, uploads, 429 delays, same-person own-post IDs, duplicate polls and reload without any public endpoint.

### Tests for User Story 3

- [x] T014 [P] [US3] Fake API replay `test-webex-remote-adapter.cjs` PASS EV-WEBEX-REMOTE-ADAPTER matched=6 (2026-10-12): routing/create/reuse/ambiguity, reload IDs, PDF bytes/error, bounded text, formatting fallback, automatic transient edit retry, POST/PUT/upload/poll Retry-After, fake credentials and forbidden listener. T006 same-basename identity remains separate.

### Implementation for User Story 3

- [x] T015 [US3] Resolve/create one space per workspace in team self and record its General space through `tasksync-chat/src/services/webexSpaces.ts`, retaining non-secret mappings in `.askaway/webex-spaces.json`. Verified 2026-10-08: `node tasksync-chat/test-webex-workspace-space.cjs` passes reuse, idempotent creation, folder-name title, General recording, global enabled setup and zero disabled requests; discovery, token-command, remote-channel-contract regressions and TypeScript noEmit pass. Sign-in runs setup; enabling resolves missing workspace metadata or offers sign-in; disabling stops polling. Broader US3 adapter verification remains T014/T016/T017.
- [x] T016 [US3] Add Webex text/edit/final and PDF/Markdown file operations with safe format fallback and 429 Retry-After in `tasksync-chat/src/services/webexService.ts`; caller-view `tasksync-chat/test-webex-remote-adapter.cjs` asserts upload bytes, no premature retry, pending edit recovery and no silent drop (FR-013/FR-014/FR-026; depends on T015).
- [x] T017 [US3] Poll replies with backoff and persisted posted/processed IDs in `tasksync-chat/src/services/webexService.ts`; caller-view `tasksync-chat/test-webex-reply-poll.cjs` asserts own-post exclusion by ID, genuine reviewer replies with the same person ID, re-poll/reload deduplication, turn cancellation and no inbound endpoint (FR-008/FR-021/FR-025; depends on T016). Verified 2026-10-08: localhost fake-server test passes space/thread polling, reload restoration, bounded ledger and post/reply backoff reset; remote-channel-contract and webex-token-command regressions pass, TypeScript noEmit passes. No live delivery claimed.

**Checkpoint**: US3 replay and upload/reply scenarios pass; no self-identity blanket filter or exposed laptop endpoint remains.

---

## Phase 6: User Story 4 - Receive shared documents in self.General (Priority: P1)

**Goal**: Verify the already-switched script live; do not repeat the migration.

**Independent Test**: Explicit live share delivers a harmless document to self.General and makes no Telegram calls.

### Tests for User Story 4

- [ ] T018 [P] [US4] Add caller-view `tasksync-chat/test-share-with-me-webex.cjs` with explicit live opt-in and sanitized evidence, covering the existing `~/.local/bin/share-with-me` default `SHARE_CHANNEL=webex`, successful document arrival and credential/upload failures without Telegram fallback (FR-023; test authoring after T005, disjoint from adapter files). 2026-10-20: still the SKIP stub; the live arrival test needs a fake credential boundary (FR-036) and a reviewer opt-in, so it stays open.

### Implementation for User Story 4

- [x] T019 [US4] Live-check the already switched `~/.local/bin/share-with-me` using `tasksync-chat/test-share-with-me-webex.cjs` and a harmless document; record self.General arrival in `specs/009-webex-remote-channel/evidence/share-with-me.md` without credentials. No script rewrite: default was switched 2026-10-08; fail or wait explicitly if delivery cannot be observed (depends on T018, T001/T002 and explicit live request).

**Checkpoint**: Observed live arrival, not just the default setting, proves US4; no Telegram delivery occurs.

---

## Phase 7: User Story 5 - Notify through incoming webhooks (Priority: P1)

**Goal**: Notify through per-space incoming webhooks: "And bots are not enabled in our org." (2026-10-08).

**Independent Test**: `test-webex-incoming-webhook.cjs` verifies setup, webhook text, OAuth files/fallback and replies. Live phone notification is separate evidence.

### Tests for User Story 5

- [x] T020 [US5] Replace the optional-bot design with manual incoming webhooks: "this integration is logged in with my credentials. So, if message is posted, i'll not get any notifications." and "And bots are not enabled in our org." (2026-10-08). No incoming creation API found; secure masked command opens AppHub and copies the space name. Guard: `test-webex-incoming-webhook.cjs`.

### Implementation for User Story 5

- [x] T021 [US5] Implement `webexIncomingWebhook.ts`, Configure Webex Notifications command, startup/space reminders and WebexService webhook text routing; files remain OAuth, sender posts are excluded and threaded answers resolve the latest handoff. Guard: `test-webex-incoming-webhook.cjs` fake-backed setup, General Keychain, routing and replies. Live device notification remains unverified (FR-028; R-TELE-29..31).

**Checkpoint**: Fake-backed incoming-webhook behavior verified; no bot provisioning. Live phone notification is not claimed.

---

## Phase 8: User Story 6 - Turn thread with webhook alerts (Priority: P1)

**Goal**: Webhook start/finish alerts, one editable token status in the turn thread and one final token message containing handoff text AND PDF together; cards are not pushed.

**Independent Test**: `tasksync-chat/test-webex-turn-thread.cjs` replays alert/root discovery, status edits, combined final and all reply locations; `tasksync-chat/test-webex-keychain-isolation.cjs` proves zero real Keychain access.

### Tests for User Story 6

Write caller-view tests first against fake webhook/token APIs and a controlled clock; the webhook returns no id and ignores parentId. No live credentials or Keychain access.

### Implementation for User Story 6

- [x] T031 [US6] Implement turn start webhook alert (thread root, prompt excerpt), root-id resolution by polling, one threaded token status edited for Commentary and two-minute shared metrics, one threaded token final with handoff markdown AND PDF together (Markdown fallback), then a top-level webhook finish alert carrying the Next question in `tasksync-chat/src/services/webexService.ts`, `src/commentary/telegramLive.ts`, `src/services/handoffNotifier.ts`, `src/extension.ts` and `src/webview/webviewProvider.ts`; accept replies in the turn thread, on the alert or top-level after it, once only with own-post/reload/cancellation safeguards. Webhooks only alert in his own spaces; token messages to other people, status and finals; no cards. Caller-view `tasksync-chat/test-webex-turn-thread.cjs` guards the whole lifecycle and failed delivery; delivers T010, which stays unticked until this evidence passes (FR-033..035; depends on T009/T017/T021).
- [x] T032 [US6] Isolate all Webex test credential reads/writes through fake SecretStorage/Keychain boundaries in `tasksync-chat/test-webex-*.cjs`; caller-view `tasksync-chat/test-webex-keychain-isolation.cjs` proves tests never touch the real Keychain. A test wrote `askaway-general` into the real Keychain on 2026-10-09; fix the shared test boundary, not just that value (FR-036; required before running credential-writing tests).

**Checkpoint**: Whole-turn replay and Keychain-isolation tests pass; no live phone notification claimed from fake evidence.

---

## Phase 9: User Story 7 - Command-style Webex tools (Priority: P2)

**Goal**: One safe `askaway_webex` LM + AskAway MCP tool and profiles that know when to use it.

**Independent Test**: `tasksync-chat/test-webex-tools.cjs` checks both public surfaces; `tasksync-chat/test-orchestrator-policy.cjs` checks Build/worker guidance.

### Tests for User Story 7

Write caller-view command tests first using fake APIs, bounded data and seeded fake secrets; assert no secrets in arguments, results or errors.

### Implementation for User Story 7

- [x] T033 [US7] Add one `askaway_webex` command-style LM + AskAway MCP tool through the shared boundary in `tasksync-chat/src/tools.ts`, `src/mcp/` and `tasksync-chat/package.json`: `spaces` lists teams/spaces, `read` reads recent messages in a space, `thread` reads a thread by message id, `search` finds text in a space, `send` uses the token for another person/space and the webhook for own-space alerts. Define shared validation/policy, enabled gating, bounded output with truncation/pagination, sanitized observability and no secrets in arguments/results/errors; caller-view `tasksync-chat/test-webex-tools.cjs` verifies both adapters (FR-037/038; depends on US1 and T031/T032). Evidence (2026-10-10): `rtk node tasksync-chat/test-webex-tools.cjs` PASS EV-WEBEX-TOOLS-ADAPTERS, full recipient/text modal while Here, draft otherwise; manifest check tools=3 and tsc clean. Existing own-space alerts remain on the webhook boundary; tool sends use approval-gated user-token requests. Full worker suite blocked by concurrent availabilityGate fixture changes outside this packet.
- [x] T034 [US7] Teach AskAway Build in `.github/agents/` and portable worker profiles in `tasksync-chat/` when to use `askaway_webex` for spaces/read/thread/search/send instead of raw secret-bearing calls, including bounded output and own-space webhook alerts versus token sends; caller-view `tasksync-chat/test-orchestrator-policy.cjs` guards the guidance (FR-038; depends on T033). Evidence (2026-10-10, scoped worker packet): `rtk node tasksync-chat/test-webex-prompt-graders.cjs` PASS EV-WEBEX-PROMPT-GRADERS; checked-in webex profile installed by sync, only Webex MCP allowed, 10 good drafts and named bad-draft rejections, LLM similarity skipped and no paid run. Build delegation guidance is in WORKERS_SETUP.md; updating `.github/agents/` and test-orchestrator-policy.cjs remains outside this packet's file scope.

**Checkpoint**: Both tool surfaces and Build/worker policy tests pass with bounded secret-free results.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Verify parity, secrecy and requirement coverage together.

- [ ] T022 Run all new caller-view tests and existing Telegram regressions, including `tasksync-chat/test-remote-channel-parity.cjs`, `test-webex-remote-adapter.cjs`, `test-goals-docs.cjs` and `test-spec-planning-contract.cjs`; record results and FR/SC coverage in `specs/009-webex-remote-channel/quickstart.md`. Zero matched tests or unobserved live delivery is not a pass; US5 remains explicitly deferred if undecided. 2026-10-20: gate exit 0 and results recorded in quickstart.md; stays open until live delivery is observed.
- [x] T023 [P] Cite passing caller-view parity in `tasksync-chat/docs/requirements/telegram.md`, preserving reviewer wording/links; `test-remote-channel-parity.cjs` PASS EV-REMOTE-CHANNEL-PARITY matched=2 and `test-goals-docs.cjs` PASS EV-GOALS-DOCS (2026-10-12). Live delivery and T006 identity remain separate.

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup T003/T004 can run in parallel on disjoint documents; Foundational T005 then T006 blocks further migration.
- T001/T002 already run in separate packets; verify their evidence, never infer completion. T007 waits for them and the contract.
- US2 and US3 tests are independent; shared adapter implementation is ordered T009 → T015 → T016 → T017. T011 waits for T016; T013 waits for T010/T017.
- US4 test authoring can proceed on disjoint files after the contract; live T019 waits for credentials/destinations and explicit permission.
- US5 is optional and blocked on the reviewer answer. Polish follows all desired P1 stories and reports US5 separately.

### User Story Dependencies

- US1 is independently verified with captured storage and discovery.
- US2 can replay its callers against contract adapters without a live Webex account; integrated parity needs US3.
- US3 is independently verified against a fake API with seeded credentials/spaces; live routing uses US1.
- US4 can run against the existing script once its token/destination is available; no UI or bot dependency.
- US5 depends on the shared path and reviewer bot approval, never blocks P1 delivery.

### Within Each User Story

- Write caller-view tests before behavior; fail first, then prove nonzero assertions pass.
- Build the shared contract before callers, destination before delivery, delivery before reply integration.
- Serialize tasks touching `webexService.ts`, `webexAuth.ts`, `extension.ts` or `webviewProvider.ts`.
- Tick only after named verification and required live evidence pass.

### Parallel Opportunities

- T003/T004: disjoint planning and coverage documents.
- T008/T014/T018: disjoint caller-view test files after their prerequisites.
- T012 can run beside handoff T011 on disjoint files after the shared channel exists; avoid T010's Commentary file.
- T023 documentation can run beside T022 verification after story evidence exists.

---

## Parallel Example: User Story 1

```text
Captured token-command tests (test-webex-token-command.cjs)
Captured discovery tests (test-webex-discover.cjs)
Test-only work is parallel; integration edits to webexAuth.ts/webexService.ts are serialized.
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete setup and the shared contracts; reconcile existing T001/T002 evidence.
2. Complete safe storage/discovery and stop to validate US1 independently.
3. Do not claim remote parity or notifications from authentication alone.

### Incremental Delivery

1. Add the shared US2 path and US3 adapter using fake API parity/reliability replays.
2. Validate all P1 remote capabilities, then live-check US4's already-switched script.
3. Deliver personal-token mode with its notification limit; add US5 only after approval and live notification evidence.

### Parallel Team Strategy

1. Split contract/coverage documents and independent test authoring.
2. Keep one owner at a time on shared service and extension integration files.
3. Join at each story's Independent Test and Checkpoint, preserving Telegram regressions.

---

## Notes

### Scoped test packet — 2026-10-12

Latest follow-up supersedes the first packet's dispositions; actual source paths are outside its allowed globs.
- T003 done: test-spec-planning-contract.cjs PASS EV-WEBEX-MIGRATION-PLAN callers=6 rules=5; migration plan/research authored.
- T004 done: test-goals-docs.cjs PASS EV-WEBEX-REQUIREMENTS-COVERAGE rows=44; unique FR/story/test-or-gap mappings.
- T006 blocker: distinct workspace paths with the same basename still resolve the same titled room; identity migration needs a compatibility decision before changing existing mappings.
- T008 done: provider snapshot now preserves canonical final metrics; full two-adapter replay passes; only final-notification method patched with CRLF preserved.
- T014 done: expanded fake-backed adapter test PASS matched=6; red transient-edit assertion preceded owning retry/content-bound fixes.
- T018 blocker: live opt-in absent; FR-036 also requires safe credential injection before external script arrival verification.
- T022 blocker: live opt-in absent; worker gate now fails outside scope at test-trace-tab-unification.cjs:71:29, `browser.ui.traceRowsHtml is not a function`.
- T023 done: passing full parity guard cited; reviewer wording preserved, independent identity/live gaps remain explicit.
- US5 live verification deferred per packet; confirmed webhook design and no-bots rule unchanged.
- Compiler evidence (latest): repository `tasksync-chat/node_modules/.bin/tsc -p tasksync-chat --noEmit` TSC_EXIT=0; both new suites and all five Telegram regressions exit 0.

Failure sensitivity: routing fails on wrong room; retry fails on wrong delay/plain body; upload fails on altered bytes/false success; reload fails on duplicate/missing same-person reply; secrecy fails on seeded credential leakage; parity fails on dropped fields or banner ordering. No mutation of src was used to manufacture a red/green result.

- Completion evidence supplied for this docs update: T016 — `tasksync-chat/test-remote-channel-contract.cjs` and `tasksync-chat/test-webex-one-item.cjs`; T019 — live share-with-me runs 2026-10-09 delivered a notifying message plus spec.pdf to AskAway General. Existing task row text is preserved except those two ticks.
- US6 supersedes earlier split-final/bot proposals: incoming webhooks accept only text/markdown, ignore parentId and return no id; token markdown + files share ONE message. US5 is confirmed, not an optional bot decision. T031 delivers T010; T032 guards all Webex tests; US7 follows the shared boundary. No inbound webhook/public laptop endpoint.

- This packet updates documentation only; T024–T028 close with the verified OAuth evidence in `quickstart.md`. Other task states are preserved; T007 remains open. Deployment and live browser authorization are pending.
- [P] denotes real disjoint work, not concurrent edits to the same adapter.
- Keep tokens, private OAuth values and credential files out of agent context and evidence.
- No webhook, public laptop endpoint, implicit Telegram fallback or unsolicited bot creation.
- [x] T035 [request] Implement scoped Webex act-like-me tool suite, pending approval hook, local attachment cache, own-message style sampling, profile/docs and caller-view tests; verify test-webex-tools-suite.cjs and tsc. Evidence: rtk node tasksync-chat/test-webex-tools-suite.cjs: PASS EV-WEBEX-TOOLS-SUITE; rtk npx tsc -p tasksync-chat --noEmit: TypeScript: No errors found. Eight worker MCP tools, approval hook, attachments, sampler/profile shipped. AITalk wiring and full worker gate not run.
