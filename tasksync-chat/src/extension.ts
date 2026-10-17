import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CONFIG_NAMESPACE, OUTPUT_CHANNEL_NAME, MCP_SERVER_NAME } from './constants/branding';
import { AskAwayWebviewProvider, readAvailability } from './webview/webviewProvider';
import { wireWebex } from './services/webexWiring';
import { AITalkStore } from './aitalk/store';
import { roomFor } from './aitalk/actors';
import { connectWebexDrafts } from './aitalk/webexDraftCards';
import { currentAITalkCaller } from './aitalk/delivery';
import { registerAITalkValidator, askValidator } from './aitalk/validatorDelivery';
import { notifyAttention, registerAttentionNotify } from './services/attentionNotify';
import { createWebexSuiteHost } from './services/webexToolsHost';
import { registerTools } from './tools';
import { ASKWAY_BUILD_AGENT_FILE, ASKWAY_BUILD_AGENT_CONTENT } from './agents/askawayBuildAgent';
import { addMissingAskAwayTools } from './agents/askawayBuildAgent';
import { memoryTool } from './validator/memoryTool';
import { validatorTool } from './validator/validatorTool';
import { asksTool } from './specs/askTool';
import { registerLmToolDefinitions } from './workers/lmTools';
import { LiveDigest } from './validator/liveDigest';
import { CommentaryWatch } from './validator/commentaryWatch';
import { ValidatorObserver, validatorWorkerRun } from './validator/observer';
import { validatorProfile } from './validator/profile';
import { OpenCodeWorkerRuntime } from './workers/openCodeRuntime';
import { syncOpenCodeAgents } from './workers/workerProfiles';
import { ValidatorTriggers } from './validator/validatorTriggers';
import { readActiveSpecSlug } from './specs/specCostLedger';
import { defaultMemorySources, seedMemories } from './validator/memorySeed';
import { ensureMemoryServer, localMemorySecret, MEMORY_SERVER_URL } from './validator/memoryServer';
import { AgentmemoryStore } from './validator/agentmemoryStore';
import { DedupKnowledgeStore, KnowledgeStore } from './validator/knowledgeStore';
import { SUBAGENT_TIMER_INJECT_SCRIPT } from './hooks/subagentTimerScript';
import { conversationHooksConfig, copilotCommandHook, copilotShellHook, failOpenCommand, hookSandboxPaths, mergeSandboxPaths, SANDBOX_PATHS_SETTING } from './hooks/copilotHooks';
import { installSpecKitCommands } from './specs/specKitInstall';
import { McpServerManager } from './mcp/mcpServer';
import { killAllGradleRuns } from './gradle/gradleEngine';
import { ContextManager } from './context';
import { PlanEditorProvider } from './plan/planEditorProvider';
import { COWORK_BUNDLE_B64, COWORK_APPLY_B64, COWORK_PROMPT_B64 } from './cowork/coworkAssets';
import { sharedCommentaryStore, sharedWorkerRuntimeReady, setWorkerPresenceLifecycle } from './workers/workerHost';
import { getRuntimeHealth, RUNTIME_NAMES, runtimeRefusal, runtimeSettingChanged, startRuntimeHealth } from './workers/runtimeHealth';
import { setBuiltinWorkerProfilesDir, sharedWorkerRuntime } from './workers/workerHost';
import { setWorkerProfileCatalog, setWorkerRuntimeGate } from './workers/workerTools';
import { USER_PROFILES_DIR } from './team/roster';

// Heavy modules loaded lazily to avoid blocking activation
// RemoteUiServer imports express + socket.io (expensive)
// WebexService, TelegramService do network/config I/O
type WebexServiceType = import('./services/webexService').WebexService;
type TelegramServiceType = import('./services/telegramService').TelegramService;

let mcpServer: McpServerManager | undefined;
let webviewProvider: AskAwayWebviewProvider | undefined;
let contextManager: ContextManager | undefined;
let planEditor: PlanEditorProvider | undefined;
let telegramServiceInstance: TelegramServiceType | undefined;
let activationOutputChannel: vscode.OutputChannel | undefined;

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    }
    return String(error);
}

function logRuntime(message: string, details?: unknown): void {
    const timestamp = new Date().toISOString();
    const suffix = details !== undefined
        ? ` ${typeof details === 'string' ? details : JSON.stringify(details)}`
        : '';
    activationOutputChannel?.appendLine(`[${timestamp}] AskAway Runtime: ${message}${suffix}`);
}

const RTK_GATE_COMMAND = '$HOME/.askaway/hooks/rtk-gate.sh';
const RTK_GATE_SCRIPT = `#!/bin/sh
# AskAway RTK conditional hook gate (PreToolUse).
# Toggle OFF: no output -> tool runs unchanged.
# Toggle ON: delegate command-only mutation to rtk's hook implementation.

SENTINEL="$HOME/.askaway-rtk-enabled"
payload=$(cat)

[ -f "$SENTINEL" ] || exit 0

RTK_BIN="$(command -v rtk 2>/dev/null)"
if [ -z "$RTK_BIN" ]; then
    for p in /opt/homebrew/bin/rtk /usr/local/bin/rtk "$HOME/.local/bin/rtk"; do
        if [ -x "$p" ]; then
            RTK_BIN="$p"
            break
        fi
    done
fi
[ -n "$RTK_BIN" ] || exit 0

# VS Code Copilot sends {toolName,input}; current rtk expects Claude's
# {tool_name,tool_input}. Normalize keys, then delegate to rtk's hook engine.
printf '%s' "$payload" | sed 's/"toolName"/"tool_name"/;s/"input"/"tool_input"/' | "$RTK_BIN" hook claude
exit 0
`;
const RTK_HOOK_MATCHERS = [
    // Claude Code's shell tool.
    'Bash',
    // VS Code Copilot terminal + task command tools. RTK wraps the shell command
    // carried by these tools; non-shell command tools (e.g. run_vscode_command) are
    // intentionally excluded because RTK cannot compress VS Code command output.
    'run_in_terminal|runInTerminal|sendToTerminal|send_to_terminal|local_shell|bash|powershell|createAndRunTask|create_and_run_task|runTask|runTasks|runCommand|runCommands'
];

