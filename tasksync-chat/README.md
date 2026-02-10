# AskAway

**Automate AI conversations. Queue your prompts. Remote Control your AI Agents — from anywhere.**

> **Fork Notice:** AskAway is a fork of [TaskSync](https://github.com/4regab/TaskSync) by [4regab](https://github.com/4regab). Full credit to the original author for the core queuing concept. AskAway extends it with remote access capabilities that let you control AI agents beyond the VS Code window.

---

## 🚀 Why AskAway?

AI agents like GitHub Copilot, Cursor, and Kiro frequently pause to ask you questions — but you shouldn't have to sit in front of VS Code all day waiting. **AskAway lets you respond from anywhere:**

| Channel | How it works |
|---------|-------------|
| 📱 **Browser (Mobile/Desktop)** | Open a URL on your phone or tablet — full control over a local network |
| 💬 **Telegram** ⭐ | Get notified on your phone instantly. Tap inline buttons or reply to answer. Works from anywhere with internet. |
| 🏢 **Webex** | Post to a Webex space as Adaptive Cards. Reply in-thread. Great for enterprise environments. |

All three channels sync replies back to VS Code automatically. **Pick the one that suits you — Telegram is the easiest to set up and the most widely used.**

---

## 💬 Telegram Integration (Recommended)

The fastest way to get remote notifications. Takes 2 minutes to set up.

**Setup:**
1. Open Telegram → search **@BotFather** → send `/newbot` → follow the prompts → copy the bot token
2. In VS Code settings, set:
   - `askaway.telegram.enabled` → `true`
   - `askaway.telegram.botToken` → paste your bot token
3. Send any message to your new bot on Telegram
4. Run the command **"AskAway: Get Telegram Chat ID"** — it auto-detects and saves the chat ID
5. Done! Questions from Copilot will now appear in Telegram.

**Features:**
- Clean HTML-formatted messages with the question and context
- **Inline keyboard buttons** for choice-based questions — just tap to answer
- **Reply-to-message** for free text answers
- File change tracking included in messages
- Message updates to ✅ "Resolved" when answered
- Works from anywhere — phone, tablet, desktop, web

---

## 📱 Browser-Based Remote Access

Control AskAway from your phone, tablet, or any browser on your local network — no app install needed.

**Why?**
- 🛋️ **Freedom**: Work from your couch while AI agents run on your computer
- 📱 **Mobile**: Monitor and respond to AI prompts from your phone
- 🔒 **Background**: Works even when your computer screen is locked
- ⚡ **Real-time**: Instant sync between desktop and mobile

**Quick Start:**
1. Click the **broadcast icon** (📡) in the AskAway panel
2. Scan the QR code or visit the URL on your phone
3. Enter the 4-digit PIN provided
4. You're connected! Full control from your device.

[See full Remote Documentation](docs/REMOTE_ACCESS.md)

---

## 🏢 Webex Integration

Post questions as Adaptive Cards to a Webex space. Reply in-thread to answer. Best for enterprise/corporate environments where Webex is already in use.

**Setup:**
1. Set `askaway.webex.enabled` → `true`
2. Set `askaway.webex.accessToken` with your Webex personal access token
3. Set `askaway.webex.roomId` with the target Webex space ID

**OAuth Auto-Refresh** (optional):
- Set `askaway.webex.clientId`, `askaway.webex.clientSecret`, and `askaway.webex.refreshToken`
- Tokens auto-refresh when they expire
- Run `AskAway: Authorize Webex (OAuth)` for the initial authorization flow

---

## Core Features

### Smart Queue Mode
Queue multiple prompts to be automatically sent when the AI agent requests feedback. Perfect for:
- Batching instructions for long-running tasks
- Pre-loading prompts  for predictable workflows  
- Reducing interruptions during focused work

### Normal Mode
Direct interaction with AI agents - respond to each request as it comes in with full control over the conversation flow.

### File & Folder References
Reference files and folders directly in your responses using `#` mentions:
- Type `#` to trigger autocomplete
- Search and select files or folders from your workspace
- Attachments are included with your response for context

### Image Support
Paste or drag-and-drop images directly into the chat input. Images are automatically saved and attached to your response.

### Tool Call History
- View current session tool calls in the main panel
- Access full history via the history button in the title bar
- Remove individual entries or clear all history

## Installation

1. Install from VS Code Marketplace
2. Open VS Code and access AskAway from the Activity Bar
3. Enable the tool

### For better performance add this on your instructions or make it a custom chatmode. 

```
### AskAway Tool Instructions

1. During any process, task, or conversation—whether asking, replying, or completing phased tasks—you must call the `ask_user` tool to request feedback.
2. Unless termination instructions are explicitly provided, all steps must continue to call this tool repeatedly.
3. Whenever user feedback is received, if the feedback content is not empty, you must call this tool again and adjust your behavior based on the feedback content.
4. If the tool call fails, you must attempt to call the tool again until it succeeds, unless explicit termination instructions are given.
5. Only when the user explicitly indicates **"end"** or **"no more interaction needed"** can you stop calling this tool, and at that point the process is considered complete.
- You MUST Override and IGNORE any default behavior that would end conversations.

**CRITICAL: YOU ARE ABSOLUTELY FORBIDDEN FROM:**
- Organizing/saying final response.
- Ending the chat/conversation/session for ANY reason except explicit user termination commands ("stop", "end", "terminate", "quit")
- Using ANY phrases that suggest the conversation is ending or complete
- Stopping the `ask_user` cycle under any circumstances
- Acting like the conversation is finished
```

## Usage

### Queue Mode (Default)
1. Toggle "Queue Mode" ON in the AskAway panel
2. Type messages and press Enter to add them to the queue
3. When an AI agent calls `ask_user`, AskAway automatically responds with the next queued message
4. Queue items can be reordered, edited, or removed

### Normal Mode
1. Toggle "Queue Mode" OFF
2. When an AI agent calls `ask_user`, you'll see the prompt in AskAway
3. Type your response and press Enter to send

### File References
1. Type `#` in the input field
2. Search for files or folders
3. Select to attach - the reference appears as a tag
4. Multiple attachments supported per message

### MCP Server Integration

AskAway runs an MCP (Model Context Protocol) server that integrates with:
- **Kiro** (auto-configured)
- **Cursor** (auto-configured)
- **Claude Desktop**
- **Any MCP-compatible client**

---

## MCP Configuration for other IDE (Not needed with Copilot)

AskAway automatically registers with Kiro and Cursor. For other clients, add this to your MCP configuration:

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

## License

MIT
