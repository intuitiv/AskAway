import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkerProfile } from './workerProfiles';

/**
 * Claude Code CLI as an alternate worker runtime, wired like agy: any profile selects it with `runtime: 'claude'` or a
 * model prefixed `claude/` (claude/sonnet, claude/opus, claude/haiku, or any id the CLI accepts). Unlike agy, Claude
 * reports its dollar cost and has a provider prompt cache, so its workers keep warm and expire like OpenCode workers.
 * Loaded lazily by the runtime only when a Claude run launches.
 */
export const CLAUDE_PREFIX = 'claude/';
export const CLAUDE_MODELS = ['claude/sonnet', 'claude/opus', 'claude/haiku'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MCP_SERVER = 'askaway';
/** The HTTP header that carries a Claude run's identity token to the AskAway MCP server. */
export const RUN_HEADER = 'X-AskAway-Run';

/** The AskAway MCP URL the extension registers for other clients (`~/.kiro/settings/mcp.json`), else ''. */
export function askawayMcpUrl(home = os.homedir()): string {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(home, '.kiro', 'settings', 'mcp.json'), 'utf8'));
        const url = config?.mcpServers?.[MCP_SERVER]?.url;
        return typeof url === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) ? url : '';
    } catch {
        return '';
    }
}

/**
 * The profile's edit/bash/webfetch/MCP policy as Claude tool rules, in the toAgyPermissions style: a shell that is not
 * denied may run only `rtk` commands, AskAway MCP tools are allowed by name (the worker tool only when the profile lists it; commentary only when the profile lists it, for AITalk
 * questions), and workers never spawn Claude subagents (delegation belongs to the orchestrator).
 */
export function claudeToolRules(profile: Pick<WorkerProfile, 'edit' | 'bash' | 'webfetch' | 'mcp'>): { mode: string; allowed: string[]; disallowed: string[] } {
    const allowed: string[] = [];
    // The AskAway server also serves the worker tool; a Claude worker never delegates (an `askaway_*` entry allows the whole server).
    const disallowed: string[] = ['Task', 'Agent', `mcp__${MCP_SERVER}__worker`];
    if (profile.edit === 'deny') { disallowed.push('Edit', 'Write', 'MultiEdit', 'NotebookEdit'); }
    if (profile.bash === 'deny') { disallowed.push('Bash'); } else { allowed.push('Bash(rtk:*)'); }
    if (profile.webfetch === 'deny') { disallowed.push('WebFetch'); }
    for (const entry of profile.mcp ?? []) {
        if (!entry.startsWith('askaway_')) { continue; }
        // Deprecated alias in stale in-memory profiles grants only the renamed tool.
        const tool = entry === 'askaway_commentary' ? 'aitalk' : entry.slice('askaway_'.length);
        // Like agy: the worker tool is granted only to a profile that lists it; the worker-tool guard bounds what it may start.
        const delegate = /^worker(?:_|$)/.test(tool);
        const rule = delegate ? `mcp__${MCP_SERVER}__worker` : !tool || tool === '*' ? `mcp__${MCP_SERVER}` : `mcp__${MCP_SERVER}__${tool}`;
        if (delegate) { const at = disallowed.indexOf(rule); if (at >= 0) { disallowed.splice(at, 1); } }
        if (!allowed.includes(rule)) { allowed.push(rule); }
    }
    // Headless: acceptEdits lets an editing profile write files; dontAsk denies anything not pre-approved instead of asking.
    return { mode: profile.edit === 'allow' ? 'acceptEdits' : 'dontAsk', allowed, disallowed };
}

const mcpConfigDirs = new Map<string, string>();
/** Writes a run's MCP config to a 0600 file in its own 0700 directory under the OS temp dir; removeMcpConfig deletes both. */
function writeMcpConfig(runToken: string, json: string): string {
    removeMcpConfig(runToken);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-claude-'));
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, json, { mode: 0o600 });
    mcpConfigDirs.set(runToken, dir);
    return file;
}
/** Deletes the run's MCP config file and directory; a no-op for an unknown token. */
export function removeMcpConfig(runToken: string): void {
    const dir = mcpConfigDirs.get(runToken);
    if (!dir) { return; }
    mcpConfigDirs.delete(runToken);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir that is already gone is the goal */ }
}