// ── Turn-budget UserPromptSubmit hook ─────────────────────────────────────────
// Injects a live per-turn budget banner into every prompt when a soft budget is set
// (askaway.turnBudgetAiu > 0). This is the "push" complement to the pull-based
// turn_budget tool. The extension writes two sentinels the hook reads (it runs as an
// external process and can't read VS Code config):
//   ~/.askaway/turn-budget-aiu        the soft limit (0/absent => hook is a no-op)
//   ~/.askaway/workspace-storage-root the VS Code workspaceStorage dir to scan for logs
const BUDGET_GATE_COMMAND = '$HOME/.askaway/hooks/budget-gate.sh';
const BUDGET_GATE_SCRIPT = `#!/bin/sh
# AskAway turn-budget injector (UserPromptSubmit). No output unless a soft budget is set.
CFG="$HOME/.askaway"
[ -f "$CFG/turn-budget-aiu" ] || exit 0
cat >/dev/null 2>&1
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
    for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
        [ -x "$p" ] && NODE="$p" && break
    done
fi
[ -n "$NODE" ] || exit 0
"$NODE" "$CFG/hooks/budget-inject.js"
exit 0
`;
const BUDGET_INJECT_SCRIPT = `// AskAway turn-budget injector. Emits a UserPromptSubmit additionalContext banner with
// live per-turn spend vs the configured soft limit. No output if no budget is set.
const fs = require('fs'), path = require('path'), os = require('os');
function safeReaddir(d) { try { return fs.readdirSync(d); } catch (e) { return []; } }
try {
    const cfg = path.join(os.homedir(), '.askaway');
    const limit = parseFloat((fs.readFileSync(path.join(cfg, 'turn-budget-aiu'), 'utf8') || '0').trim()) || 0;
    if (!(limit > 0)) { process.exit(0); }
    const wsRoot = (fs.readFileSync(path.join(cfg, 'workspace-storage-root'), 'utf8') || '').trim();
    if (!wsRoot) { process.exit(0); }
    let workspace = process.env.ASKAWAY_WORKSPACE_PATH || process.cwd();
    try { workspace = fs.realpathSync(workspace); } catch (e) {}
    const workspaceKey = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    let newest = null;
    for (const h of safeReaddir(wsRoot)) {
        try {
            const metadata = JSON.parse(fs.readFileSync(path.join(wsRoot, h, 'workspace.json'), 'utf8'));
            if (metadata.folder && decodeURIComponent(new URL(metadata.folder).pathname) !== workspace) { continue; }
        } catch (e) {}
        const dl = path.join(wsRoot, h, 'GitHub.copilot-chat', 'debug-logs');
        for (const s of safeReaddir(dl)) {
            const m = path.join(dl, s, 'main.jsonl');
            try { const st = fs.statSync(m); if (!newest || st.mtimeMs > newest.mt) { newest = { dir: path.join(dl, s), mt: st.mtimeMs }; } } catch (e) {}
        }
    }
    if (!newest) { process.exit(0); }
    // Parent turn boundary = newest user_message in main.jsonl (child sub-agent logs have their own).
    const mainLines = fs.readFileSync(path.join(newest.dir, 'main.jsonl'), 'utf8').split('\\n');
    let lastSubmit = 0;
    for (const l of mainLines) { if (l.indexOf('"type":"user_message"') === -1) { continue; } try { const p = JSON.parse(l); if (typeof p.ts === 'number' && p.ts > lastSubmit) { lastSubmit = p.ts; } } catch (e) {} }
    // Sum main.jsonl PLUS runSubagent-*.jsonl child sessions (sub-agent calls are billed but logged separately).
    const files = safeReaddir(newest.dir).filter(n => n.endsWith('.jsonl') && n.indexOf('title-') !== 0 && (n === 'main.jsonl' || n.indexOf('runSubagent') === 0)).map(n => path.join(newest.dir, n));
    let nano = 0;
    for (const f of files) {
        let data; try { data = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
        for (const l of data.split('\\n')) { if (l.indexOf('llm_request') === -1) { continue; } let p; try { p = JSON.parse(l); } catch (e) { continue; } const ts = typeof p.ts === 'number' ? p.ts : 0; if (ts < lastSubmit) { continue; } nano += (p.attrs && typeof p.attrs.copilotUsageNanoAiu === 'number') ? p.attrs.copilotUsageNanoAiu : 0; }
    }
    // At UserPromptSubmit the NEW turn's user_message is not yet in the log, so the newest
    // user_message ts is the PREVIOUS turn's — and \`nano\` below is the previous turn's total.
    // The current turn is genuinely fresh (0 spent) at this instant, so present it that way
    // and expose the previous turn as context. Live in-turn spend comes from the turn_budget tool.
    // One line of NUMBERS only. The how-to guidance is static and lives in the cached
    // AskAway Build agent instructions (## Turn Budget), so it costs ~0 per turn here.
    let prevSpent;
    try {
        const totals = JSON.parse(fs.readFileSync(path.join(cfg, 'turn-totals', workspaceKey + '.json'), 'utf8'));
        if (lastSubmit > 0 && totals.turnStartedAt === lastSubmit && Number.isFinite(totals.spentAiu)) { prevSpent = totals.spentAiu; }
    } catch (e) {}
    if (prevSpent === undefined) {
        let workerDollars = 0;
        try {
            const ledger = fs.readFileSync(path.join(cfg, 'worker-ledger', workspaceKey + '.jsonl'), 'utf8');
            for (const line of ledger.split('\\n')) {
                let record; try { record = JSON.parse(line); } catch (e) { continue; }
                if (record.ts >= lastSubmit && record.type === 'checkpoint' && record.usage) { workerDollars += Number(record.usage.cost) || 0; }
            }
        } catch (e) {}
        prevSpent = nano / 1e9 + workerDollars * 100;
    }
    const pctPrev = Math.round(prevSpent / limit * 100);
    const ctx = lastSubmit === 0
        ? 'Turn budget: ' + limit + ' AIU'
        : 'Turn budget: ' + limit + ' AIU · last turn ' + prevSpent.toFixed(0) + ' (' + pctPrev + '%' + (pctPrev >= 100 ? ', OVER — be frugal' : '') + ')';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } }));
} catch (e) {}
process.exit(0);
`;

// ── Prompt-cache activity timer (event-driven) ────────────────────────────────
// The webview shows a "prompt cache age" clock. Polling the debug log lags (Copilot
// logs an llm_request only on completion) and never resets on a fresh submission.
// These hooks stamp ~/.askaway/cache-activity-ts on model-activity events so the clock
// is event-driven: UserPromptSubmit resets it (age 0), PostToolUse/Stop mark the last
// model round. The extension reads the sentinel each broadcast (max with the log ts).
const CACHE_TIMER_GATE_COMMAND = '$HOME/.askaway/hooks/cache-timer-gate.sh';
const CACHE_TIMER_GATE_SCRIPT = `#!/bin/sh
# AskAway prompt-cache activity timer. Records wall-clock time of model activity so the
# webview cache-age clock is event-driven. Passes stdin to node (it reads hook_event_name
# to detect turn end). No-op if node is missing.
CFG="$HOME/.askaway"
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
    for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
        [ -x "$p" ] && NODE="$p" && break
    done
fi
[ -n "$NODE" ] || { cat >/dev/null 2>&1; exit 0; }
"$NODE" "$CFG/hooks/cache-timer.js"
exit 0
`;
const CACHE_TIMER_INJECT_SCRIPT = `// AskAway prompt-cache activity timer. Stamps ~/.askaway/cache-activity-ts on each
// model-activity hook event; on the Stop event it also stamps ~/.askaway/turn-complete-ts
// so the webview can play the "turn complete" sound. No stdout.
//
// A sub-agent runs on its OWN prompt cache, so its tool calls must not reset the MAIN
// agent's clock — otherwise a long delegation hides the fact that the parent cache went
// cold. runSubagent blocks its caller, so while ~/.askaway/subagent-inflight.json has a
// pending entry every non-runSubagent tool call belongs to a child: those stamp the
// separate subagent-cache-activity-ts instead.
const fs = require('fs'), path = require('path'), os = require('os');
try {
    let ev = '', tool = '';
    try {
        const p = JSON.parse(fs.readFileSync(0, 'utf8'));
        ev = p.hook_event_name || p.hookEventName || '';
        tool = p.tool_name || p.toolName || '';
    } catch (e) {}
    const cfg = path.join(os.homedir(), '.askaway');
    try { fs.mkdirSync(cfg, { recursive: true }); } catch (e) {}
    let inflight = 0;
    try { inflight = (JSON.parse(fs.readFileSync(path.join(cfg, 'subagent-inflight.json'), 'utf8')).pending || []).length; } catch (e) {}
    const now = String(Date.now());
    const isChild = inflight > 0 && ev === 'PostToolUse' && tool !== 'runSubagent';
    fs.writeFileSync(path.join(cfg, isChild ? 'subagent-cache-activity-ts' : 'cache-activity-ts'), now, 'utf8');
    if (ev === 'Stop') { fs.writeFileSync(path.join(cfg, 'turn-complete-ts'), now, 'utf8'); }
} catch (e) {}
process.exit(0);
`;

// ── Sub-agent cache-window timer ────────────────────────────────────────────
// Tracks each child independently so the parent can enforce the four-minute
// delegation budget without confusing parent and child tool calls.
const SUBAGENT_TIMER_GATE_COMMAND = '$HOME/.askaway/hooks/subagent-timer-gate.sh';
const SUBAGENT_TIMER_GATE_SCRIPT = `#!/bin/sh
# AskAway sub-agent cache-window timer. Passes stdin to node (it reads hook_event_name and
# tool_name). No-op if node is missing.
CFG="$HOME/.askaway"
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
    for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
        [ -x "$p" ] && NODE="$p" && break
    done
fi
[ -n "$NODE" ] || { cat >/dev/null 2>&1; exit 0; }
"$NODE" "$CFG/hooks/subagent-timer.js"
exit 0
`;
async function ensureSubagentTimerHookInstalled(): Promise<void> {
    const gatePath = path.join(os.homedir(), '.askaway', 'hooks', 'subagent-timer-gate.sh');
    const timerPath = path.join(os.homedir(), '.askaway', 'hooks', 'subagent-timer.js');
    try {
        await fs.promises.mkdir(path.dirname(gatePath), { recursive: true });
        if (await fs.promises.readFile(gatePath, 'utf8').catch(() => undefined) !== SUBAGENT_TIMER_GATE_SCRIPT) {
            await fs.promises.writeFile(gatePath, SUBAGENT_TIMER_GATE_SCRIPT, 'utf8');
        }
        await fs.promises.chmod(gatePath, 0o755);
        if (await fs.promises.readFile(timerPath, 'utf8').catch(() => undefined) !== SUBAGENT_TIMER_INJECT_SCRIPT) {
            await fs.promises.writeFile(timerPath, SUBAGENT_TIMER_INJECT_SCRIPT, 'utf8');
        }

        const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'subagent-timer.json');
        const cfg = {
            version: 1,
            hooks: {
                PreToolUse: [copilotCommandHook(gatePath, 5)],
                PostToolUse: [copilotCommandHook(gatePath, 5)],
                UserPromptSubmit: [copilotCommandHook(gatePath, 5)],
                Stop: [copilotCommandHook(gatePath, 5)],
            },
        };
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });
        await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
        logRuntime('Installed AskAway sub-agent timer hook', { gatePath, timerPath });
    } catch (err) {
        logRuntime('Warning: Could not install AskAway sub-agent timer hook', formatError(err));
    }
}

