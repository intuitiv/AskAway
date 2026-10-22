# Changelog

All notable changes to this project will be documented in this file.

## AskAway v2.3.4 (10-21-26)

- **Webex replies after the turn:** a reply to the turn-end handoff was ignored once the turn had been idle for about five minutes; it now reaches the conversation until the handoff expires (36 hours) or a new turn starts. The finish alert says "Reply to this message to continue."
- **Webex daily report:** ask Cathy's `inbox` tool with `mode: digest` for what needs you across every space you are in, not just what AskAway sent: mentions, replies to threads you sent and unanswered direct messages. One Webex sync fills an in-memory index shared by all workspaces (nothing is written to disk); quiet spaces (nothing posted by you and no mention for six months) and spaces on your mute list `~/.askaway/webex-mute.json` are skipped and counted in one line, but a mention or a reply to you always shows. It is read-only; there is no push reply alert yet.
- **Worker packets are scoped:** the `worker` tool refuses a file-changing profile with no `allowedFiles` and refuses packets whose files overlap a running write worker.
- **One readiness text everywhere:** the Specs tab card, the Telegram status and the `/pr-daily` facts show the same readiness lines; a pass without evidence reads BLOCKED on all three.

- **Cathy's Webex tools, by name:** twelve Webex tools (inbox, find, read, search, wait, meetings, send, reply, edit message, delete message, edit draft, style card) take space and person names, never ids; send, reply, edit and delete wait for your 👍 on one approval card in AITalk (provider, action, name, thread, full text, files), and the same card is ready for an Outlook provider. Room ids no longer appear in cards, the status file, logs or Settings text (R-CATHY-01 to R-CATHY-07).
- Renamed the communication tool to `aitalk`: use `say` for room messages and `post` for feed lines; old action and worker policy entries remain compatible.
- **agy and Claude workers behave like OpenCode workers:** they are identified by carriers the model cannot set (agy's MCP conversation id, a per-run `X-AskAway-Run` header for Claude, kept in a private temp file), so queued AITalk messages reach them on their next tool call and members' questions are attributed to them (R-AITALK-46, R-AITALK-47). Verified live with real agy and Claude runs.
- **Workers can ask questions:** `commentary` is granted to member profiles (and to agy and Claude when a profile lists it); the `worker` tool is granted only when a profile lists it and a worker may start only read-only children, at most 2, one level deep, its own only (R-WTOOL-45, R-WTOOL-46).
- **Claude fork and terminal viewers:** a warm Claude worker can be forked for fan-out (`--resume --fork-session`, R-WTOOL-48); agy and Claude cards get an Open in terminal button (R-WTOOL-47). agy still cannot fork (no CLI flag) and reports no cost.
- **Chat and Autopilot are gone for good:** the Chat tab and `ask_user` were already retired; the leftover Autopilot prompts, response-timeout and human-like-delay settings and the pending-request queue are removed too. Remote Webex and Telegram questions, the plan editor and worker Autopilot stay (R-LIVE-27).
- **Members post only questions in AITalk:** only the main agent posts progress updates; a worker or member posts a question, tagged to the main agent, the Validator or the room, and reports progress in its final report (R-AITALK-45).
- **agy members:** still $0.00, and now shown on Team while they work this turn even without Show all (R-TEAM-72).
- **Compact Team cards:** the Team tab shows one compact card per member, with no layout switch: an accent colour, runtime-coloured model chip and thinking chip, a share bar of the turn, a pulsing dot while working, and a status line that rotates every 8 seconds. Order is Priya, the main agent, then members by Turn descending (R-TEAM-58 to R-TEAM-61).
- **One Edit button per card:** a pencil opens one inline panel with name, role, picture, Model, Thinking, Agent file and Reset model to default; no chevron and no menu (R-TEAM-66).
- **Month under Turn:** every card shows Turn with a muted Month line beneath; agy members show $0.00 for both (R-TEAM-65).
- **Show all members** toggle in the Team header (off after every reload) adds the members with no spend this turn so they can be edited; the OpenCode, agy and Claude health chips sit under the turn summary (R-TEAM-62, R-TEAM-64).
- **Face portraits:** member cards show the realistic face images shipped in `media/team/avatars/<memberId>.png`, and the initials when there is none (R-TEAM-68).
- **Availability is seeded globally:** if the global file is missing, the newest per-workspace file of an earlier version seeds it once (R-TEAM-67).

## AskAway v2.3.3 (10-21-26)
- **Team shows who spent:** Priya and the main agent always, every other member only with Turn spend above zero ($0 members, agy included, are hidden). Worker Turn cost is the measured spend since the turn started, no longer $0 (R-TEAM-51, R-TEAM-52).
- **Team header row removed:** Show completed, archive and reload are gone with their code (R-TEAM-50).
- **One model choice for every workspace:** a member's model and thinking are saved in `~/.askaway/team/members.json`, shown in every workspace and used by that member's workers (R-TEAM-53). Model and Thinking are separate dropdowns: each OpenCode, agy and Claude model is listed once with its thinking stripped, and agy models keep their effort in the saved name (R-TEAM-54).
- **Manual sign-in:** a signed-out agy or Claude shows "Sign in required" in Settings with a Sign in button (R-TEAM-55).
- **One state for every workspace:** availability is a single file (`~/.askaway/availability/global.json`) and the Settings toggles are written at user scope (R-TEAM-57).
- **Profiles:** `build` and Anika run Sonnet or agy Argon, never Opus; the Developer, Test and Performance profiles get the Grafana MCP tools (R-TEAM-56).

## AskAway v2.3.2 (10-20-26)
- **Claude is a worker runtime:** `runtime: claude` or a `claude/<model>` id starts a headless `claude -p` worker that stays warm across submits, reports its real dollar cost and is gated by its Settings switch like agy (R-WTOOL-43).
- **Models are discovered and stored:** at startup, every morning and on Refresh each enabled integration (OpenCode, agy, Claude) lists its models; they are kept in `~/.askaway/runtime-models.json` (a failed or signed-out check keeps the last good list) and fill the Team model dropdowns (R-WTOOL-44).
- **AITalk asks wait for an answer:** a heads-up the agent asks in AITalk waits up to 45 seconds for a reply, then the agent carries on and the answer arrives with its next tool call, once; the Validator answers through the same path at once. Participants are now concrete actors (Validator, main agent, user, worker) behind one interface (R-AITALK-34, R-AITALK-35).
- **Clear chat** button in the AITalk header (R-AITALK-33).
- **Priya has an agent file**, `~/.askaway/validator/validator.md`, created on the first click of her Agent file link; editing it changes the validator's prompt, model and thinking (R-TEAM-49).
- **Team scrollbar:** the live refresh no longer strips the list's scroll class (R-TEAM-39). The agent now leaves the AITalk room at every turn end (R-AITALK-32).

## AskAway v2.3.1 (10-20-26)
- **Team scrollbar, for real:** the live refresh of the Team list stripped the class that makes it scroll, so the 2.3.0 scrollbar styling never applied. The list keeps its class on every refresh, and a test guards it (R-TEAM-39).
- **Agent "left" notices in AITalk:** the main agent now leaves the room at every turn end. Before, it left only when the final answer's Response Handoff was found, so "left" often never appeared (R-AITALK-32).

## AskAway v2.3.0 (10-17-26)
- **Works with VS Code 1.140+ (the Copilot harness) and keeps working on older versions.** Hooks, `/sk.*` commands, Trace and credits, agy workers and the Team tab were checked against the new harness; details in the entries below and ADR 0026.
- **`/sk.handoff` now captures everything the next conversation needs:** where we are, done with evidence, assumptions, decisions and rules in force, learnings, observations, what is not finished, and what to pick up next (R-SKFLOW-26).
- **Team scrollbar:** the Team list now shows an always-visible scrollbar (macOS hides overlay scrollbars until you scroll), and the Storybook Team story scrolls instead of clipping (R-TEAM-39).
- **agy workers:** the approval wrapper's own audit step is no longer reported as an out-of-policy tool call.
- **README GIFs from the real UI, with Team names:** the AITalk room (Bhaskar, Priya, Anika, Diego) and the Team tab (tasks starting and finishing under their owners, scrolling list); `node storybook/tools/capture-gifs.cjs` regenerates them. The old Workers-tab clip and screenshots are gone, since workers live in Team. Team cards now share one layout: Agent file and Edit are matching chips on the same row, the tasks pill sits in the corner, and the model select no longer overflows.
- **Smaller package:** test output and screenshots no longer ship in the `.vsix` (test output had grown to about 33,000 files).
- **Hooks and /sk.* work in the VS Code 1.140+ Copilot harness (2026-10-17):** that harness runs `~/.copilot/hooks` inside the session sandbox, where AskAway's scripts failed with exit 126 and the fail-closed `preToolUse` hook denied every tool call. Every AskAway hook command now exits 0 when its script cannot start, and the extension grants the sandbox the AskAway paths its hooks use (`chat.agent.sandbox.fileSystem.userConfiguredPaths`). `/sk.*` now ship through the extension's `chatPromptFiles` and `chatSkills` contributions (Local: `/sk.plan`; Copilot harness: `/sk-plan`, skill names cannot contain dots) plus Claude commands, and the old copies in `~/.copilot/skills` are removed; the conversation hooks now ship in the package. See ADR 0026.
- **Trace, credits, turn budget and handoff work in the Copilot harness (2026-10-17):** that harness writes `~/.copilot/session-state/*/events.jsonl` instead of `debug-logs/main.jsonl`, so Trace was empty. The extension now converts this workspace's sessions into the main.jsonl format every reader already uses, appending as they grow (R-TRACE-06).
- **Team, Integrations and profiles (2026-10-16, deployed locally):** Edit opens the member's profile form (name, role, status line, picture) instead of the prompt; Settings → Integrations shows OpenCode, agy and Claude with one switch, one Refresh and a last-checked time each; agy ships on again; Turn cost comes from the same records `turn_budget` counts; the worker tool's `profiles` action lists the enabled profiles; Build splits into `build` (Opus) and `build-lite` (Sol); join/leave notices no longer stretch your photo; main-agent commentary reaches AITalk even when the room refuses a line.
- **Configured, not released (2026-10-15):** eight user-level worker profiles and the repo Webex profile now default to Argon High with high thinking instead of Sol 6.1 where previously defaulted; `test-worker-profile-refresh.cjs` covers parsing and preserving existing workers. A live Argon High task and deployment remain unverified. The CPO photo helper uses the external `~/.askaway/profile/avatar.png` by default with explicit override and initials fallback; `test-aitalk-user-name.cjs` covers two workspaces. Team UI integration and Storybook approval remain pending.
- **agy completion authorized (2026-10-15), still in progress:** US1 T015–T019 track MCP, shell/permissions, reload independent of OpenCode, token accounting and final gate/deploy. Adapter fake-CLI tests/live scoped edit/compile/build/worker-suite success are reported prior evidence only. Optional agy runtime is selectable for any profile; the later Argon High policy/default entry above supersedes the earlier Medium preview target. Monetary cost is unreported, not 0/free. No deployment completion or shipped Team UI claimed; final evidence closure follows runtime verification.
- **Planning only (2026-10-15):** recorded Team member/profile/task decisions in spec 010. agy alternate-runtime implementation is in progress, not verified here; Argon is a model choice, not a persona. Runtime proof precedes Team Storybook work; approval precedes production Team UI. Team has not shipped.
- **README and Marketplace page rewritten for the current product.** Both READMEs now lead with the new motto: spec-based development, OpenCode workers to delegate tasks, the AITalk room, Telegram and Webex integration, plus keep-alive pings, timers and tracing. The old `ask_user`-first and Commentary-tab wording is gone; the extension description and keywords match.

## AskAway v2.2.0 (09-29-26)
- **Workers & Commentary are now documented.** These two side-panel tabs (async OpenCode-backed background agents, and a live plain-language narration feed) have been present since v2.1.0 but were never explained anywhere. Added a full [Workers & Commentary setup guide](tasksync-chat/docs/WORKERS_SETUP.md) covering installing OpenCode, authenticating a provider, writing a worker profile, and the optional VS Code tool bridge.
- Both READMEs now call out Workers/Commentary explicitly as advanced/optional, so a fresh install isn't left guessing what those always-visible tabs are for.

## AskAway v2.1.0 (07-12-26)
- **New: Cowork Offload (`/export-to-cowork`).** Offload heavy brainstorming to a free external model without spending Copilot credits on the export. The command enumerates relevant files by search only (never reading full contents) and writes `.askaway/cowork-manifest.json`; `bundle.mjs` expands it into a single upload-ready bundle; `apply.mjs` validates and `git apply`s the patch that comes back.
- Installed automatically at user level on activation, so it works in every workspace: the command goes to the VS Code User prompts folder and the scripts to `~/.askaway/cowork/`. User edits are preserved.

## AskAway v2.0.0 (07-07-26)
- **Major version.** Focus shifts to Copilot AI credit observability and cost optimization.
- **New: Disable Auto Compaction toggle** (Settings → Optimization). When enabled, VS Code Copilot will not auto-compact (summarize) agent conversation history once the context window fills. Toggles `github.copilot.chat.summarizeAgentConversationHistory.enabled` (off when checked).
- Metrics dashboard (This Turn / This Month), per-model and per-tool observability, RTK savings, and the `gradle`, `code_nav`, and `turn_budget` optimization tools.

## TaskSync v2.0.14 (02-07-26)
- refactor: rename Auto Answer to Autopilot, improve UI and settings
- - Rename all autoAnswer references to autopilot across codebase
-   (package.json, webviewProvider.ts, webview.js, CHANGELOG, READMEs)
- - Add backward-compatible settings migration from old keys
-   (tasksync.autoAnswer  tasksync.autopilot, tasksync.autoAnswerText  tasksync.autopilotText)
- - Move Autopilot toggle beside the send button in the action bar
- - Remove redundant autopilot-bar row to eliminate unnecessary spacing
- - Update welcome section info tip with clearer Autopilot description
- - Replace toggle switch in Settings modal with Edit button for Autopilot prompt
-   (on/off control remains solely in the action bar toggle)


## TaskSync v2.0.13 
- **Autopilot Mode** (renamed from Auto Answer): Automatically respond to `ask_user` prompts with configurable text for hands-free agent operation
- Autopilot toggle below the send button for quick access
- Customizable Autopilot response text via settings (`tasksync.autopilot`, `tasksync.autopilotText`)
- Queue priority: queued prompts are ALWAYS sent before Autopilot triggers
- Show tool call name preview in chat (truncated to 40 chars)
- Fix queue state reporting to accurately reflect whether response came from queue
- Fix stale settings overwriting user input for Autopilot text
- Fix redundant settings load in settings modal

## TaskSync v2.0.12 (01-06-26)
- Modified card rendering to add 'expanded' class only to the latest tool call
- Older tool call cards are now collapsed by default

## TaskSync v2.0.11 (12-24-25)
- Add context references (#terminal, #problems) for attaching terminal output and workspace diagnostics
- Integrate context items into file autocomplete dropdown
- Display attachments in tool call history cards
- Add ReDoS protection for markdown table parsing (prevent regex backtracking attacks)
- Fix memory leaks: proper cancellation cleanup, stale terminal execution tracking
- Add input length validation (500KB max for questions, 100KB for queue prompts)
- Use async file I/O for MCP client registration (non-blocking activation)
- Extract context providers into dedicated modules (ContextManager, TerminalContext, ProblemsContext)
- Consolidate duplicate CSS rules for code blocks and markdown
- Remove unused CSS (.welcome-tips, duplicate inline-code styles)
- Clean up JavaScript: remove unused variables, improve accessibility (ARIA labels)
- Fix race conditions in queue handling and request superseding
- Prevent orphaned promises when multiple ask_user calls occur
- Fix temp image cleanup timing (now cleaned on session clear/dispose)
- Improve webview ready state handling to prevent message race conditions
- Better error handling with proper cancellation support
- Cache context items dynamically (don't cache with file results)
- Debounced history saves (2s) for better disk I/O performance
- Process markdown tables line-by-line to avoid ReDoS vulnerability

## TaskSync v2.0.10 (12-24-25)
- feat: v2.1.0 - Settings Modal, Reusable Prompts, Notification Sound & Codebase Cleanup
- New Features:
- - Add in-sidebar Settings Modal with gear icon in title bar
- - Reusable Prompts with /slash command support and autocomplete
- - Clear Current Session command with trash icon and confirmation
- - Interactive Approval UI improvements with toggle setting
- - Notification sound for incoming tool calls
- Codebase Cleanup & Refactoring:
- - Extract shared utilities (fileExclusions.ts, imageUtils.ts)
- - Remove 5 unused SVG files from media folder
- - Clean up logging (remove console.log/warn, keep console.error)
- - Eliminate duplicate code and outdated comments
- - Update dependencies and clean up package.json



## TaskSync v2.0.9 (12-21-25)
- fix(workflow): properly handle multi-line commit messages in release notes
- - Use heredoc syntax (EOF delimiter) for multi-line GitHub Actions output
- - Removes URL encoding (%0A) that was appearing in release descriptions
- - Properly formats each line of commit message in CHANGELOG



## TaskSync v2.0.8 (12-21-25)
- fix(sidebar): resolve race condition preventing AI questions from displaying in the TaskSync sidebar when using ask_user tool; auto-opens sidebar, adds polling for view and webview readiness, and improves error handling


## TaskSync v2.0.6 (12-21-25)
- Merge branch 'main' of https://github.com/4regab/TaskSync


## TaskSync v2.0.5 (12-21-25)
- fix: update auto-release workflow to trigger on changes to the workflow file


## TaskSync Chat Extension v2.0.0 (12-17-25)
- New VS Code sidebar extension with dedicated UI (`tasksync-chat/` folder)
- Smart Queue Mode: batch responses for AI agents automatically
- Normal Mode: direct interaction with tool calls
- File/folder references with `#` autocomplete
- Image paste and drag-drop support
- Built-in MCP server with SSE transport (auto-registers with Kiro/Cursor)
- Tool call history with session tracking
- Performance optimizations: O(1) lookups, file search caching, async disk I/O

## TaskSync Prompt v5.2
- Added `readline` import for better terminal input handling (arrow keys, history)
- Added reminder message after input: "Once done, ensure to follow ./tasksync.md file and ask for input again"
- Uses `python3` instead of `python` for better cross-platform compatibility

## TaskSync Prompt v5.1
- Changed from `input()` to `sys.stdin.read()` for better multi-line input support
- Added "Enter Task:" prompt before input
- Improved cross-platform terminal compatibility

## TaskSync Prompt v5.0
- Simplified terminal command: `python -c "task = input('')"`
- 20 PRIMARY DIRECTIVES for absolute protocol compliance
- Emergency anti-termination protocols
- Task continuation priority system
- Urgent override handling

## Version 4.0 (08-12-25)
- Terminal-based autonomous agent protocol: AI becomes persistent terminal application using PowerShell Read-Host commands
- PRIMARY DIRECTIVE system: Eight critical behavioral rules ensuring absolute protocol compliance
- Zero file dependencies: Eliminates file monitoring overhead for direct terminal communication
- Enhanced session management: Improved task continuation priority and manual termination controls
- Cross-platform PowerShell compatibility and full backward support for TaskSync v3

## Version 3.0 (07-23-25)
- TaskSync Monitor UI: Web-based interface with real-time monitoring
- Improved TaskSync protocol prompt for better agent persistence and reliability and better file reference handling.
- Added Kiro IDE steerings file

## Version 2.0 (07-15-25)
- PowerShell word count monitoring system for efficient file change detection
- Protocol standardization: identical files, IDE-specific paths, and template system
- Fixed timing (180s/30s), mandatory Start-Sleep for monitoring, and never end session enforcement
- Multi-session log support: auto session creation, session numbering, and clear separation in log.txt
- Enhanced enforcement: session termination prevention, urgent override detection, and task continuation priority
- Improved documentation: configuration, usage, protocol, and changelog updates

## Version 1.0 (07-14-25)
- Initial release with infinite monitoring and basic file/task execution
- Dual file system: separate tasks.txt for instructions and log.txt for monitoring history
- Status logging: count-based monitoring, structured log format, and session tracking
- Manual termination only: agent never ends session automatically, explicit keywords required
- Robust error handling, improved user experience, and comprehensive documentation
