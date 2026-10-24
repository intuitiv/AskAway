# Scouting: active conversation and main-chat keep-alive (spec 011)

Scouting only. Nothing was built and nothing under tasksync-chat/ was edited. Date: 2026-10-24.
Installed VS Code: 1.142.0 (`/Applications/Visual Studio Code.app/Contents/Resources/app/package.json:3`).
Bundled Copilot Chat extension: 0.70.0 (`extensions/copilot/package.json`, version field).
Status words: VERIFIED = read in a file or typing; HYPOTHESIS = expected from names, needs a live probe before we trust it.

## 1. Which Copilot conversation is the reviewer looking at?

### 1.1 Candidate signals

| # | Signal | What it tells us | Latency | Stable or proposed | How it fails |
|---|---|---|---|---|---|
| S1 | `vscode.window.tabGroups.all[].tabs[]` with `tab.isActive`, `tab.label`, `tab.input`, and `onDidChangeTabs` | A chat opened as an editor tab is a tab; the active one in the active group is the focused one | Immediate (event) | Stable. `onDidChangeTabs` at `out/vscode-dts/vscode.d.ts:19430`. | `tab.input` is typed `unknown` for non-listed kinds. The typed inputs are Text, TextDiff, Custom, Webview, Notebook, NotebookDiff, Terminal (`vscode.d.ts:19168-19284`); there is no chat input class. HYPOTHESIS: a chat editor tab shows up with `label` = session title and an opaque `input`, so we can match it to a session by title only. Titles are not unique. Does not cover the sidebar chat view at all. |
| S2 | Workbench chat editor input | VS Code itself has `workbench.input.chatSession` and `workbench.editor.chatSession` with a `sessionResource` (`out/vs/workbench/workbench.desktop.main.js`, strings `TypeID="workbench.input.chatSession"` and `EditorID="workbench.editor.chatSession"`) | n/a | Internal. Not reachable from an extension. | We cannot read it. It only proves the editor exists. |
| S3 | Chat context keys: `chatSessionRequestInProgress`, `chatSessionHasActiveRequest`, `chatSessionType`, `chatSessionIsEmpty` (same bundle) | Whether the focused chat is busy, and its type. They describe the focused chat, but contain no session id | Immediate inside VS Code | Context keys are internal state. An extension can read one only through `when` clauses on its own contributed menus or keybindings, or `getContext`-style commands; no stable read API. | No id, so it cannot pick a conversation. Useful only as a "this chat is busy" gate. |
| S4 | Command `workbench.action.chat.open` with `{ query, isPartialQuery }` (used at `src/webview/webviewProvider.ts:4469`) | Acts on whichever chat is focused. Does not report which | n/a | Stable command | Writes into the wrong chat when the focus is elsewhere. See section 3. |
| S5 | Commands that open a specific session: `workbench.action.chat.openSessionInEditorGroup`, `openSessionInNewEditorGroup`, `openSessionInNewWindow`, `pickAgentSession` (command ids found in the workbench bundle) | The way to FOCUS a given session when we want "show me the AskAway tab for the chat I opened" in reverse (focus the chat for a tab) | Immediate | Command ids; argument shapes not verified. HYPOTHESIS: they take a session resource URI. | Argument shape unknown; a rename in a VS Code release breaks it silently. |
| S6 | Hook payload `session_id` on every hook (`src/extension.ts:256`, `src/hooks/subagentTimerScript.ts:19`) | The session that just did something: UserPromptSubmit, PostToolUse, Stop | Only at activity | Stable (hooks are configured by AskAway, `src/hooks/copilotHooks.ts:75-82`) | No hook fires on a tab switch, so a focus change alone is invisible. A quiet conversation never reports. The first signal after a switch is the next prompt the reviewer sends. |
| S7 | Chat session store index in the workspace `state.vscdb`, key `chat.ChatSessionStore.index` (read with sqlite3 on this workspace's DB) | Every session: `sessionId`, `title`, `lastMessageDate`, `timing.lastRequestStarted/Ended`, `initialLocation` ("panel"), `isEmpty`, `lastResponseState` | Written lazily; stale by seconds to minutes | An internal file format, not an API. VERIFIED present; format can change. | No "active" field. Useful to know which sessions exist, their titles and recency. |
| S8 | `memento/workbench.editor.chatSession` in the same DB: `chatEditorViewState` list of `vscode-chat-session://local/<base64 sessionId>` with scrollTop | Which sessions have an open chat editor (the base64 decodes to the session id) | Written on shutdown or editor close; stale | Internal | VERIFIED shape. Lists open editors, not which is focused, and lags. |
| S9 | Chat session files `workspaceStorage/<ws>/chatSessions/<sessionId>.jsonl` (VERIFIED: 44 and 48 files in the two TaskSync storage folders; first line `kind:0` carries `sessionId`, `initialLocation: "panel"`, `inputState` with `mode`, `selectedModel`, `inputText`) | The session's mode, model and the unsent input text | Updated as the chat changes (file mtime) | Internal file format | Many files are old; `inputText` lets us see whether a draft exists (needed for the ping hazard). Not a focus signal. File can be MBs (7.4 MB seen). |
| S10 | Copilot Chat's own registry: `onDidChangeChatSessionItems` / `ChatSessionItem` / `chatSessionsProvider` (proposal listed in `extensions/copilot/package.json` `enabledApiProposals`: `chatSessionsProvider`, `chatSessionCustomizationProvider`, `chatDebug`, `chatHooks`) | Session lists for providers that contribute sessions (copilotcli, cloud agent) | Event driven | PROPOSED APIs. A Marketplace extension cannot enable proposals, so not usable. | Not available to us. Also describes CLI and cloud sessions, not the local panel chat. |
| S11 | Copilot's SDK files: `~/.copilot/session-state/<session>/events.jsonl` (`src/observability/copilotSdkLog.ts:6`) and `GitHub.copilot-chat/debug-logs/<session>/main.jsonl` | Per-session request starts and token usage (AskAway already reads them: `src/extension.ts:1033-1037`) | Seconds | Internal files, already relied on | Activity only; says nothing about focus. |

### 1.2 Reading of the evidence

- There is no stable way to read "which chat has focus". Focus is internal; the only stable focus-like API is `tabGroups`, and it covers chats opened as editor tabs only, with no session id on the tab (VERIFIED: no chat TabInput class in `vscode.d.ts`).
- Activity is knowable: every hook and every log line carries the session id. The honest definition that works everywhere is "the active conversation is the one that last had activity" (last UserPromptSubmit, PostToolUse or request start).
- Combined heuristic (HYPOTHESIS, needs a live probe): last activity wins by default; when a chat editor tab is active (S1), prefer a session whose title equals the tab label (S7 gives titles); a separate window is a separate extension host with its own workspace, so the window gives the workspace and the same rules then apply inside it.
- Latency after a pure tab switch is "until the next activity". The reviewer said "if i open any vscode copilot conversation, i want that corresponding askaway tab shown". Without activity, only the S1 plus title match can do that, and only for chat editor tabs.

### 1.3 Probe to run before building (not run, needs the live window)

1. Register `onDidChangeTabs`, log `tab.label`, `typeof tab.input`, `tab.input?.constructor?.name`, `tab.input?.viewType` for a chat editor tab and a side bar chat. Confirms S1 and what a chat tab looks like.
2. Open two chats; switch; log which hooks fire (expected: none, S6).
3. Check whether `workbench.action.chat.openSessionInEditorGroup` accepts a session id (S5).

## 2. What is per workspace today and what is per conversation

Conversation key candidate: workspace root plus hook `session_id`. The Validator already uses exactly this (`src/validator/stackCapture.ts:10`, `stackKey = workspaceRoot::sessionId`; stacks stored under `~/.askaway/validator-stacks`, `src/extension.ts:1155`, hashed in `src/validator/conversationStack.ts:21`).

| Data | Where it lives | Key today | Changing the key to workspace + session touches |
|---|---|---|---|
| AITalk room (messages, presence, typing) | `<workspace>/.askaway/aitalk/messages.jsonl`, `presence.jsonl`, `typing.jsonl` (`src/aitalk/store.ts:21-23`) | Workspace only | `src/aitalk/store.ts` (file path per conversation), room and delivery (`src/aitalk/delivery.ts`), the AITalk webview provider message plumbing, clear chat, Webex/Telegram routing that posts to the room. Largest change. |
| AITalk delivery spool | `~/.askaway/aitalk-spool/<ws-slug>` (`src/hooks/aitalkSpool.ts:13`); read by the PostToolUse hook (`src/hooks/subagentTimerScript.ts:31`) | Workspace slug | `aitalkSpool.ts`, `subagentTimerScript.ts` (hook knows `sid`, line 19), `delivery.ts` writers. |
| Main-turn record `mainTurns` | `~/.askaway/subagent-inflight.json` (`src/hooks/subagentTimerScript.ts:6,23-24`) | Session id already (`mainTurns[sid] = { startedAt, workspace }`) | Nothing for the key. `delivery.ts:12-18` ignores the session and asks "any turn in this workspace?"; that reader would take a session. |
| Cache clock | `~/.askaway/cache-clock.json` `sessions[sid]` (`src/observability/cacheClock.ts:16-28`) | Session id already; BUT `lastRequestStart` (line 15, 34-36) and the sentinel `~/.askaway/cache-activity-ts` (`src/extension.ts:252`, read at `src/webview/webviewProvider.ts:2613-2620`) are one value for every window and session | The Metrics cache timer in `webviewProvider.ts` (read the per-session map instead), the budget hook that waits (`cacheSafeWaitMs`). The injected script `CACHE_TIMER_INJECT_SCRIPT` (`extension.ts:228-263`) writes one global file. |
| Reminder progress clock | `~/.askaway/commentary/<key>.progress.json` (`src/hooks/subagentTimerScript.ts:33`; written by `src/commentary/commentary.ts:199`) | Workspace key | `commentary.ts`, the hook script (it has `sid`), `src/aitalk/...` status nudge consumers. |
| Validator conversation stack | `~/.askaway/validator-stacks/<sha256(key)>` | Workspace + session (ADR 0038) | Nothing. It is the model for the others. |
| Trace and turn metrics | Copilot logs per session on disk (`debug-logs/<session>/main.jsonl`, `src/observability/copilotSdkLog.ts:6`), but AskAway aggregates per workspace (`webviewProvider.ts:3470-3475`, `getTurnMetricsSnapshot` at line 1764) | Sessions exist on disk; the view merges them per workspace | `webviewProvider.ts` metrics collection and the Trace render input (filter by session). Reuse the shared trace render block (Consistent Experience). Not fully verified how turn totals are keyed. |
| Team and Workers state | Worker router and workers state per workspace (`src/workers/workerRouter.ts:363` `adopt(... sessionKey)` carries an optional session key; `src/workers/workersState.ts`) | Workspace; workers are not tied to a Copilot conversation | HYPOTHESIS: workers belong to the workspace and are shared across conversations. A per-conversation Team view would filter members by "dispatched from session X". Needs a field at dispatch. |
| Handoff and cost banner | `src/services/handoffNotifier.ts` (turn-end), Stop stamp (`extension.ts:253-263`) | The Stop stamp already carries `sessionId`, `cwd`, `transcriptPath` | Notifier already ignores other windows' stops (comment `extension.ts:254-255`). |

Context size per conversation: workers have `contextTokens` (`workerRouter.ts:102`). For the main chat, `webviewProvider.ts:1764` `getTurnMetricsSnapshot` returns `latestInputTokens`; the 300K handoff warning is `src/specs/handoffThreshold.ts:17`. HYPOTHESIS: `latestInputTokens` is the last request's input, a good proxy for the 200K gate; to be verified per session.

## 3. The Ping button

### 3.1 How it works today
- UI: `media/webview.js:427` builds `obs-cache-ping-btn` ("Keep-warm ping"); the click handler at `media/webview.js:1752-1758` posts `{ type: 'pingCache' }`. Message type declared at `src/webview/webviewProvider.ts:548`, routed at line 4027.
- Handler `_handlePingCache` (`webviewProvider.ts:4466-4477`): runs `workbench.action.chat.open` with `{ query: 'keepalive; reply: ok', isPartialQuery: true }` then `workbench.action.chat.submit`. The code comment (4460-4465) says this submits in the CURRENT chat so the agent and system prompt are identical and the cache is hit.
- It takes no session id. It acts on whatever chat VS Code focuses.

### 3.2 Hazards if it ran automatically
| Hazard | Evidence | Effect |
|---|---|---|
| Draft overwritten | `isPartialQuery: true` fills the input (`webviewProvider.ts:4469`); the chat input text is stored in the session (`inputState.inputText`, S9) | An unsent draft is replaced and then submitted. Data loss, and a wrong message sent. |
| Wrong conversation | Handler has no session parameter (4466) | With several chats, the ping goes to the focused one, which may not be the one that is cooling. |
| Turn running | Context key `chatSessionRequestInProgress` exists (S3), but the handler does not check it | A ping queued behind a running turn is wasted or interrupts. AskAway knows turns from hooks: `mainTurns[sid]` (`subagentTimerScript.ts:23-24`). |
| Sub-agent running | `subagent-inflight.json` `pending` (`extension.ts:249`); a sub-agent has its own cache | Pinging the parent while a child runs does not warm the child; the parent clock is deliberately not reset by child calls (`extension.ts:232-236`). |
| Multiple windows | The cache sentinel is one file for all windows (`extension.ts:252-256`) | Window A would ping because window B was active. Needs the per-session map (cacheClock) and a window/workspace check against `cwd` in the stamp. |
| Cost of a useless ping | see 3.4 | The reviewer wants no keep-alive for finished conversations. |
| Agent answers, not just cache | The ping is a real chat turn with a real reply | It adds a turn, a Stop event, an AITalk "Next" message and a handoff post unless AskAway recognises and suppresses its own ping text. |

### 3.3 "Handoff done" signals for a session
| Signal | Evidence | Reliability |
|---|---|---|
| The `/sk.handoff` prompt was sent | Prompt asset `src/specs/specKitPromptAssets.ts:133-138`; Claude stage list includes `handoff` (`src/observability/claudeSpecAttribution.ts:4,67`) | Good for "reviewer asked for it": the UserPromptSubmit payload has the text. Hook already forwards the user text to the stack capture spool (`stackCapture.ts:54-68`). |
| A Response Handoff in the final response | `extractHandoff` and `## Response Handoff` (`src/services/handoffNotifier.ts:333,365,422-424`); Stop payload carries `last_assistant_message` (`extension.ts:260-262`) | Present on every turn by the agent rules, so it is NOT a "session finished" signal. The handoff text is the end of every turn. |
| Context over 300K | `src/specs/handoffThreshold.ts:17` says "run /sk.handoff now, then continue in a new conversation" | A hint that the session is about to be abandoned. |
| Handoff file under specs/ | HYPOTHESIS: `/sk.handoff` may write a file; the prompt asset was not read in full. | To verify. |
| Reviewer says so | Reviewer verbatim: "i need a way to say that that session is not needed for keep alive" | Only fully reliable signal. |

Conclusion: none of the automatic signals reliably says "this session is done". A manual per-conversation switch is needed; `/sk.handoff` being sent is a good default trigger to turn it off.

### 3.4 Cost of one ping, with the repo's own numbers
- Rates in the repo (`src/observability/claudeSpecAttribution.ts:177-183`): cache read = 0.1 x input rate; cache write 5-minute = 1.25 x input rate; 1-hour write = 2 x input rate; plain input = 1 x.
- Example for a 150K context at input rate R per million tokens: a ping that hits the cache costs 150,000 x 0.1 x R = 15,000 R-tokens-equivalent, about 0.1 x the full prompt. A cold request after expiry rewrites the cache at 1.25 x: 187,500. So a hit is about 8 times cheaper than a miss (0.1 vs 1.25).
- Six pings keep a session warm for about 6 x 5 min = 30 min (cache TTL 300 s: `src/observability/cacheClock.ts:9`) at 0.6 x the full prompt, versus one miss at 1.25 x. So keeping alive saves money only if the reviewer returns within about 30 minutes and does so more than once-in-two-windows; otherwise six pings cost half a miss for nothing. This is the reviewer's point "unnecessary cost".
- Numbers are ratios from the repo's rate table; model-specific dollar rates were not looked up (`modelRates` in the same file). The Copilot TTL is "unpublished" per `specs/BACKLOG.md:142` (N12-5) and extended cache needs native settings (`media/webview.js:427` tooltip).
- The worker rule is already 4 pings per worker (ADR 0005, `docs/adr/0005-keep-warm-workers-alive.md:13`; R-WTOOL-28). The reviewer asks for 6 for the main session (`specs/BACKLOG.md:183` M23-03, still NEEDS-DECISION: main chat or workers; 4 per worker and 300K in ADR 0005).

## 4. Relevant prior decisions (read, not changed)
- Validator conversation stack per workspace + session: ADR 0038 and `stackCapture.ts:10`.
- AITalk presence: reviewer and Priya always in the room; main agent joins at turn start and leaves at turn end (spec 010 lines 8-12, ADR 0036). Per-conversation rooms must keep this per room.
- Consistent Experience (AGENTS.md, G16): the same Trace, Team and AITalk blocks must be fed per-conversation data, not forked.
- Backlog rows: M23-03 (`specs/BACKLOG.md:183`), M24-02 (line 208), GOALS.md section end (line 1033-1035).

## 5. Gaps still open after scouting
- No live probe of tab inputs for chats (1.3). Everything about S1 matching is a hypothesis.
- No check of what `/sk.handoff` writes to disk.
- `getTurnMetricsSnapshot` per-session keying not read in full.
- Dollar rates per model not computed; only ratios.