/** Install the prompt-cache activity timer hook (UserPromptSubmit / PostToolUse / Stop). */
async function ensureCacheTimerHookInstalled(): Promise<void> {
    const gatePath = path.join(os.homedir(), '.askaway', 'hooks', 'cache-timer-gate.sh');
    const injectPath = path.join(os.homedir(), '.askaway', 'hooks', 'cache-timer.js');
    const events = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
    try {
        await fs.promises.mkdir(path.dirname(gatePath), { recursive: true });
        if (await fs.promises.readFile(gatePath, 'utf8').catch(() => undefined) !== CACHE_TIMER_GATE_SCRIPT) {
            await fs.promises.writeFile(gatePath, CACHE_TIMER_GATE_SCRIPT, 'utf8');
        }
        await fs.promises.chmod(gatePath, 0o755);
        if (await fs.promises.readFile(injectPath, 'utf8').catch(() => undefined) !== CACHE_TIMER_INJECT_SCRIPT) {
            await fs.promises.writeFile(injectPath, CACHE_TIMER_INJECT_SCRIPT, 'utf8');
        }
        const gateAbs = path.join(os.homedir(), '.askaway', 'hooks', 'cache-timer-gate.sh');

        // VS Code Copilot: ~/.copilot/hooks/cache-timer.json (one file, several events).
        const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'cache-timer.json');
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });
        const cfg: any = { version: 1, hooks: {} };
        for (const ev of events) {
            cfg.hooks[ev] = [copilotCommandHook(gateAbs, 5)];
        }
        await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

        // Claude Code: ~/.claude/settings.json hooks.<event>
        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        await fs.promises.mkdir(path.dirname(claudeSettingsPath), { recursive: true });
        let settings: any = {};
        try { settings = JSON.parse(await fs.promises.readFile(claudeSettingsPath, 'utf8')); } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
        }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { settings = {}; }
        if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) { settings.hooks = {}; }
        let changed = false;
        for (const ev of events) {
            if (!Array.isArray(settings.hooks[ev])) { settings.hooks[ev] = []; }
            const has = settings.hooks[ev].some((e: any) =>
                Array.isArray(e?.hooks) && e.hooks.some((h: any) => h?.command === CACHE_TIMER_GATE_COMMAND));
            if (!has) {
                settings.hooks[ev].push({ hooks: [{ type: 'command', command: CACHE_TIMER_GATE_COMMAND }] });
                changed = true;
            }
        }
        if (changed) {
            await fs.promises.writeFile(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        }

        logRuntime('Installed AskAway cache-timer hook', { gatePath, injectPath });
    } catch (err) {
        logRuntime('Warning: Could not install AskAway cache-timer hook', formatError(err));
    }
}

// ── Tool I/O logger (PostToolUse) ─────────────────────────────────────────────
// Copilot truncates the tool result in its DEBUG LOG (attrs.result, ~5K chars), so the
// observability tool row undercounts big outputs (a 185KB memory read shows as ~1.3K tok
// instead of ~48K). The PostToolUse hook receives the FULL, untruncated tool_response plus
// tool_name + tool_use_id, so we log the real input/output sizes to ~/.askaway/tool-io.jsonl
// and the webview reconciles the tool row against it. Lossless, independent of the debug log.
const TOOL_IO_GATE_COMMAND = '$HOME/.askaway/hooks/tool-io-gate.sh';
const TOOL_IO_GATE_SCRIPT = `#!/bin/sh
# AskAway tool I/O logger. Pipes the PostToolUse payload (stdin) to node, which appends the
# real (untruncated) input/output sizes to ~/.askaway/tool-io.jsonl. No-op if node is missing.
CFG="$HOME/.askaway"
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
    for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
        [ -x "$p" ] && NODE="$p" && break
    done
fi
[ -n "$NODE" ] || { cat >/dev/null 2>&1; exit 0; }
"$NODE" "$CFG/hooks/tool-io.js"
exit 0
`;
const TOOL_IO_INJECT_SCRIPT = `// AskAway tool I/O logger. Reads a PostToolUse payload from stdin and appends one JSONL row
// {ts, tool, id, inChars, outChars, in, out} with the FULL (untruncated) input/output Copilot
// handed the model. The EXTENSION tokenizes 'in'/'out' with the real gpt-tokenizer (there is no
// tokenizer here), so no chars/4 estimate is stored. Text is capped at 1MB/field and the file is
// bounded to the last ~2000 rows / 16MB. No stdout.
const fs = require('fs'), path = require('path'), os = require('os');
try {
    let p = {};
    try { p = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) {}
    const tool = p.tool_name || p.toolName || '';
    if (!tool) { process.exit(0); }
    const id = p.tool_use_id || p.toolUseId || '';
    const inStr = typeof p.tool_input === 'string' ? p.tool_input : JSON.stringify(p.tool_input || {});
    // Copilot has changed the PostToolUse response key over time; probe the known aliases so a
    // rename doesn't silently zero out captured output.
    const respRaw = (p.tool_response !== undefined ? p.tool_response
        : p.tool_result !== undefined ? p.tool_result
        : p.toolResponse !== undefined ? p.toolResponse
        : p.response !== undefined ? p.response
        : p.output !== undefined ? p.output
        : p.result);
    const outStr = typeof respRaw === 'string' ? respRaw : JSON.stringify(respRaw || '');
    const CAP = 1024 * 1024;
    const row = { ts: Date.now(), tool: tool, id: id, inChars: inStr.length, outChars: outStr.length, in: inStr.slice(0, CAP), out: outStr.slice(0, CAP) };
    const cfg = path.join(os.homedir(), '.askaway');
    try { fs.mkdirSync(cfg, { recursive: true }); } catch (e) {}
    const file = path.join(cfg, 'tool-io.jsonl');
    fs.appendFileSync(file, JSON.stringify(row) + '\\n', 'utf8');
    try {
        const st = fs.statSync(file);
        if (st.size > 16 * 1024 * 1024) {
            const lines = fs.readFileSync(file, 'utf8').split('\\n').filter(Boolean);
            fs.writeFileSync(file, lines.slice(-2000).join('\\n') + '\\n', 'utf8');
        }
    } catch (e) {}
} catch (e) {}
process.exit(0);
`;

/** Install the tool I/O logger hook (PostToolUse). Logs full, untruncated tool input/output
 *  sizes so the observability tool row reflects what the model actually received. */
async function ensureToolIoHookInstalled(): Promise<void> {
    const gatePath = path.join(os.homedir(), '.askaway', 'hooks', 'tool-io-gate.sh');
    const injectPath = path.join(os.homedir(), '.askaway', 'hooks', 'tool-io.js');
    const events = ['PostToolUse'];
    try {
        await fs.promises.mkdir(path.dirname(gatePath), { recursive: true });
        if (await fs.promises.readFile(gatePath, 'utf8').catch(() => undefined) !== TOOL_IO_GATE_SCRIPT) {
            await fs.promises.writeFile(gatePath, TOOL_IO_GATE_SCRIPT, 'utf8');
        }
        await fs.promises.chmod(gatePath, 0o755);
        if (await fs.promises.readFile(injectPath, 'utf8').catch(() => undefined) !== TOOL_IO_INJECT_SCRIPT) {
            await fs.promises.writeFile(injectPath, TOOL_IO_INJECT_SCRIPT, 'utf8');
        }
        const gateAbs = path.join(os.homedir(), '.askaway', 'hooks', 'tool-io-gate.sh');

        // VS Code Copilot: ~/.copilot/hooks/tool-io.json
        const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'tool-io.json');
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });
        const cfg: any = { version: 1, hooks: {} };
        for (const ev of events) {
            cfg.hooks[ev] = [copilotCommandHook(gateAbs, 5)];
        }
        await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

        // Claude Code: ~/.claude/settings.json hooks.PostToolUse
        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        await fs.promises.mkdir(path.dirname(claudeSettingsPath), { recursive: true });
        let settings: any = {};
        try { settings = JSON.parse(await fs.promises.readFile(claudeSettingsPath, 'utf8')); } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
        }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { settings = {}; }
        if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) { settings.hooks = {}; }
        let changed = false;
        for (const ev of events) {
            if (!Array.isArray(settings.hooks[ev])) { settings.hooks[ev] = []; }
            const has = settings.hooks[ev].some((e: any) =>
                Array.isArray(e?.hooks) && e.hooks.some((h: any) => h?.command === TOOL_IO_GATE_COMMAND));
            if (!has) {
                settings.hooks[ev].push({ hooks: [{ type: 'command', command: TOOL_IO_GATE_COMMAND }] });
                changed = true;
            }
        }
        if (changed) {
            await fs.promises.writeFile(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        }

        logRuntime('Installed AskAway tool-io hook', { gatePath, injectPath });
    } catch (err) {
        logRuntime('Warning: Could not install AskAway tool-io hook', formatError(err));
    }
}

