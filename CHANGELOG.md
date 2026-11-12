# Changelog

All notable changes to this project will be documented in this file.

## AskAway v2.3.17 (10-27-26)

- **Choose how to compact:** the **Copy Handoff Prompt** button now offers your messages, replies and what workers were asked and reported; a tool digest that says what each call did; a model choosing what to keep; **everything said from the first message** (a conversation that began with a handoff is rebuilt from the log behind it, so no message is lost, no tool calls); or the saved handoff. It reads the chat's own log, keeps your AITalk messages, masks secrets and measures the smaller prompt.
- **AITalk shows markdown properly:** headings, lists, quotes, code, tables and links render safely in every bubble.
- **Fewer surprises in AITalk:** Priya no longer posts an unexplained "Observation", and the agent's joined/left lines stay with the conversation they belong to.
- **Reconnect worker tools yourself:** **AskAway: Reconnect Worker MCP Servers** reconnects a failed MCP server (such as Grafana) or opens its login, once and only when you ask, so no repeated Okta prompts.
- **A clearer view of the team:** the main agent now waits while workers run, workers get a wrap-up message when the turn budget is exceeded, a reviewer-only Admin tab brings their history together, and the Team headline shows "+N finished" for recent paid tasks.
- **New home for docs and issues:** the AskAway page, the in-app **Report Issue** button and the Marketplace links now point at [github.com/intuitiv/AskAway](https://github.com/intuitiv/AskAway), which holds the documentation and the issue tracker. The source code is closed. The MIT licence stays.
- **A new Marketplace page:** shorter and clearer, with the same screenshots and GIFs.
- **No pile of join/leave pills in a new conversation:** a member that left and joined again with nothing said in between is shown once, and **Clear chat** now removes the room-wide pills too.
- **Lists look like lists:** when an agent writes "1) … 2) … 3) …" or "(a) … (b) …" on one line, AITalk shows a real numbered list with nested options.
- **Conversation title in view:** the conversation you are looking at is named on its own line under the tabs.
- **Keep alive count resets when you write:** sending a message in a chat starts the count of pings again at 0.
- **A new conversation starts clean:** the "joined" and "left" lines of earlier conversations no longer pile up at the top of a new one; each conversation shows only its own.
- **The widget keeps updating in big workspaces:** after a window start, reading a very large log history could keep the extension host busy for many minutes and freeze AskAway. Reading logs now does a bounded amount of work per pass.
- **Reload button in the title bar:** a refresh icon beside Switch Conversation redraws the AskAway widget when it gets stuck, without reloading the window.
- **Webex no longer answers itself:** the "finished" notification posted through your webhook was sometimes read back as your reply and started the next turn again and again. It is now recognised as ours even when the webhook is named after the space.
- **Blue ticks when the agent reacts:** a reaction from the agent counts as reading your message. A reply to a worker that had already finished now goes to the main agent instead of being lost, and the room says so.
- **Build keeps its context clean:** Bhaskar now does the main task himself and hands side work (off-path research, long test runs, reviews, unrelated fixes, log digging) to workers, so the conversation is not polluted. The agent text is the same size as before. Reload the window so the updated agent text is installed.
- **Workers are more reliable:** a worker started by a headless agent now runs in that agent's own folder, a headless agent's wait is no longer cut short by your chat messages, and a one-off "token authentication failed" from the model provider is retried once automatically.
- **Handoff as a compaction:** `/sk-handoff` now makes the agent choose what to keep (decisions, your words as written, evidence) and what to leave behind (with where to get it back). A script builds the new conversation's prompt, saves it under `.askaway/handoff/` with a size cap and records how much smaller it is than the conversation. A new **Copy Handoff Prompt** button in the title bar copies it to the clipboard; paste it into a new chat.

## AskAway v2.3.16 (10-27-26)

- **One reaction per person per message:** once you have reacted, another emoji from you is refused, and clicking your own reaction takes it back (that was the duplicate thumbs-up). Removing a reaction tells the agent nothing. The agent follows the same rule.
- **Hover a reaction to see who sent it**, for example "Bhaskar, machs reacted 👍 · agreed", also after a reload.
- **Bhaskar reacts instead of writing** when a message needs no written answer (👍 agreed, 🤔 need clarification, ✅ done, 👀 looking, 🙏 thanks).
- **Messages cost less to deliver:** a message you send reaches Bhaskar with a 35-character header instead of a 110-word block. His name, the instructions and the emoji legend are in his agent text once. Workers and other recipients still get the full label. Reload the window so the updated agent text is installed.

## AskAway v2.3.15 (10-27-26)

- **The conversation title is in the view title bar**, as "AskAway · <title>", and no longer takes space in the tab row.
- **Keep alive pings at 4:50** (checked every 5 seconds so the 10-second window is never missed).
- **Keep alive no longer touches what you are typing:** the ping is sent without using the chat input box, so your draft stays and your attachment is not sent. This relies on a VS Code option (`preserveInput`) that I could not try in a live window.
- **A keep-alive turn is near free:** the agent replies just `ok` (no tools, no AITalk, no handoff), and Priya, Telegram, Webex, the turn-complete sound and learning all skip it.

## AskAway v2.3.14 (10-27-26)

- **Messages go to the main agent by default:** an untagged message is for the main agent; Priya is a silent observer who reads everything, learns from your input and predicts on the agent's answers and questions. Tag `@Priya` (or reply to her) to talk to her. When she is in charge she answers the main agent.
- **Priya works again:** her pinned model no longer exists at the provider, so every run failed and showed "ended without a report". She now uses a current model, and a provider error shows its real reason instead.
- **Smaller reactions:** the agent receives a reaction as just the emoji and the id of the message, with the emoji meanings explained once in its instructions.
- **Joined and left pills are back** (they were hidden by the conversation filter).
- **Keep alive pings reliably:** it uses the conversation's own cache clock, pings at 4:30 at the latest, and retries a ping that failed to send.
- **Less chrome:** the conversation title sits on the tab row instead of its own row, and the tab content gets about 87% of a 600px panel. The Metrics tool table, banner and Team follow the conversation in view.

## AskAway v2.3.13 (10-27-26)

- **The agent now knows who can do what:** every team member's capabilities (for example Cathy: all Webex work, through the `webex` worker profile) are generated from the roster into the main agent's prompt and the `worker` tool description, so "I have no Webex tool here" no longer happens.
- **Approvals are reactions:** approving or rejecting a Webex draft shows as a 👍 or 👎 on the draft card, not as a separate message from you, and its ticks advance to delivered and read once the send finishes.
- **Tabs and conversation chip:** each tab has an icon, a label, an underline when active and count badges; a highlighted chip at the top shows which conversation you are viewing.
- **Budget notices:** the agent gets a one-line notice in its next tool result at 80, 90 and 100 percent of the turn budget, and the hook limit follows the setting.
- **Workers per conversation:** worker runs carry their conversation, so the banner and Team cards change with the conversation you pick.

## AskAway v2.3.12 (10-27-26)

- **One waiting rule for every tool:** `async_bash`, `gradle` and `worker` now wait inline for up to 4 minutes on the first call and return the finished result in one call (no separate start, wait and logs round trips). If it is still running you get the id to `wait` on. `background: true` returns at once. A wait ends early when you write in AITalk and your message rides the result, so messages no longer sit in the queue while a worker runs.
- **`async_bash` takes several commands:** `commands: [...]` runs up to 8 independent commands in one call, one id each, with `stopOnFailure` as an option.
- **Tool rows say what they run:** `🐚 bash: <command>`, `👷 worker: …` and `💬 aitalk: …` in the chat tool row, like Gradle.
- **Conversations stay separate:** AITalk posts are tagged by the conversation that wrote them, not the one you are viewing; each conversation has its own turn record, so the banner, trace and whole-turn cost come from one snapshot and no longer mix; sub-agent trace rows follow their parent; Team follows the switch; Clear chat clears only the conversation in view.
- **Priya stays quiet while you are here:** her end-of-turn reply is posted only when live validation is on and you are away. An @mention or a reply to her still gets an answer, and agents answer her only when they @-mention her.
- **AITalk reply and long runs:** the reply icon opens the reactions as an overlay to the left without moving any message and closes on an outside click or Escape. Ten or more consecutive updates from one agent fold into one row with a short summary and keep the last three visible.
- **A distinct sound for AITalk messages** (the cache-expiry alert keeps its own), and `/sk.handoff` now produces a full handoff for a new conversation, including open questions and guidelines.

## AskAway v2.3.11 (10-27-26)

- **Reactions work and read well:** a reply icon (↩) sits in the time row of each message; clicking it opens the reactions inside that bubble instead of over the next one, and Reply there is an icon too. The open bar is no longer wiped by the chat repainting, which is why clicks did nothing before.
- **Every emoji has a meaning, and the agent hears it:** 👍 agreed, 👎 disagreed, ❤️ loved it, 😂 amused, 🙏 thank you, 🎉 well done, 👀 looking, ✅ confirmed, 🤔 unsure. Hover shows it, and the agent receives "machs reacted with 🤔, which expresses: unsure…".
- **Keep alive is a real switch** at the right end of the tab bar (label, track and thumb, `2/6` while on), off by default.
- **Conversation switcher moved to the title bar** next to "AskAway" (command *Switch Conversation*, a quick pick with "Follow the latest conversation"); the conversation in view is named in the title.
- **Neat frames:** the tab bar, the banner, each tab panel and each Team card have one shared visible line colour and a raised background; the banner text is left-aligned.
- **Dark mode checked, not guessed:** `tools/ui-audit.cjs` renders the real styles and chat in headless Chrome under three dark palettes and measures contrast and frames. The "You answer from your phone" pill, the reaction bar and a quote name inside your own bubble were fixed. `node tools/ui-audit.cjs --png` writes screenshots.

## AskAway v2.3.10 (10-27-26)

- **No more command popups when you allow all:** the Settings tab has an **Allow all commands** switch (`askaway.jobs.allowAll`, off by default); when it is on, `async_bash` runs any command without asking. It also runs without asking when VS Code's `chat.tools.global.autoApprove` is on or `chat.permissions.default` is `autoApprove` or `autopilot`. A single chat's own permission picker is private to VS Code, so use the switch for that case. With none of these on, a command outside your allowlist still asks once.

## AskAway v2.3.9 (10-26-26)

- **Keep alive toggle is always visible:** it used to hide until the window had recorded a conversation, so you saw nothing after a reload. It now shows `Keep alive off` from the first paint; a switch made before any conversation is known applies to the next one. Still off by default, and no automatic ping runs unless it is on.
- **Visible frames:** the banner is a framed card with an accent edge, and every tab (Team included) sits in a bordered panel, so tabs, banner and content are clearly separate.

## AskAway v2.3.8 (10-26-26)

- **Agents use `async_bash` instead of the VS Code terminal:** AskAway Build and AA.Orchestrator no longer list the terminal toolset, and an older copy in `~/.copilot/agents` is migrated. Their prompts now say how to start, wait and cancel a job. Every OpenCode worker, including your own profiles, gets `async_bash` automatically.
- **Live-tested on a cheap model (Luna):** short job, 40 s job, your message interrupting a wait, cancel, finished result pushed with the next tool call, ask-once approval, and per-conversation jobs all pass. agy could not be run here because it was not signed in.
- **Finished jobs stay out of AITalk** unless you turn on `askaway.aitalk.notifyFinishedJobs`.
- **Two-line banner:** line 1 is timer, score, cost and cache age; line 2 is requests, tokens, cache, a `Jobs 2 running · 1 queued · 3 done` chip, Keep alive and Cost to. Nothing wraps.
- **Conversations (first slices):** AskAway follows the conversation you last posted in and keeps the five most recent in a picker; AITalk, Trace and the jobs chip show only that conversation. Team cards are not split yet.
- **Keep alive toggle per conversation, off by default:** no automatic ping ever fires unless it is on (up to 6). The ping still reaches only the focused chat because VS Code cannot address a session by id.
- **Priya reads everything in AITalk** from every sender, with one rules block explaining what we are doing. Cathy's send approval is pinned by a test, and no schedule runs the Webex digest.

## AskAway v2.3.7 (10-26-26)

- **`async_bash` tool (first slice):** the agent starts a long command and gets an id; `wait(id, minutes)` returns when the job finishes, when you message the agent, or after 4:00 with the minutes left, so the agent never sits in a VS Code terminal. Commands outside your terminal allowlist ask once; logs are redacted and jobs survive a window reload. Banner, push on any tool call and gradle/worker wait rules follow (spec 012).
- **Priya reads AITalk too:** your direct AITalk messages and the agent's replies now join her conversation stack.
- **Priya no longer answers a greeting** with "you have not told me anything".
- **Edit and Delete** for unsent messages are now quiet links in the time row instead of a floating bar.

## AskAway v2.3.6 (10-26-26)

- **Edit or delete an unsent message:** hover your own message while it still has a single tick and choose Edit or Delete. Delete also removes it from the agent's pending delivery; Edit puts the text back in the composer and the resend goes to the end of the queue. Once the agent has received it, the buttons are gone.
- **Your photo on the right:** your avatar now sits on the right of your own bubbles, matching the right-aligned row.

## AskAway v2.3.5 (10-26-26)

- **Webex through Cathy works after an upgrade:** the shared OpenCode server kept the old tool list after a release renamed `webex_find_space` to `webex_find`, so Cathy got "Tool not found". AskAway now asks OpenCode to re-read its MCP tools once per build and workspace.
- **AITalk answers no longer repeat your text:** the `aitalk` tool returns the message id and delivery only. A feed post keeps its reply link and details.

## AskAway v2.3.4 (10-21-26)

- **Priya learns from your replies:** AskAway keeps one stack per Copilot conversation of your messages and the agent's final responses. On every reply of yours Priya compares it with her earlier prediction, records a match or miss, and stores what you said as knowledge she cites later. Conversations never share a stack, and nothing is captured for a chat without a session id. Verified live with a cheap model (Luna).
- **Thumbs-up is a reaction:** a reply that is only a reaction emoji now reacts to that message instead of posting a new bubble.
- **Unread count and sound:** `AITalk(3)` in the tab title clears when you open or click AITalk, and every new message plays a short sound.
- **Soft word limit:** the agent's AITalk lines are no longer rejected for one extra word; up to 40 words post as written, longer ones are cut with the full text under Read more.
- **Dark mode:** AITalk and Trace use the side bar colour for the wallpaper, clearer bubble backgrounds and soft borders, derived from your theme.
- **Cache Alert Time in Settings:** `askaway.cacheWarnSeconds` is editable as m:ss in the Settings tab.
- **Your messages reach the agent on any tool call:** queued AITalk messages are now delivered through the PostToolUse hook, not only through AskAway tool results, so the blue tick no longer waits for a gradle or aitalk call; the agent is told its AITalk name (Bhaskar) and a reminder escalates from every 2 minutes to 4, 6 and 8 as a turn goes on, so the room is not flooded.
- **Priya stays in the room:** she is always present, whatever reload or second window happens, and Bhaskar no longer joins from an unidentified tool call when no turn is running.
- **Priya's match score lives in her profile:** the Team card shows "Match 6/10" (or "learning" under 10 compared) and the score-only chat Observation is gone; the reply-learning step no longer posts "you have not told me anything" bubbles.
- **AITalk polish:** fixed-width message bubbles, the turn cost in the time row of the turn's last message, a composer that grows with the text, the caret after a picked @mention, an unread count in the tab title ("AITalk(3)"), and a skeleton loader shaped like the AITalk view.
- **Shipped agent files are ours:** the extension replaces `askaway-build` and `AA.Orchestrator` agent files on every release (one backup of the previous file); agent files you name yourself are never touched.
- **Cache alert time is a setting:** `askaway.cacheWarnSeconds` (default 285 = 4:45).
- **The room gets the Next line:** at turn end the main agent's AITalk message is only the `Next:` question of its Response Handoff plus the turn's total cost; Telegram and Webex keep the full handoff.
- **Updates every two minutes, for real:** the "Status update due" reminder now asks for decisions as well as progress and blockers, has no cap, and is delivered to the Copilot harness as well as VS Code chat.
- **Loader while AskAway starts:** a skeleton screen (tabs, messages and composer painting in with a soft shimmer) covers the view until AITalk has rendered, so unstyled buttons are never seen.
- **Team members rest between turns:** with no turn running, every member shows one fixed "Offline" status with a still dot; while a turn runs the glowing dot returns for working members. No more status flicker when nothing is happening.
- **Priya reads like a person:** her turn-end bubble opens with "My take would be:", Show more reveals the whole message with formatted Sources, Observations and Impact, and when she has nothing she says so lightly.
- **Update reminders keep coming:** the "status update due" reminder repeats until the agent actually posts, every AITalk post resets the same clock, and the AskAway Build agent is told to post about every two minutes.
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
- **Workers & Commentary are now documented.** These two side-panel tabs (async OpenCode-backed background agents, and a live plain-language narration feed) have been present since v2.1.0 but were never explained anywhere. Added a full [Workers & Commentary setup guide](askaway-chat/docs/WORKERS_SETUP.md) covering installing OpenCode, authenticating a provider, writing a worker profile, and the optional VS Code tool bridge.
- Both READMEs now call out Workers/Commentary explicitly as advanced/optional, so a fresh install isn't left guessing what those always-visible tabs are for.

## AskAway v2.1.0 (07-12-26)
- **New: Cowork Offload (`/export-to-cowork`).** Offload heavy brainstorming to a free external model without spending Copilot credits on the export. The command enumerates relevant files by search only (never reading full contents) and writes `.askaway/cowork-manifest.json`; `bundle.mjs` expands it into a single upload-ready bundle; `apply.mjs` validates and `git apply`s the patch that comes back.
- Installed automatically at user level on activation, so it works in every workspace: the command goes to the VS Code User prompts folder and the scripts to `~/.askaway/cowork/`. User edits are preserved.

## AskAway v2.0.0 (07-07-26)
- **Major version.** Focus shifts to Copilot AI credit observability and cost optimization.
- **New: Disable Auto Compaction toggle** (Settings → Optimization). When enabled, VS Code Copilot will not auto-compact (summarize) agent conversation history once the context window fills. Toggles `github.copilot.chat.summarizeAgentConversationHistory.enabled` (off when checked).
- Metrics dashboard (This Turn / This Month), per-model and per-tool observability, RTK savings, and the `gradle`, `code_nav`, and `turn_budget` optimization tools.
