# Workers & Commentary Setup Guide

The AskAway side panel always shows **Workers** and **Commentary** tabs, but they only
become useful once you install [OpenCode](https://opencode.ai) and configure at least one
worker profile. This guide covers that setup end to end.

## What are Workers and Commentary?

| Tab | What it shows |
|-----|----------------|
| **Workers** | Live state, cost, and session links for background [OpenCode](https://opencode.ai) agents ("workers") started in the current workspace |
| **Commentary** | A live, plain-language narration feed a worker (or the agent driving it) can post to while it works |

A "worker" is a separate OpenCode agent process AskAway starts on your machine and manages
for you — you give it a bounded objective, it runs on its own (with its own model, budget,
and permissions), and you watch its progress and cost from the Workers tab instead of
babysitting it in the main chat.

## Do I need this?

No, not by default. This is an advanced, optional feature for people who want to offload
bounded background research or build tasks to a separate AI agent process. If you only
want Telegram/Webex notifications or the Metrics cost dashboard, you can ignore the
Workers and Commentary tabs completely — they will simply stay empty.

## Prerequisites

- AskAway installed and activated in VS Code.
- A terminal, to install and authenticate OpenCode once.
- An LLM provider account OpenCode supports (GitHub Copilot, Anthropic, OpenAI, etc.).

## Step 1 — Install OpenCode

Pick one:

```bash
# Install script (macOS/Linux)
curl -fsSL https://opencode.ai/install | bash

# Or via npm (any OS with Node.js)
npm install -g opencode-ai

# Or via Homebrew (macOS/Linux)
brew install anomalyco/tap/opencode
```

Windows users: see [opencode.ai/docs/windows-wsl](https://opencode.ai/docs/windows-wsl) for
`choco`/`scoop` options and WSL recommendations.

Verify the install:

```bash
opencode --version
```

## Step 2 — Authenticate a provider

Run OpenCode once in any project directory and connect a provider:

```bash
opencode
```

Inside the OpenCode TUI, run `/connect`, pick your provider (for example GitHub Copilot),
and follow the sign-in flow. You only need to do this once per machine — AskAway reuses
the credentials OpenCode stores.

## Step 3 — Create at least one worker profile

AskAway loads worker profiles from `~/.askaway/worker-profiles/*.md`. **This folder does
not exist by default.** If you try to use the Worker tool before creating it, the first
call will fail — create the folder and add at least one profile first:

```bash
mkdir -p ~/.askaway/worker-profiles
```

Create `~/.askaway/worker-profiles/explore.md` with content like:

```markdown
---
name: explore
description: "Read-only research and code exploration"
tier: light
model: github-copilot/gpt-5.6-luna
thinking: low
models: [github-copilot/gpt-5.6-luna, github-copilot/gpt-5.6-terra]
thinkingOptions: [low, high]
edit: deny
bash: ask
webfetch: allow
steps: 40
---
You are a read-only research worker. Investigate the given objective, report your
findings as bounded facts, and never edit files.
```

Frontmatter fields:

| Field | Meaning |
|-------|---------|
| `name` | Profile ID, referenced when starting a worker |
| `tier` | `light`, `mid`, or `heavy` — a rough cost/capability class |
| `model` / `thinking` | Default model and reasoning level for this profile |
| `models` / `thinkingOptions` | The exact set of models/thinking levels a caller may request — anything outside this list is refused, never silently substituted |
| `edit` / `bash` / `webfetch` | Permission for that capability: `allow`, `ask`, or `deny` |
| `mcp` / `skills` | Optional lists of MCP servers / skills this worker may use |
| `steps` | Max agent steps before the worker stops itself |

Add more profiles (e.g. `build`, `test`, `review`) the same way, one file per mode.

## Step 4 — Try it

Ask your agent (Copilot Chat, or any client with the `worker` tool) something like:

> Use the worker tool to start an `explore` worker that investigates how X works in this
> repo and reports back.

Open the **Workers** tab to watch it run, and the **Commentary** tab for its narration
feed. AskAway starts and manages the underlying `opencode serve` process for you the
first time a worker runs.

## Optional: let workers call back into VS Code tools

By default, a worker only has the capabilities its profile allows. If you also want
workers to call back into AskAway/VS Code tools (memory, `code_nav`, diagnostics, etc.),
wire OpenCode to AskAway's MCP server:

1. In VS Code settings, set `askaway.mcpEnabled` to `true` (AskAway's MCP server is not
   auto-started for OpenCode the way it is for Kiro/Cursor/Antigravity).
2. In `~/.config/opencode/opencode.json`, add:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "askaway": {
         "type": "remote",
         "url": "http://localhost:3579/sse",
         "enabled": true,
         "oauth": false
       }
     }
   }
   ```

3. Restart the shared OpenCode server from the restart icon in the Workers tab header so
   it reloads the tool list — OpenCode only reads MCP config at `opencode serve` startup.

## Optional: live commentary in Telegram

If you already use [Telegram integration](../README.md#-telegram-setup-5-minutes),
enable `askaway.telegram.liveCommentary` (on by default) to mirror the Commentary feed
into the same Telegram message as the rest of the turn.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Worker tool errors with a "no such file or directory" on `~/.askaway/worker-profiles` | The folder doesn't exist yet — do Step 3 |
| Workers/Commentary tabs stay empty | OpenCode isn't installed/authenticated, or no worker has run yet — this is expected until Step 4 |
| `SELECTION_UNAVAILABLE` when starting a worker | The requested `model`/`thinking` isn't listed in that profile's `models`/`thinkingOptions` |
| A worker can't see new AskAway tools after editing `opencode.json` | Restart the shared OpenCode server (Workers tab header) — OpenCode caches MCP tools at server start |