// ── Sub-agent model interception (PreToolUse) ─────────────────────────────────
// Opt-in: when askaway.subagentModel is set, a PreToolUse hook rewrites the `model`
// arg of Copilot's built-in `runSubagent` tool so sub-agents run on a cheaper model.
// Same mechanism as the RTK command rewrite. No-op when the sentinel is empty/absent.
const SUBAGENT_MODEL_GATE_COMMAND = '$HOME/.askaway/hooks/subagent-model-gate.sh';
const SUBAGENT_MODEL_GATE_SCRIPT = `#!/bin/sh
# AskAway sub-agent model injector (PreToolUse). Passes stdin through to node so the
# tool payload reaches the injector. No-op (stdin consumed, tool unchanged) when the
# sentinel is absent or node can't be found.
CFG="$HOME/.askaway"
[ -f "$CFG/subagent-model" ] || { cat >/dev/null 2>&1; exit 0; }
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
    for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
        [ -x "$p" ] && NODE="$p" && break
    done
fi
[ -n "$NODE" ] || { cat >/dev/null 2>&1; exit 0; }
"$NODE" "$CFG/hooks/subagent-model.js"
exit 0
`;
const SUBAGENT_MODEL_INJECT_SCRIPT = `// AskAway sub-agent model injector. On a runSubagent PreToolUse, overrides tool_input.model
// with the configured cheap model so the sub-agent runs cheaper. Emits nothing otherwise.
const fs = require('fs'), path = require('path'), os = require('os');
try {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { process.exit(0); }
    let p; try { p = JSON.parse(raw); } catch (e) { process.exit(0); }
    const toolName = p.tool_name || p.toolName || '';
    const input = p.tool_input || p.input;
    if (toolName !== 'runSubagent' || !input || typeof input !== 'object') { process.exit(0); }
    const model = (fs.readFileSync(path.join(os.homedir(), '.askaway', 'subagent-model'), 'utf8') || '').trim();
    if (!model) { process.exit(0); }
    if (input.model === model) { process.exit(0); }
    const updated = Object.assign({}, input, { model: model });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: updated } }));
} catch (e) {}
process.exit(0);
`;

/** Write the sentinel the sub-agent model hook reads (the desired model string; empty = off). */
async function writeSubagentModelSentinel(): Promise<void> {
    try {
        const cfgDir = path.join(os.homedir(), '.askaway');
        await fs.promises.mkdir(cfgDir, { recursive: true });
        const model = String(vscode.workspace.getConfiguration('askaway').get('subagentModel', '') || '').trim();
        await fs.promises.writeFile(path.join(cfgDir, 'subagent-model'), model, 'utf8');
    } catch (err) {
        logRuntime('Warning: Could not write sub-agent model sentinel', formatError(err));
    }
}

/** Install the sub-agent model PreToolUse hook (Copilot hooks + Claude settings, best-effort). */
async function ensureSubagentModelHookInstalled(): Promise<void> {
    const gatePath = path.join(os.homedir(), '.askaway', 'hooks', 'subagent-model-gate.sh');
    const injectPath = path.join(os.homedir(), '.askaway', 'hooks', 'subagent-model.js');
    try {
        await fs.promises.mkdir(path.dirname(gatePath), { recursive: true });
        if (await fs.promises.readFile(gatePath, 'utf8').catch(() => undefined) !== SUBAGENT_MODEL_GATE_SCRIPT) {
            await fs.promises.writeFile(gatePath, SUBAGENT_MODEL_GATE_SCRIPT, 'utf8');
        }
        await fs.promises.chmod(gatePath, 0o755);
        if (await fs.promises.readFile(injectPath, 'utf8').catch(() => undefined) !== SUBAGENT_MODEL_INJECT_SCRIPT) {
            await fs.promises.writeFile(injectPath, SUBAGENT_MODEL_INJECT_SCRIPT, 'utf8');
        }

        // VS Code Copilot: ~/.copilot/hooks/subagent-model.json (separate file; PreToolUse).
        const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'subagent-model.json');
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });
        const gateAbs = path.join(os.homedir(), '.askaway', 'hooks', 'subagent-model-gate.sh');
        const cfg = {
            version: 1,
            hooks: {
                PreToolUse: [copilotCommandHook(gateAbs, 5)],
                preToolUse: [copilotShellHook(gateAbs, 5)],
            },
        };
        await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

        // Claude Code: ~/.claude/settings.json hooks.PreToolUse with a runSubagent matcher.
        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        await fs.promises.mkdir(path.dirname(claudeSettingsPath), { recursive: true });
        let settings: any = {};
        try { settings = JSON.parse(await fs.promises.readFile(claudeSettingsPath, 'utf8')); } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
        }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { settings = {}; }
        if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) { settings.hooks = {}; }
        if (!Array.isArray(settings.hooks.PreToolUse)) { settings.hooks.PreToolUse = []; }
        const hasEntry = settings.hooks.PreToolUse.some((e: any) =>
            Array.isArray(e?.hooks) && e.hooks.some((h: any) => h?.command === SUBAGENT_MODEL_GATE_COMMAND));
        if (!hasEntry) {
            settings.hooks.PreToolUse.push({ matcher: 'runSubagent', hooks: [{ type: 'command', command: SUBAGENT_MODEL_GATE_COMMAND }] });
            await fs.promises.writeFile(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        }

        logRuntime('Installed AskAway sub-agent model hook', { gatePath, injectPath });
    } catch (err) {
        logRuntime('Warning: Could not install AskAway sub-agent model hook', formatError(err));
    }
}

/** Persist the sentinels the budget hook reads: the soft limit + the workspaceStorage root. */
async function writeBudgetSentinels(context: vscode.ExtensionContext): Promise<void> {
    try {
        const cfgDir = path.join(os.homedir(), '.askaway');
        await fs.promises.mkdir(cfgDir, { recursive: true });
        const limit = Number(vscode.workspace.getConfiguration('askaway').get('turnBudgetAiu', 0)) || 0;
        await fs.promises.writeFile(path.join(cfgDir, 'turn-budget-aiu'), `${limit}\n`, 'utf8');
        const storage = context.storageUri?.fsPath;
        if (storage) {
            // storageUri = <...>/workspaceStorage/<hash>/<ext-id>; go up two to workspaceStorage.
            const wsRoot = path.dirname(path.dirname(storage));
            await fs.promises.writeFile(path.join(cfgDir, 'workspace-storage-root'), `${wsRoot}\n`, 'utf8');
        }
    } catch (err) {
        logRuntime('Warning: Could not write budget sentinels', formatError(err));
    }
}

/** Install the turn-budget UserPromptSubmit hook (Claude settings + Copilot hooks). */
async function ensureBudgetHookInstalled(): Promise<void> {
    const gatePath = path.join(os.homedir(), '.askaway', 'hooks', 'budget-gate.sh');
    const injectPath = path.join(os.homedir(), '.askaway', 'hooks', 'budget-inject.js');
    try {
        await fs.promises.mkdir(path.dirname(gatePath), { recursive: true });
        if (await fs.promises.readFile(gatePath, 'utf8').catch(() => undefined) !== BUDGET_GATE_SCRIPT) {
            await fs.promises.writeFile(gatePath, BUDGET_GATE_SCRIPT, 'utf8');
        }
        await fs.promises.chmod(gatePath, 0o755);
        if (await fs.promises.readFile(injectPath, 'utf8').catch(() => undefined) !== BUDGET_INJECT_SCRIPT) {
            await fs.promises.writeFile(injectPath, BUDGET_INJECT_SCRIPT, 'utf8');
        }

        // Claude Code: ~/.claude/settings.json hooks.UserPromptSubmit
        const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        await fs.promises.mkdir(path.dirname(claudeSettingsPath), { recursive: true });
        let settings: any = {};
        try { settings = JSON.parse(await fs.promises.readFile(claudeSettingsPath, 'utf8')); } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
        }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { settings = {}; }
        if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) { settings.hooks = {}; }
        if (!Array.isArray(settings.hooks.UserPromptSubmit)) { settings.hooks.UserPromptSubmit = []; }
        const hasBudget = settings.hooks.UserPromptSubmit.some((e: any) =>
            Array.isArray(e?.hooks) && e.hooks.some((h: any) => h?.command === BUDGET_GATE_COMMAND));
        if (!hasBudget) {
            settings.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: BUDGET_GATE_COMMAND }] });
            await fs.promises.writeFile(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        }

        // VS Code Copilot: ~/.copilot/hooks/budget-inject.json (best-effort — event support may vary).
        const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'budget-inject.json');
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });
        let cfg: any = {};
        try { cfg = JSON.parse(await fs.promises.readFile(copilotHookPath, 'utf8')); } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
        }
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { cfg = {}; }
        if (typeof cfg.version !== 'number') { cfg.version = 1; }
        if (!cfg.hooks || typeof cfg.hooks !== 'object' || Array.isArray(cfg.hooks)) { cfg.hooks = {}; }
        const gateAbs = path.join(os.homedir(), '.askaway', 'hooks', 'budget-gate.sh');
        cfg.hooks.UserPromptSubmit = [copilotCommandHook(gateAbs, 10)];
        await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

        logRuntime('Installed AskAway turn-budget hook', { gatePath, injectPath });
    } catch (err) {
        logRuntime('Warning: Could not install AskAway turn-budget hook', formatError(err));
    }
}


