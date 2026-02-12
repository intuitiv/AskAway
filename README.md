<p align="center">
  <img src="tasksync-chat/media/askaway-logo.png" alt="AskAway" width="128" />
</p>

<h1 align="center">AskAway</h1>

<p align="center">
  <strong>A fork of <a href="https://github.com/4regab/TaskSync">TaskSync</a> adding Webex, Telegram, and Remote Mobile/Web access.</strong><br/>
  <sub>All credit for the core extension goes to <a href="https://github.com/4regab">@4regab</a> and the TaskSync project.</sub>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=intuitiv.askaway"><img src="https://img.shields.io/visual-studio-marketplace/v/intuitiv.askaway?label=Marketplace&color=blue" alt="VS Marketplace Version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=intuitiv.askaway"><img src="https://img.shields.io/visual-studio-marketplace/i/intuitiv.askaway?label=Installs&color=green" alt="Installs" /></a>
  <a href="https://github.com/intuitiv/TaskSync/blob/main/LICENSE"><img src="https://img.shields.io/github/license/intuitiv/TaskSync?color=yellow" alt="License" /></a>
  <a href="https://github.com/intuitiv/TaskSync/stargazers"><img src="https://img.shields.io/github/stars/intuitiv/TaskSync?style=social" alt="Stars" /></a>
</p>

<p align="center">
  <a href="#-remote-mobile--web-access">📱 Remote Access</a> •
  <a href="#-webex-integration">💬 Webex</a> •
  <a href="#-telegram-integration">🤖 Telegram</a> •
  <a href="#-installation">⚡ Install</a> •
  <a href="#-features">✨ Features</a>
</p>

---

