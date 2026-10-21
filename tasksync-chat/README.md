# AskAway

**Spec-driven development, OpenCode workers, an AITalk room, and remote control from Telegram or Webex.**

You say what you need in plain words. AskAway runs it through Spec Kit, hands the detail to reusable background workers, keeps you informed in one chat room, and shows what every turn costs. Reach it from your phone while you are away.

> **Based on [TaskSync](https://github.com/4regab/TaskSync)** by [4regab](https://github.com/4regab), extended by [intuitiv](https://github.com/intuitiv).

> [!WARNING]
> **CONFLICT WARNING**: AskAway uses the tool name `ask_user`, the same as the `TaskSync` extension. **Disable one before using the other.**

---

## What AskAway Does

**Your team, by name.** The Team tab shows one compact card per member: a face portrait (initials when there is none), name and full role, model and thinking chips, Turn cost with Month cost under it (agy shows $0.00), a status line that rotates every 8 seconds, and a Trace or tasks button. One pencil Edit button opens a single panel with name, role, picture, Model and Thinking dropdowns, the Agent file link (Priya's lives in `~/.askaway/validator/validator.md`) and Reset model to default; your choices are kept in `~/.askaway/team/`, never in the package. Priya (the Validator) shows first, then the main agent, then members by Turn spend; members with no spend appear when you switch on **Show all members** (off after every reload). OpenCode, agy and Claude health chips and a share bar of the turn sit above the cards. Your availability and Team settings are the same in every workspace, and a member's model and thinking are one choice shared by all of them. Build has two members, an Architect on Sonnet or Argon and a Developer on Sol. The main agent's progress lines also appear in AITalk.

**Members of your own.** Add `member:` and `role:` to a profile in `~/.askaway/worker-profiles/` and Team shows them, for example a rules-authoring expert. They stay out of the extension itself.

**Runtimes.** Settings → Integrations lists OpenCode, agy and Claude, each with an on/off switch, one Refresh button (OpenCode restarts its server after asking) and when it was last checked. OpenCode and agy start on. Claude runs workers through the `claude` CLI (`claude/sonnet`, `claude/opus`, `claude/haiku`) and reports its real cost. agy runs the `agy/gemini-4-argon-high` family; agy reports no cost, so its tasks show $0 rather than a price. At startup, every morning and on Refresh, each enabled integration's models are discovered and stored, and the Team dropdowns offer them. A signed-out agy or Claude shows a Sign in button that opens the login in a terminal.

**Your picture.** AITalk reads `~/.askaway/profile/avatar.png` by default, supports an explicit photo override, and falls back to initials. The photo is never copied into a workspace.

| Pillar | What you get |
|--------|--------------|
| **Spec-based development** | Dictate a requirement. AskAway drives Spec Kit behind the scenes (specify, clarify, plan, tasks, implement, check) and the **Specs** tab shows the stage, user stories and tasks. You only answer questions and approve three gates: what, how, done. |
| **OpenCode workers** | Detail work goes to reusable [OpenCode](https://opencode.ai) workers that run in parallel, so the main conversation stays short and cheap. Each worker shows state, cost and a link to its live session under its owner in the **Team** tab. |
| **AITalk room** | One WhatsApp-style group chat per workspace: you, the Agent, the Validator and the workers. Message them, `@mention` them, reply and react, with sent / delivered / read ticks and presence. |
| **Telegram and Webex** | Everything that happens in VS Code can reach your phone, and you can answer from there. Webex messages can be drafted in AITalk and sent only after you approve. |
| **Cost and trace** | Live per-turn and monthly cost, tokens, cache hit, worker share and an efficiency score, plus a trace of every request and tool call. |

## In Action

### AITalk, live

One room per workspace, with the team by name: Bhaskar (the main agent) asks Priya (the Validator), Anika and Diego join as they pick up work, and you can @mention any of them.

![AITalk room with Bhaskar, Priya, Anika and Diego joining, replying and answering a question](https://raw.githubusercontent.com/intuitiv/TaskSync/main/tasksync-chat/docs/screenshots/aitalk-live.gif)

### Team

Every member on one screen: model, thinking, cost and an Agent file link. Tasks appear under their owner as work starts and finish, and the list scrolls.

![Team tab showing members, their costs and tasks starting and finishing during a turn](https://raw.githubusercontent.com/intuitiv/TaskSync/main/tasksync-chat/docs/screenshots/team-tab.gif)

### Trace

![Trace tab with request and token details](https://raw.githubusercontent.com/intuitiv/TaskSync/main/tasksync-chat/docs/screenshots/trace-tab.png)

---

## AITalk Room

The **AITalk** tab is the workspace group chat. The Agent joins when a turn starts and leaves when it ends; workers join when they post; the **Validator** is always there.

- Post a message, `@mention` an actor, or reply to a message to route it to its owner. Unaddressed messages go to the Validator.
- Ticks on your messages show sent, delivered and read.
- When the agent asks a question here it waits up to 45 seconds for your reply, then carries on; your answer reaches it with its next tool call.
- **Clear chat** in the header empties the conversation (after a confirmation) and keeps who is in the room.
- Agent updates read like normal messages, so you can follow the agent's thinking, see where it is stuck, and steer it before it finishes.
- Set your availability from your avatar (away for 30 minutes, a few hours, or until you are back).
- Webex drafts appear as a **Draft** card with recipient and full text. Nothing is sent until you 👍 it.

## Spec-Based Development

The **Specs** tab mirrors Spec Kit without making you learn it.

- Plain text works: a normal message is routed to the right stage. Shortcuts `/sk.start`, `/sk.plan`, `/sk.tasks`, `/sk.check`, `/sk.continue` and `/sk.handoff` are there if you prefer them. In the Copilot harness (VS Code 1.140+) skill names cannot contain dots, so the same shortcuts are `/sk-start`, `/sk-plan` and so on; AskAway installs both.
- Specs use standard user stories with acceptance scenarios and tasks per story; `[P]` tasks run in parallel.
- New asks and recommendations become Spec Kit tasks, so nothing is dropped.
- Questions come in one batch, so you answer once.
- Flagged tasks can run on the GitHub Copilot cloud agent while you are offline (opt-in); AskAway tracks the PR and shares its link when done.

## OpenCode Workers

Workers are background agents run through [OpenCode](https://opencode.ai) on one shared local server per workspace.

- Delegated and run in parallel, so detail work does not bloat the main conversation.
- Reused and kept warm with a cheap keep-alive ping (up to four per worker) so their context is not recreated.
- Each worker's cost, tokens, tool trace and session link live under their owner in the **Team** tab and in the shared banner.
- Side channel: look inside a running worker, nudge it, or ask a side question without derailing the main agent.

Workers need OpenCode and at least one worker profile; see the [Workers setup guide](docs/WORKERS_SETUP.md). Without them, the Team tab shows the members idle.

## Telegram and Webex

Get the agent's questions, status, cost and final answers on your phone and reply from anywhere. Each workspace gets its own topic (Telegram) or space (Webex). Commentary streams live as it happens.

### Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. For topics per workspace, create a group, enable **Topics**, add the bot and make it admin (Manage Topics + Post Messages). For DM only, just message the bot.
3. Run **AskAway: Get Telegram Chat ID**, or read the chat ID from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
4. Set `askaway.telegram.enabled`, `askaway.telegram.botToken` and `askaway.telegram.chatId`.

![Telegram forum topics screenshot](https://raw.githubusercontent.com/intuitiv/TaskSync/main/tasksync-chat/docs/screenshots/telegram-topics.png)

### Webex setup

1. Enable `askaway.webex.enabled`.
2. Run **AskAway: Set Webex Token** (or **AskAway: Authorize Webex (OAuth)**); tokens are kept in VS Code secret storage.
3. Run **AskAway: Discover Webex Spaces** and **AskAway: Configure Webex Notifications**, then set `askaway.webex.roomId` or let AskAway use a space per workspace.

Replies are polled, so your laptop is never exposed to the internet.

## Cost, Trace and Timers

- **Shared banner**: last input, turn output, cache hit, a turn timer, cache age and worker spend, on every tab.
- **Trace**: main-agent requests and tool calls with token and cost detail, a monthly cost table by Main, Validator and worker profile, and red flags for cache misses, long tool calls and oversized tool output.
- **Efficiency score**: one cost-to-work number per turn; a drop means something was not optimal.
- **Keep-alive pings and cache clock**: warm workers are pinged inside the prompt-cache window; calls that run past it are flagged.
- **Turn budget**: set `askaway.turnBudgetAiu` for a soft per-turn credit budget the agent can read with `turn_budget`.

![AskAway This Turn trace](https://raw.githubusercontent.com/intuitiv/TaskSync/main/resources/This%20Turn.jpg)

## Validator and Availability

The **Validator** is a decisioning agent with memory. It learns your answers, predicts your reply to the agent's final message, and doubles as the memory tool. Turn on `askaway.validator.live` and, while you are Away, it answers low-risk reversible questions for you, holds the rest, and gives you a digest when you return. It is off by default.

## Own Tools

| Tool | Purpose |
|------|---------|
| `worker` | Start, reuse, wait for and inspect OpenCode workers |
| `gradle` | Async Gradle builds with paginated logs and test-failure extraction |
| `code_nav` | VS Code language-server navigation instead of reading whole files |
| `rg_search`, `read_doc` | Cheap, structured search and document reads |
| `turn_budget` | Live cost signal for the current turn |
| `askaway_memory`, `askaway_validator` | Durable memory and validator questions |
| `commentary` | Plain-language narration to the room |

If [`rtk`](https://github.com/rtk-ai/rtk) is installed, its token savings show next to the metrics.

## Classic Features

Still included from TaskSync: Smart Queue, Normal and Autopilot modes, concurrent `ask_user` queuing, `#` file and folder references, image paste and drag-and-drop, reusable `/slash` prompts, tool-call history with timestamps, interactive approvals, and an MCP server.

## Installation

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=intuitiv.askaway).
2. Open **AskAway** in the Activity Bar; **AITalk** is the first tab.
3. Optional: install OpenCode for workers, and configure Telegram or Webex for remote control.

### MCP configuration (non-Copilot clients)

AskAway auto-registers with Kiro and Cursor. For other clients:

```json
{
  "mcpServers": {
    "askaway": {
      "transport": "sse",
      "url": "http://localhost:3579/sse"
    }
  }
}
```

## Requirements

- VS Code 1.90.0 or higher
- Optional: OpenCode (workers), Spec Kit, a Telegram bot or Webex account, `rtk`

## License

MIT