async function ensureAskAwayBuildAgentInstalled(context: vscode.ExtensionContext): Promise<void> {
    const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
    const promptsDir = path.join(userDir, 'prompts');
    const agentPath = path.join(promptsDir, ASKWAY_BUILD_AGENT_FILE);

    try {
        await fs.promises.mkdir(promptsDir, { recursive: true });
        const existing = await fs.promises.readFile(agentPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                return undefined;
            }
            throw err;
        });

        if (existing === undefined) {
            await fs.promises.writeFile(agentPath, ASKWAY_BUILD_AGENT_CONTENT, 'utf8');
            logRuntime('Installed AskAway Build user agent', { agentPath });
        } else if (existing === ASKWAY_BUILD_AGENT_CONTENT) {
            logRuntime('AskAway Build user agent already installed', { agentPath });
        } else {
            logRuntime('AskAway Build user agent exists; preserving user copy', { agentPath });
        }
    } catch (err) {
        logRuntime('Warning: Could not install AskAway Build user agent', formatError(err));
    }
}

/**
 * Copilot harness sessions (VS Code 1.140+) run ~/.copilot/hooks scripts inside the session sandbox,
 * which cannot touch ~/.askaway by default. Grant the paths the AskAway hooks use.
 */
async function ensureHookSandboxAccess(context: vscode.ExtensionContext): Promise<void> {
    try {
        const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
        const config = vscode.workspace.getConfiguration();
        const current = config.inspect<Record<string, string[]>>(SANDBOX_PATHS_SETTING)?.globalValue;
        const merged = mergeSandboxPaths(current, hookSandboxPaths(os.homedir(), userDir));
        if (!merged) {
            logRuntime('Sandbox hook access already granted');
            return;
        }
        await config.update(SANDBOX_PATHS_SETTING, merged, vscode.ConfigurationTarget.Global);
        logRuntime('Granted AskAway hooks sandbox access', merged);
    } catch (err) {
        logRuntime('Warning: Could not grant AskAway hooks sandbox access (older VS Code has no sandbox paths setting)', formatError(err));
    }
}