> **This is a fork of [4regab/TaskSync](https://github.com/4regab/TaskSync).** The core extension — sidebar UI, smart queue, autopilot, MCP server, tool call history — is built by [@4regab](https://github.com/4regab). This fork adds Webex, Telegram, and Remote Mobile/Web integrations on top. See the [upstream repo](https://github.com/4regab/TaskSync) for the original project and community discussions.

---

## The Problem

AI coding agents (Copilot, Cursor, Kiro) frequently pause to ask for approval or clarification. **You have to sit at your desk watching the screen.** If you step away, the agent blocks — wasting time and premium API requests.

## What This Fork Adds

[TaskSync](https://github.com/4regab/TaskSync) already solves the human-in-the-loop problem with a great sidebar UI. **AskAway** extends it by routing agent questions to wherever you are — a Webex space, a Telegram bot, or a browser on your network. Reply from anywhere, and the agent continues seamlessly.

---

## ✨ Features

### From [TaskSync](https://github.com/4regab/TaskSync) (upstream)

| Feature | Description |
|---------|-------------|
| **Smart Queue** | Batch multiple agent questions and respond when ready |
| **Autopilot** | Let agents work autonomously with customizable auto-responses |
| **🔌 MCP Server** | Works with Kiro, Cursor, Gemini CLI, and any MCP client |
| **📎 Attachments** | Image paste support — agent sees your screenshots |
| **#️⃣ Context** | File/folder references with `#` autocomplete, `#terminal`, `#problems` |
| **📜 History** | Full tool call history with session tracking |
| **/ Commands** | Reusable prompt templates via `/slash` commands |

### Added in this fork

| Feature | Description |
|---------|-------------|
| **📱 Remote Access** | Full UI on your phone/tablet via local web server |
| **💬 Webex** | Rich Adaptive Cards in your Webex space with OAuth auto-refresh |
| **🤖 Telegram** | Push notifications + inline keyboard buttons |

---

## ⚡ Installation

**From Marketplace:**
Install [AskAway](https://marketplace.visualstudio.com/items?itemName=intuitiv.askaway) from the VS Code Marketplace.

**From source:**
```bash
cd tasksync-chat
npm install && npm run build
npx vsce package
code --install-extension askaway-*.vsix
```

**Recommended settings** for agent mode:
```json
"chat.agent.maxRequests": 999
```

> Enable **"Auto Approve"** in VS Code settings for uninterrupted agent operation. Keep sessions to 1-2 hours max to avoid hallucinations.

---

## 📱 Remote Mobile & Web Access

Control AskAway from your phone, tablet, or any browser on your network.

| | |
|---|---|
| 🛋️ Work from your couch while AI agents run on your computer | 📱 Full mobile-responsive UI |
| 🔒 Works when your computer screen is locked | ⚡ Real-time WebSocket sync |

**Quick Start:**
1. Click the broadcast icon in the AskAway panel (or run `AskAway: Start Remote Server`)
2. Open the URL on your phone (e.g., `http://192.168.1.5:3000`)
3. Enter the 4-digit PIN shown in VS Code
4. Answer agent questions from anywhere!

**Highlights:** PWA installable • Session isolation per VS Code window • See [full docs](tasksync-chat/docs/REMOTE_ACCESS.md)

---

## 💬 Webex Integration

Receive AI agent questions and respond directly from a **Webex space** — desktop, mobile, or web.

**How it works:**
1. Agent calls `ask_user` → question posted as a rich **Adaptive Card** in your Webex room
2. Reply in the thread → answer flows back to the agent in VS Code
3. Smart backoff polling: fast initially (2s), slows to 5min when idle

**Highlights:**
- 🃏 Rich Adaptive Cards with markdown, code blocks, and choice buttons
- 🔄 OAuth auto-refresh — tokens renew automatically
- 📁 File change tracking — see which files the agent modified
- ⏳ Live status — cards update from "⏳ Awaiting" → "✅ Answered"
- 🔒 Token file support for CI/automation

<details>
<summary><strong>Setup Instructions</strong></summary>

1. Open VS Code Settings → search `askaway.webex`
2. Enable `askaway.webex.enabled`
3. Set `askaway.webex.roomId` (get from Webex API: `GET /rooms`)
4. Choose an auth method:
   - **Simple:** Paste token in `askaway.webex.accessToken`
   - **Token file:** Point `askaway.webex.tokenFilePath` to `{ "access_token": "..." }`
   - **OAuth (recommended):** Set `clientId`, `clientSecret`, `refreshToken` for auto-renewal

</details>

---

## 🤖 Telegram Integration

Receive AI agent questions and respond from **Telegram** — instant push notifications on your phone.

**How it works:**
1. Agent calls `ask_user` → question sent to your Telegram chat
2. Reply to the bot → answer flows back to VS Code
3. Tap inline keyboard buttons for choice-based questions

**Highlights:**
- 📲 Instant push notifications on your phone
- 🔘 Inline keyboard buttons for multiple-choice questions
- 📁 File change tracking in each message
- ⏳ Status updates when answered

<details>
<summary><strong>Setup Instructions</strong></summary>

1. Create a bot via [@BotFather](https://t.me/BotFather) — copy the token
2. Open VS Code Settings → search `askaway.telegram`
3. Enable `askaway.telegram.enabled`
4. Paste bot token in `askaway.telegram.botToken`
5. Run `AskAway: Get Telegram Chat ID` — send any message to your bot for auto-detection

</details>

---

## 🔌 MCP Server

AskAway includes a built-in MCP (Model Context Protocol) server so external AI tools can use it too.

**Supported clients:** Kiro, Cursor, Gemini CLI, and any MCP-compatible tool.

Auto-starts when it detects external client configs, or enable manually:
```json
"askaway.mcpEnabled": true
```

Run `AskAway: Show MCP Config` to get the JSON snippet for your preferred client.

---

> [!WARNING]
> **GitHub Security Notice:**  
> GitHub prohibits excessive automated bulk activity that places undue burden on their infrastructure.
> Review [GitHub Acceptable Use Policies](https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) and [Copilot Terms](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot).
> **Use responsibly and at your own risk.**

## License

MIT — See [LICENSE](LICENSE) for details.