/** Print-mode arguments. `--flag=value` and the `--` before the message keep a message from ever being read as a flag. */
export function claudeArgs(options: { model: string; thinking: string; sessionId?: string; forkSession?: boolean; addDir?: string; message: string;
    profile?: Pick<WorkerProfile, 'edit' | 'bash' | 'webfetch' | 'mcp'>; instructions?: string; mcpUrl?: string; runToken?: string }): string[] {
    const model = options.model.startsWith(CLAUDE_PREFIX) ? options.model.slice(CLAUDE_PREFIX.length) : options.model;
    const args = ['-p', '--output-format=stream-json', '--verbose', `--model=${model}`];
    if (EFFORTS.includes(options.thinking)) { args.push(`--effort=${options.thinking}`); }
    if (options.sessionId) { args.push(`--resume=${options.sessionId}`); if (options.forkSession) { args.push('--fork-session'); } }
    if (options.addDir) { args.push(`--add-dir=${options.addDir}`); }
    const rules = claudeToolRules(options.profile ?? { edit: 'deny', bash: 'deny', webfetch: 'deny', mcp: [] });
    args.push(`--permission-mode=${rules.mode}`);
    if (rules.allowed.length) { args.push(`--allowedTools=${rules.allowed.join(',')}`); }
    args.push(`--disallowedTools=${rules.disallowed.join(',')}`);
    if (options.mcpUrl && options.profile?.mcp.length) {
        // The per-run token is the worker's identity on every tool call (the model cannot set an HTTP header); the server maps it to the run.
        const server = { type: 'http', url: options.mcpUrl, ...(options.runToken ? { headers: { [RUN_HEADER]: options.runToken } } : {}) };
        const config = JSON.stringify({ mcpServers: { [MCP_SERVER]: server } });
        // The token is a credential: it goes in a private 0600 file, never in argv (visible to every local user through `ps`).
        args.push(`--mcp-config=${options.runToken ? writeMcpConfig(options.runToken, config) : config}`, '--strict-mcp-config');
    }
    if (options.instructions) { args.push(`--append-system-prompt=${options.instructions}`); }
    args.push('--', options.message);
    return args;
}

/** `mcp__askaway__askaway_memory` -> `askaway_askaway_memory`, the `<server>_<tool>` name OpenCode facts use. */
function toolName(name: string): string {
    const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
    return mcp ? `${mcp[1]}_${mcp[2]}` : name;
}

interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number }
const tokensOf = (usage: any): Tokens => ({ input: Number(usage?.input_tokens ?? 0), output: Number(usage?.output_tokens ?? 0),
    cacheRead: Number(usage?.cache_read_input_tokens ?? 0), cacheWrite: Number(usage?.cache_creation_input_tokens ?? 0) });

/**
 * Normalizes Claude stream-json lines into the OpenCode run events the runtime already records (sessionID, text,
 * step_finish usage, tool parts, error). Claude emits one `assistant` event per content block, each repeating its
 * message's usage with output still partial; so a message is one step, flushed when the next message starts, and the
 * final `result` (whose usage and total_cost_usd are the run totals) settles the last step: the steps then sum exactly
 * to the reported totals and the run's whole cost. Anthropic input_tokens exclude cache reads and writes, as OpenCode's do.
 */
export function claudeEventNormalizer(): (event: any) => any[] {
    let session = '';
    let pending: { id: string; tokens: Tokens } | undefined;
    const sent: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const tools = new Map<string, { name: string; input: unknown }>();
    const step = (id: string, tokens: Tokens, cost = 0) => {
        for (const key of Object.keys(sent) as Array<keyof Tokens>) { sent[key] += tokens[key]; }
        return { sessionID: session, type: 'step_finish', part: { id, cost, tokens: { input: tokens.input, output: tokens.output, reasoning: 0,
            cache: { read: tokens.cacheRead, write: tokens.cacheWrite } } } };
    };
    return (event: any) => {
        session = String(event?.session_id ?? session);
        const base = session ? { sessionID: session } : {};
        const out: any[] = [base];
        if (event?.type === 'assistant') {
            const message = event.message ?? {};
            const id = String(message.id ?? '');
            if (pending && pending.id !== id) { out.push(step(pending.id, pending.tokens)); pending = undefined; }
            if (message.usage) { pending = { id, tokens: tokensOf(message.usage) }; }
            for (const block of Array.isArray(message.content) ? message.content : []) {
                if (block?.type === 'text' && String(block.text ?? '').trim()) { out.push({ ...base, type: 'text', part: { text: String(block.text) } }); }
                if (block?.type === 'tool_use') {
                    const name = toolName(String(block.name ?? 'tool'));
                    tools.set(String(block.id), { name, input: block.input });
                    out.push({ ...base, part: { tool: name, callID: String(block.id), state: { status: 'running' } } });
                }
            }
        } else if (event?.type === 'user') {
            for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
                if (block?.type !== 'tool_result') { continue; }
                const call = tools.get(String(block.tool_use_id)) ?? { name: 'tool', input: undefined };
                const output = Array.isArray(block.content) ? block.content.map((c: any) => String(c?.text ?? '')).join('\n') : String(block.content ?? '');
                out.push({ ...base, part: { tool: call.name, callID: String(block.tool_use_id), state: { status: block.is_error ? 'error' : 'completed', input: call.input, output } } });
            }
        } else if (event?.type === 'result') {
            // The last (unflushed) message's step is the run total minus the flushed steps, plus the run's reported cost.
            const total = tokensOf(event.usage);
            const rest: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
            for (const key of Object.keys(rest) as Array<keyof Tokens>) { rest[key] = Math.max(0, total[key] - sent[key]); }
            const cost = Number(event.total_cost_usd ?? 0);
            if (pending || cost > 0 || Object.values(rest).some((n) => n > 0)) {
                out.push(step(pending?.id || `result-${session}`, rest, cost));
                pending = undefined;
            }
            if (typeof event.result === 'string' && event.result.trim()) { out.push({ ...base, type: 'text', part: { text: event.result } }); }
            if (event.is_error || (event.subtype && event.subtype !== 'success')) {
                const detail = typeof event.result === 'string' && event.result.trim() ? `: ${event.result.trim()}` : '';
                out.push({ ...base, type: 'error', error: { message: `claude ${String(event.subtype ?? 'error')}${detail}` } });
            }
        }
        return out;
    };
}