/** Ship the conversation hooks (active-spec context injector, compact chat capture) with the extension. */
async function ensureConversationHooksInstalled(context: vscode.ExtensionContext): Promise<void> {
    const hooksDir = path.join(os.homedir(), '.askaway', 'hooks');
    try {
        await fs.promises.mkdir(hooksDir, { recursive: true });
        for (const script of ['spec-context-inject.cjs', 'compact-chat-capture.cjs']) {
            const content = await fs.promises.readFile(context.asAbsolutePath(path.join('hooks', script)), 'utf8');
            if (await fs.promises.readFile(path.join(hooksDir, script), 'utf8').catch(() => undefined) !== content) {
                await fs.promises.writeFile(path.join(hooksDir, script), content, 'utf8');
            }
        }
        const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'conversation-context.json');
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });
        await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(conversationHooksConfig(hooksDir), null, 2)}\n`, 'utf8');
        logRuntime('Installed AskAway conversation hooks', { hooksDir, copilotHookPath });
    } catch (err) {
        logRuntime('Warning: Could not install AskAway conversation hooks', formatError(err));
    }
}

/**
 * /sk.* commands: prompt files for the Local harness, `sk-*` skills for the Copilot harness (skill names
 * cannot contain dots), commands for Claude Code. The Copilot agent copy gets any AskAway tool it lacks.
 */
async function ensureSpecKitCommandsInstalled(context: vscode.ExtensionContext): Promise<void> {
    try {
        const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
        const copilotHome = path.join(os.homedir(), '.copilot');
        const result = await installSpecKitCommands({
            promptsDir: path.join(userDir, 'prompts'),
            copilotHome,
            claudeHome: path.join(os.homedir(), '.claude'),
        });
        logRuntime('Installed AskAway Spec Kit commands', result);

        const agentPath = path.join(copilotHome, 'agents', ASKWAY_BUILD_AGENT_FILE);
        const agentText = await fs.promises.readFile(agentPath, 'utf8').catch(() => undefined);
        const tools: Array<{ toolReferenceName?: string }> = context.extension.packageJSON?.contributes?.languageModelTools ?? [];
        if (agentText !== undefined) {
            const updated = addMissingAskAwayTools(agentText, tools.map(t => t.toolReferenceName).filter((n): n is string => !!n));
            if (updated !== agentText) {
                await fs.promises.writeFile(agentPath, updated, 'utf8');
                logRuntime('Added missing AskAway tools to the Copilot harness agent', { agentPath });
            }
        }
    } catch (err) {
        logRuntime('Warning: Could not install AskAway Spec Kit commands', formatError(err));
    }
}

/**
 * Install the cowork offload assets at USER level so they work in every workspace:
 *  - the `/export-to-cowork` prompt command -> VS Code User prompts folder
 *  - `bundle.mjs` / `apply.mjs` scripts      -> ~/.askaway/cowork/
 * User edits to any file are preserved (only writes when missing or byte-identical to a prior install).
 */
async function ensureCoworkInstalled(context: vscode.ExtensionContext): Promise<void> {
    const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');
    const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
    const promptsDir = path.join(userDir, 'prompts');
    const coworkDir = path.join(os.homedir(), '.askaway', 'cowork');

    const writeIfSafe = async (filePath: string, content: string, label: string, mode?: number) => {
        const existing = await fs.promises.readFile(filePath, 'utf8').catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') { return undefined; }
            throw err;
        });
        if (existing === undefined || existing === content) {
            await fs.promises.writeFile(filePath, content, 'utf8');
            if (mode !== undefined) { await fs.promises.chmod(filePath, mode).catch(() => {}); }
            logRuntime(existing === undefined ? `Installed cowork ${label}` : `cowork ${label} up to date`, { filePath });
        } else {
            logRuntime(`cowork ${label} exists; preserving user copy`, { filePath });
        }
    };

    try {
        await fs.promises.mkdir(promptsDir, { recursive: true });
        await fs.promises.mkdir(coworkDir, { recursive: true });
        await writeIfSafe(path.join(promptsDir, 'export-to-cowork.prompt.md'), decode(COWORK_PROMPT_B64), 'command');
        await writeIfSafe(path.join(coworkDir, 'bundle.mjs'), decode(COWORK_BUNDLE_B64), 'bundle.mjs', 0o755);
        await writeIfSafe(path.join(coworkDir, 'apply.mjs'), decode(COWORK_APPLY_B64), 'apply.mjs', 0o755);
    } catch (err) {
        logRuntime('Warning: Could not install cowork assets', formatError(err));
    }
}

function hookEntryUsesCommand(entry: any, command: string): boolean {
    return Array.isArray(entry?.hooks) && entry.hooks.some((hook: any) => hook?.type === 'command' && hook?.command === command);
}

function migrateDirectRtkHookToGate(entry: any): boolean {
    if (!Array.isArray(entry?.hooks)) {
        return false;
    }

    let changed = false;
    for (const hook of entry.hooks) {
        if (hook?.type === 'command' && hook.command === 'rtk hook claude') {
            hook.command = RTK_GATE_COMMAND;
            changed = true;
        }
    }
    return changed;
}

async function ensureRtkGlobalHooksInstalled(): Promise<void> {
    const gatePath = path.join(os.homedir(), '.askaway', 'hooks', 'rtk-gate.sh');
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');

    try {
        await fs.promises.mkdir(path.dirname(gatePath), { recursive: true });
        const existingGate = await fs.promises.readFile(gatePath, 'utf8').catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                return undefined;
            }
            throw err;
        });
        if (existingGate !== RTK_GATE_SCRIPT) {
            await fs.promises.writeFile(gatePath, RTK_GATE_SCRIPT, 'utf8');
        }
        await fs.promises.chmod(gatePath, 0o755);

        await fs.promises.mkdir(path.dirname(claudeSettingsPath), { recursive: true });
        let settings: any = {};
        try {
            const rawSettings = await fs.promises.readFile(claudeSettingsPath, 'utf8');
            settings = JSON.parse(rawSettings);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }

        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            settings = {};
        }
        if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
            settings.hooks = {};
        }
        if (!Array.isArray(settings.hooks.PreToolUse)) {
            settings.hooks.PreToolUse = [];
        }

        let settingsChanged = false;
        for (const entry of settings.hooks.PreToolUse) {
            if (migrateDirectRtkHookToGate(entry)) {
                settingsChanged = true;
            }
        }

        // Prune stale AskAway gate entries whose matcher is no longer in RTK_HOOK_MATCHERS.
        // This lets the matcher list evolve (e.g. adding task/command tools) without leaving
        // orphaned entries behind from previous versions.
        const beforePrune = settings.hooks.PreToolUse.length;
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((entry: any) => {
            const isAskAwayGate = hookEntryUsesCommand(entry, RTK_GATE_COMMAND);
            if (!isAskAwayGate) {
                return true; // keep non-AskAway entries (e.g. the param logger) untouched
            }
            return RTK_HOOK_MATCHERS.includes(entry?.matcher);
        });
        if (settings.hooks.PreToolUse.length !== beforePrune) {
            settingsChanged = true;
        }

        for (const matcher of RTK_HOOK_MATCHERS) {
            const hasMatcherGate = settings.hooks.PreToolUse.some((entry: any) => entry?.matcher === matcher && hookEntryUsesCommand(entry, RTK_GATE_COMMAND));
            if (!hasMatcherGate) {
                settings.hooks.PreToolUse.push({
                    matcher,
                    hooks: [{ type: 'command', command: RTK_GATE_COMMAND }]
                });
                settingsChanged = true;
            }
        }

        if (settingsChanged) {
            await fs.promises.writeFile(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
            logRuntime('Installed AskAway RTK global hooks', { claudeSettingsPath, gatePath });
        } else {
            logRuntime('AskAway RTK global hooks already installed', { claudeSettingsPath, gatePath });
        }
    } catch (err) {
        logRuntime('Warning: Could not install AskAway RTK global hooks', formatError(err));
    }
}

/**
 * Ensure the GitHub Copilot native PreToolUse hook routes through AskAway's RTK gate.
 *
 * VS Code Copilot reads its own hook config from ~/.copilot/hooks/*.json (NOT
 * ~/.claude/settings.json). RTK ships a config that calls `rtk hook copilot`, but
 * that subcommand is a no-op in current rtk builds (it never rewrites commands).
 * `rtk hook claude` — which AskAway's gate invokes — DOES rewrite correctly and
 * emits the `hookSpecificOutput.updatedInput` shape Copilot consumes. So we point
 * every Copilot PreToolUse hook at the gate, giving consistent RTK rewriting plus
 * the sentinel toggle. Copilot has no matcher here, so the gate runs for every tool
 * and rewrites only the ones carrying a shell command.
 */
async function ensureCopilotHookInstalled(): Promise<void> {
    const gateAbsPath = failOpenCommand(path.join(os.homedir(), '.askaway', 'hooks', 'rtk-gate.sh'));
    const copilotHookPath = path.join(os.homedir(), '.copilot', 'hooks', 'rtk-rewrite.json');
    const BROKEN_CMD = 'rtk hook copilot';

    try {
        await fs.promises.mkdir(path.dirname(copilotHookPath), { recursive: true });

        let config: any = {};
        try {
            config = JSON.parse(await fs.promises.readFile(copilotHookPath, 'utf8'));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            config = {};
        }
        if (typeof config.version !== 'number') {
            config.version = 1;
        }
        if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
            config.hooks = {};
        }

        let changed = false;
        const isBrokenValue = (v: unknown): boolean => v === BROKEN_CMD;

        // `PreToolUse` array uses a single `command` string per entry.
        const upper = Array.isArray(config.hooks.PreToolUse) ? config.hooks.PreToolUse : [];
        if (upper.length === 0) {
            config.hooks.PreToolUse = [copilotCommandHook(gateAbsPath, 5)];
            changed = true;
        } else {
            for (const entry of upper) {
                if (entry && typeof entry === 'object' && (isBrokenValue(entry.command) || entry.command !== gateAbsPath)) {
                    entry.command = gateAbsPath;
                    changed = true;
                }
            }
            config.hooks.PreToolUse = upper;
        }

        // `preToolUse` array uses `bash`/`powershell` string keys per entry.
        const lower = Array.isArray(config.hooks.preToolUse) ? config.hooks.preToolUse : [];
        if (lower.length === 0) {
            config.hooks.preToolUse = [copilotShellHook(gateAbsPath, 5)];
            changed = true;
        } else {
            for (const entry of lower) {
                if (!entry || typeof entry !== 'object') {
                    continue;
                }
                if (isBrokenValue(entry.bash) || entry.bash !== gateAbsPath) {
                    entry.bash = gateAbsPath;
                    changed = true;
                }
                if (isBrokenValue(entry.powershell) || entry.powershell !== gateAbsPath) {
                    entry.powershell = gateAbsPath;
                    changed = true;
                }
            }
            config.hooks.preToolUse = lower;
        }

        if (changed) {
            await fs.promises.writeFile(copilotHookPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
            logRuntime('Routed Copilot native hook through AskAway RTK gate', { copilotHookPath, gateAbsPath });
        } else {
            logRuntime('Copilot native hook already routed through RTK gate', { copilotHookPath });
        }
    } catch (err) {
        logRuntime('Warning: Could not install Copilot RTK hook', formatError(err));
    }
}

// Memoized result for external MCP client check (only checked once per activation)
let _hasExternalMcpClientsResult: boolean | undefined;

/**
 * Check if external MCP client configs exist (Kiro, Cursor, Antigravity)
 * This indicates user has external tools that need the MCP server
 * Result is memoized to avoid repeated file system reads
 * Uses async I/O to avoid blocking the extension host thread
 */
async function hasExternalMcpClientsAsync(): Promise<boolean> {
    // Return cached result if available
    if (_hasExternalMcpClientsResult !== undefined) {
        return _hasExternalMcpClientsResult;
    }

    const configPaths = [
        path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
        path.join(os.homedir(), '.cursor', 'mcp.json'),
        path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
        path.join(os.homedir(), '.config', 'opencode', 'opencode.json')
    ];

    for (const configPath of configPaths) {
        try {
            const content = await fs.promises.readFile(configPath, 'utf8');
            const config = JSON.parse(content);
            // Check if askaway is registered (OpenCode names its section `mcp`)
            if (config.mcpServers?.[MCP_SERVER_NAME] || config.mcp?.[MCP_SERVER_NAME]) {
                _hasExternalMcpClientsResult = true;
                return true;
            }
        } catch {
            // File doesn't exist or parse error - continue to next path
        }
    }
    _hasExternalMcpClientsResult = false;
    return false;
}

/**
 * Detect installed extensions that are likely to conflict with AskAway's ask_user tool.
 * Primary known conflict is upstream TaskSync shipping the same tool name.
 */
function findConflictingTaskSyncExtension(): vscode.Extension<any> | undefined {
    const explicitIds = ['4regab.tasksync'];

    for (const id of explicitIds) {
        const ext = vscode.extensions.getExtension(id);
        if (ext) {
            return ext;
        }
    }

    return vscode.extensions.all.find(ext => {
        if (ext.id.toLowerCase() === 'intuitiv.askaway') {
            return false;
        }

        const packageJson = ext.packageJSON as { name?: string; displayName?: string } | undefined;
        const name = (packageJson?.name || '').toLowerCase();
        const displayName = (packageJson?.displayName || '').toLowerCase();
        return name === 'tasksync' || displayName === 'tasksync';
    });
}

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    activationOutputChannel = outputChannel;
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Extension activating...`);

    void ensureHookSandboxAccess(context);
    void ensureAskAwayBuildAgentInstalled(context);
    void ensureSpecKitCommandsInstalled(context);
    void ensureConversationHooksInstalled(context);
    void ensureCoworkInstalled(context);
    void ensureRtkGlobalHooksInstalled();
    void ensureCopilotHookInstalled();
    void writeBudgetSentinels(context);
    void ensureBudgetHookInstalled();
    void ensureCacheTimerHookInstalled();
    void ensureSubagentTimerHookInstalled();
    void ensureToolIoHookInstalled();
    void writeSubagentModelSentinel();
    void ensureSubagentModelHookInstalled();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('askaway.subagentModel')) { void writeSubagentModelSentinel(); }
    }));
    // Worker runtimes: Settings toggles + health gate every worker dispatch; checked now and each morning.
    setBuiltinWorkerProfilesDir(context.asAbsolutePath('worker-profiles'));
    setWorkerRuntimeGate(runtimeRefusal, sharedWorkerRuntime);
    setWorkerProfileCatalog({ builtinDir: context.asAbsolutePath('worker-profiles'), userDir: USER_PROFILES_DIR, enabled: (runtime) => getRuntimeHealth()[runtime].enabled });
    context.subscriptions.push(startRuntimeHealth(), vscode.workspace.onDidChangeConfiguration(e => {
        for (const runtime of RUNTIME_NAMES) {
            if (e.affectsConfiguration(`askaway.workers.${runtime}.enabled`)) {
                runtimeSettingChanged(runtime).catch((error) => void vscode.window.showWarningMessage(`AskAway: ${runtime} setting check failed: ${String(error?.message ?? error)}`));
            }
        }
    }));

    // Enable debug logging globally on first activation (needed for token telemetry)
    (async () => {
        try {
            const globalConfig = vscode.workspace.getConfiguration('', null);
            await globalConfig.update(
                'github.copilot.chat.agentDebugLog.fileLogging.enabled',
                true,
                vscode.ConfigurationTarget.Global
            );
            logRuntime('Debug logging enabled globally');
        } catch (err) {
            logRuntime('Warning: Could not enable debug logging', err);
        }
    })();

    const conflictingTaskSync = findConflictingTaskSyncExtension();
    if (conflictingTaskSync) {
        const conflictMessage = `AskAway detected a potential tool conflict with installed extension "${conflictingTaskSync.id}". Disable TaskSync (or AskAway) to avoid ask_user routing issues.`;
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: ${conflictMessage}`);
        vscode.window.showWarningMessage(
            conflictMessage,
            'Open Extensions'
        ).then(selection => {
            if (selection === 'Open Extensions') {
                vscode.commands.executeCommand('workbench.view.extensions');
            }
        });
    }

    try {
        // Initialize context manager for #terminal, #problems features
        logRuntime('Creating ContextManager', { type: typeof ContextManager });
        contextManager = new ContextManager();
        context.subscriptions.push({ dispose: () => contextManager?.dispose() });

        logRuntime('Creating AskAwayWebviewProvider', {
            providerType: typeof AskAwayWebviewProvider,
            viewType: AskAwayWebviewProvider?.viewType
        });
        const provider = new AskAwayWebviewProvider(context.extensionUri, context, contextManager);
        webviewProvider = provider;

        // Register the provider EARLY so sidebar loads fast
        let attentionView: vscode.WebviewView | undefined;
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(AskAwayWebviewProvider.viewType, {
                resolveWebviewView: (view, resolveContext, token) => {
                    attentionView = view;
                    view.onDidDispose(() => { if (attentionView === view) attentionView = undefined; });
                    return provider.resolveWebviewView(view, resolveContext, token);
                },
            }),
            provider
        );

        // Register VS Code LM Tools (critical for Copilot — must be early)
        logRuntime('Registering language model tools');
        const memoryProject = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || context.globalStorageUri.fsPath;
        roomFor(memoryProject).activate();
        // Webex drafts wait for the user's 👍 in AITalk; pending drafts return to the queue after a reload.
        context.subscriptions.push({ dispose: connectWebexDrafts(roomFor(memoryProject), () => currentAITalkCaller()?.recipient) });
        setWorkerPresenceLifecycle((workspace, worker, running) => roomFor(workspace).workerLifecycle(worker, running));
        let memoryReady: Promise<KnowledgeStore> | undefined;
        const getMemory = () => {
            memoryReady ??= (async () => {
                const secret = await context.secrets.get('agentmemory.token') || localMemorySecret();
                await ensureMemoryServer(undefined, secret);
                const store = new DedupKnowledgeStore(new AgentmemoryStore(memoryProject, MEMORY_SERVER_URL, secret));
                const config = vscode.workspace.getConfiguration('askaway');
                const sources = defaultMemorySources({
                    globalStorageDir: context.globalStorageUri.fsPath, workspaceStorageDir: context.storageUri?.fsPath,
                    memoryProject, userSetting: config.get<string>('userMemoryDirectory'),
                    repoSetting: config.get<string>('repoMemoryDirectory'), exists: fs.existsSync,
                });
                if (sources.length) await seedMemories(store, { marker: vscode.Uri.joinPath(context.storageUri || context.globalStorageUri, 'memory-seeded-v1').fsPath, sources });
                return store;
            })().catch(error => { memoryReady = undefined; throw error; });
            return memoryReady;
        };
        let observerReady: Promise<ValidatorObserver> | undefined;
        let validatorRuntime: OpenCodeWorkerRuntime | undefined;
        const triggers = new ValidatorTriggers(memoryProject, () => observerReady ??= getMemory().then(store => new ValidatorObserver({
            workspaceRoot: memoryProject, commentary: sharedCommentaryStore(),
            recall: async query => (await store.recall(query.text, { project: memoryProject, agentId: 'validator', spec: query.specSlug || undefined }, 20))
                .map(item => ({ id: item.id, text: item.fact.text })),
            run: validatorWorkerRun(async () => {
                const profile = validatorProfile();
                syncOpenCodeAgents([profile], path.join(os.homedir(), '.config', 'opencode', 'agents'), path.join(memoryProject, '.opencode', 'agents'));
                const shared = await sharedWorkerRuntimeReady(memoryProject);
                if (!shared.serverEndpoint) throw new Error('Validator shared OpenCode server unavailable');
                if (!validatorRuntime) {
                    validatorRuntime = new OpenCodeWorkerRuntime([profile]);
                }
                validatorRuntime.setServerEndpoint(shared.serverEndpoint);
                return validatorRuntime;
            }, memoryProject, () => String(sharedCommentaryStore().turnStarts(memoryProject).at(-1) || Date.now())),
        })).catch(error => { observerReady = undefined; throw error; }), () => readActiveSpecSlug(memoryProject),
        () => { sharedCommentaryStore().postValidator(memoryProject, { text: 'Validator trigger failed; agent flow continued.' }); },
        () => new AITalkStore(memoryProject).snapshot(true).messages);
        provider.setValidatorTurnStart((text, id) => { roomFor(memoryProject).registerAgent(); void triggers.turnStart(triggers.previousFinal(), text, id); });
        context.subscriptions.push(registerAITalkValidator(memoryProject, (text, id) => triggers.validatorCall(text, id)));
        const memory = memoryTool(getMemory, memoryProject, (query, agentId) => triggers.memoryCall(query, agentId));
        context.subscriptions.push(...registerLmToolDefinitions([asksTool(memoryProject)]));
        registerTools(context, provider, memory, validatorTool(text => askValidator(memoryProject, text), {
            workspace: memoryProject,
            enabled: () => vscode.workspace.getConfiguration('askaway').get<boolean>('validator.live', false),
            availability: () => readAvailability(memoryProject),
        }));
        const liveEnabled = () => vscode.workspace.getConfiguration('askaway').get<boolean>('validator.live', false);
        const availability = () => readAvailability(memoryProject);
        context.subscriptions.push(registerAttentionNotify({ availability: () => availability() ?? undefined, view: () => attentionView }));
        const digest = new LiveDigest(memoryProject, sharedCommentaryStore(), liveEnabled, availability);
        const watch = new CommentaryWatch(memoryProject, sharedCommentaryStore(), liveEnabled, availability,
            text => triggers.validatorCall(text));
        let liveDisposed = false;
        const checkLive = () => {
            if (liveDisposed) return;
            try { digest.check(); } catch { /* retry on the next availability poll */ }
            void watch.check().catch(() => undefined);
        };
        const attentionInitial = sharedCommentaryStore().read(memoryProject);
        const attentionSeen = new Set([...attentionInitial.items, ...(attentionInitial.validatorItems ?? [])].map(item => item.id));
        sharedCommentaryStore().onChange(state => {
            if (liveDisposed || state.workspacePath !== memoryProject) return;
            checkLive();
            for (const item of [...state.items, ...(state.validatorItems ?? [])]) {
                if (attentionSeen.has(item.id)) continue;
                attentionSeen.add(item.id);
                if (item.ts > state.clearedAt) void notifyAttention(item).catch(() => undefined);
            }
        });
        checkLive();
        const livePoll = setInterval(checkLive, 1000);
        context.subscriptions.push({ dispose: () => { liveDisposed = true; clearInterval(livePoll); } });

        // Initialize Plan Board editor (lightweight, no I/O at init)
        logRuntime('Creating PlanEditorProvider', { type: typeof PlanEditorProvider });
        planEditor = new PlanEditorProvider(context.extensionUri);
        provider.setPlanEditor(planEditor);
        context.subscriptions.push(planEditor);
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.openPlanBoard', () => planEditor?.open())
        );

        // ── Commands — registered synchronously, reference lazy-loaded services ──

        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.dumpLmTools', async () => {
                const outputPath = path.join(context.globalStorageUri.fsPath, 'lm-tools-catalog.json');
                await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
                const tools = vscode.lm.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    tags: Array.from(tool.tags || []),
                    inputSchema: tool.inputSchema ?? null
                }));
                await fs.promises.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), tools }, null, 2));
                await vscode.env.clipboard.writeText(outputPath);
                vscode.window.showInformationMessage(`AskAway LM tools catalog written to ${outputPath}`);
            })
        );

        // MCP commands
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.startMcp', async () => {
                if (mcpServer && !mcpServer.isRunning()) {
                    await mcpServer.start();
                    vscode.window.showInformationMessage('AskAway MCP Server started');
                } else if (mcpServer?.isRunning()) {
                    vscode.window.showInformationMessage('AskAway MCP Server is already running');
                }
            }),
            vscode.commands.registerCommand('askaway.restartMcp', async () => {
                if (mcpServer) { await mcpServer.restart(); }
            }),
            vscode.commands.registerCommand('askaway.showMcpConfig', async () => {
                const config = (mcpServer as any).getMcpConfig?.();
                if (!config) {
                    vscode.window.showErrorMessage('MCP server not running');
                    return;
                }
                const selected = await vscode.window.showQuickPick(
                    [
                        { label: 'Kiro', description: 'Kiro IDE', value: 'kiro' },
                        { label: 'Cursor', description: 'Cursor Editor', value: 'cursor' },
                        { label: 'Antigravity', description: 'Gemini CLI', value: 'antigravity' }
                    ],
                    { placeHolder: 'Select MCP client to configure' }
                );
                if (!selected) return;
                const cfg = config[selected.value];
                const configJson = JSON.stringify(cfg.config, null, 2);
                const message = `Add this to ${cfg.path}:\n\n${configJson}`;
                const action = await vscode.window.showInformationMessage(message, 'Copy to Clipboard', 'Open File');
                if (action === 'Copy to Clipboard') {
                    await vscode.env.clipboard.writeText(configJson);
                    vscode.window.showInformationMessage('Configuration copied to clipboard');
                } else if (action === 'Open File') {
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(cfg.path));
                }
            })
        );

        provider._pushAvailability();

        // Webex/Telegram commands (services loaded in deferred block)
        const initializeWebex = wireWebex(context, provider, outputChannel, sharedCommentaryStore(),
            (taskId, text, user) => (provider as any)._handleMessagingResponse(taskId, text, user), logRuntime, formatError);
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.getTelegramChatId', async () => {
                if (telegramServiceInstance) { await telegramServiceInstance.getChatId(); }
                else { vscode.window.showWarningMessage('Telegram service not initialized yet.'); }
            })
        );

        // ── Deferred initialization — heavy services loaded AFTER sidebar is ready ──
        setImmediate(async () => {
            let webexService: WebexServiceType | undefined;
            let webexRelay: import('./commentary/telegramLive').TelegramLiveCommentary | undefined;
            let telegramService: TelegramServiceType | undefined;
            let telegramLiveCommentary: import('./commentary/telegramLive').TelegramLiveCommentary | undefined;
            let telegramTurn: ReturnType<typeof import('./commentary/telegramLive').telegramTurnTarget> | undefined;

            // Initialize Webex independently so its failure does not block Telegram.
            ({ service: webexService, relay: webexRelay } = await initializeWebex());

            // Initialize Telegram independently so it is available even if Webex fails.
            try {
                const telegramModule = await import('./services/telegramService');
                const { TelegramService } = telegramModule;
                logRuntime('Telegram module loaded', {
                    moduleKeys: Object.keys(telegramModule),
                    ctorType: typeof TelegramService
                });

                if (typeof TelegramService !== 'function') {
                    throw new Error('TelegramService import is not a constructor function');
                }

                telegramService = new TelegramService(outputChannel);
                telegramServiceInstance = telegramService;
                telegramService.setExtensionContext(context);
                provider.setTelegramService(telegramService);
                context.subscriptions.push({ dispose: () => telegramService?.dispose() });

                context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.telegram`) && telegramService) {
                        telegramService.reloadConfig();
                    }
                }));

                const liveRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (liveRoot) {
                    const { TelegramLiveCommentary, relayCommentaryToTelegram, telegramTurnTarget } = await import('./commentary/telegramLive');
                    const liveOn = () => vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<boolean>('telegram.liveCommentary', true);
                    telegramLiveCommentary = new TelegramLiveCommentary(() => telegramService, path.basename(liveRoot), { enabled: liveOn, activity: () => provider.getTurnActivity() });
                    telegramService.setLiveTurns(liveOn);
                    telegramTurn = telegramTurnTarget(telegramLiveCommentary, () => telegramService);
                    context.subscriptions.push(relayCommentaryToTelegram(telegramLiveCommentary, sharedCommentaryStore(), liveRoot,
                        () => { telegramService?.resolveHandoffs(); webexService?.resolveHandoffs(); }));
                }
            } catch (err) {
                logRuntime('Telegram deferred init failed', formatError(err));
                console.error('[AskAway] Telegram deferred init error:', err);
                vscode.window.showWarningMessage(
                    'AskAway: Telegram service failed to initialize. Open "AskAway" output for details.',
                    'Open Output'
                ).then(selection => {
                    if (selection === 'Open Output') {
                        outputChannel.show(true);
                    }
                });
            }

            // Turn-end handoffs are independent of either transport. Initialize once both
            // optional services have had a chance to load so Telegram-only setups work.
            const storagePath = context.storageUri?.fsPath;
            if (storagePath) {
                const { HandoffNotifier, createHandoffTargets } = await import('./services/handoffNotifier');
                const debugLogsDir = path.join(path.dirname(storagePath), 'GitHub.copilot-chat', 'debug-logs');
                const notifier = new HandoffNotifier(
                    createHandoffTargets(() => webexService ? {
                        isConfigured: () => webexService!.isConfigured(),
                        postText: (...args) => webexService!.postText(...args),
                        finishTurn: async (...args) => { const ok = await webexService!.finishTurn(...args); if (ok) { webexRelay?.complete(); } return ok; }
                    } : undefined, () => telegramTurn ?? telegramService),
                    debugLogsDir,
                    logRuntime,
                    () => provider.getTurnMetricsSnapshot(),
                    (text, id) => { roomFor(memoryProject).unregisterAgent(); return triggers.turnEnd(text, id); }
                );
                notifier.start();
                context.subscriptions.push(notifier);
                logRuntime('Handoff notifier watching turn-complete stamp', { debugLogsDir });
            }

            // File change tracker for Webex/Telegram
            context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.scheme !== 'file') return;
                const relativePath = vscode.workspace.asRelativePath(e.document.uri);
                if (webexService && webexService.getActiveTaskCount() > 0) {
                    webexService.trackFileChange(relativePath);
                    webexService.notifyCopilotActivity();
                }
                if (telegramService && telegramService.getActiveTaskCount() > 0) {
                    telegramService.trackFileChange(relativePath);
                    telegramService.notifyCopilotActivity();
                }
            }));

            // MCP Server initialization should not block other services.
            try {
                mcpServer = new McpServerManager(provider, memory, createWebexSuiteHost(context.secrets, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()));
                const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
                const mcpEnabled = config.get<boolean>('mcpEnabled', false);
                const autoStartIfClients = config.get<boolean>('mcpAutoStartIfClients', true);
                if (mcpEnabled) {
                    mcpServer.start();
                } else if (autoStartIfClients) {
                    hasExternalMcpClientsAsync().then(hasClients => {
                        if (hasClients && mcpServer) { mcpServer.start(); }
                    }).catch(() => {});
                }

            } catch (err) {
                logRuntime('MCP deferred init failed', formatError(err));
                console.error('[AskAway] MCP deferred init error:', err);
            }
        });

    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Activation complete!`);
    } catch (error) {
        console.error('AskAway Activation Error:', error);
        logRuntime('Activation failed', formatError(error));
        outputChannel.appendLine(`[AskAway] CRITICAL ACTIVATION ERROR: ${error}`);
    }
}

export async function deactivate() {
    webviewProvider = undefined;

    if (mcpServer) {
        await mcpServer.dispose();
        mcpServer = undefined;
    }

    killAllGradleRuns();
}
