import * as childProcess from 'child_process';
import { AGY_PREFIX, type ChildLike } from './openCodeRuntime';

/**
 * agy (Antigravity CLI) as an alternate worker runtime. agy is the runtime, its models (e.g. gemini-4-argon-medium) are
 * models: any profile selects it with `runtime: 'agy'` or a model prefixed `agy/`. OpenCode stays the default.
 * Loaded lazily by the runtime only when an agy run launches.
 */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MAX_VERIFY_ROUNDS = 3;
export const VERIFY_TIMEOUT_MS = 300_000;
export const VERIFY_PROMPT_TAIL_CHARS = 4000;
export const VERIFY_FACT_TAIL_CHARS = 1500;

/**
 * Print-mode arguments. Policy boundary: by default agy keeps its own review mode, where headless agy auto-denies any
 * command or MCP call that no `permissions.allow` rule in its settings.json grants. `--dangerously-skip-permissions` is
 * added only for a run whose packet explicitly opted in (`agyPermissions: 'skip'`). `--flag=value` keeps a message from
 * ever being read as a flag.
 */
export function agyArgs(options: { model: string; thinking: string; conversationId?: string; addDir?: string; message: string; skipPermissions?: boolean }): string[] {
    const model = options.model.slice(AGY_PREFIX.length);
    const args = [`--print=${options.message}`, '--output-format=stream-json', `--model=${model}`, '--mode=accept-edits', '--disable-slash-commands'];
    // A model whose name carries its effort (gemini-4-argon-high) keeps it; otherwise the profile thinking maps to --effort.
    if (EFFORTS.includes(options.thinking) && !/-(low|medium|high)$/.test(model)) { args.push(`--effort=${options.thinking}`); }
    if (options.conversationId) { args.push(`--conversation=${options.conversationId}`); }
    // Without a workspace agy reports "initialized without an active workspace" and cannot use its file tools.
    if (options.addDir) { args.push(`--add-dir=${options.addDir}`); }
    if (options.skipPermissions) { args.push('--dangerously-skip-permissions'); }
    return args;
}

/** Resume message sent once when agy soft-denies a terminal command under company review policy. */
export function deniedContinueMessage(command: string): string {
    return `Terminal commands are blocked for you by company policy. Continue with file tools only. The supervisor runs \`${command}\` after you finish and sends you the output.`;
}

/** Resume message sent when the supervisor's verification command exits non-zero. */
export function verifyFailureMessage(output: string): string {
    const tail = output.slice(-VERIFY_PROMPT_TAIL_CHARS);
    return tail ? `${tail}\n\nThis check failed; fix it with file tools and report.` : 'This check failed; fix it with file tools and report.';
}

/** Splits a simple command string into argv tokens on whitespace, respecting single and double quotes. */
export function splitCommandArgv(command: string): string[] {
    const argv: string[] = [];
    let current = '';
    let quote: '"' | "'" | '' = '';
    let hasToken = false;
    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (quote) {
            if (ch === quote) { quote = ''; }
            else if (ch === '\\' && quote === '"' && i + 1 < command.length) { current += command[++i]; }
            else { current += ch; }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            hasToken = true;
        } else if (/\s/.test(ch)) {
            if (hasToken) { argv.push(current); current = ''; hasToken = false; }
        } else {
            current += ch;
            hasToken = true;
        }
    }
    if (hasToken) { argv.push(current); }
    return argv;
}

/** Runs the packet verification command directly (no shell) in the task workspace with a 5-minute timeout. */
export function runVerifyCommand(command: string, cwd: string, timeoutMs = VERIFY_TIMEOUT_MS, onSpawn?: (child: ChildLike) => void): Promise<{ exitCode: number; output: string }> {
    const argv = splitCommandArgv(command.trim());
    if (!argv.length) { return Promise.resolve({ exitCode: 1, output: 'empty verification command' }); }
    return new Promise((resolve) => {
        let out = '';
        let timedOut = false;
        let settled = false;
        const finish = (exitCode: number, extra = '') => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            resolve({ exitCode, output: (out + extra).trimEnd() });
        };
        let child: childProcess.ChildProcess;
        try {
            child = childProcess.spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
        } catch (error) {
            finish(1, (error as Error).message);
            return;
        }
        onSpawn?.(child);
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, timeoutMs);
        timer.unref?.();
        child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
        child.stderr?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
        child.on('error', (error) => finish(1, (error as Error).message));
        child.on('close', (code, signal) => {
            if (timedOut) { finish(124, `\nverification command timed out after ${Math.round(timeoutMs / 1000)}s`); }
            else { finish(code ?? (signal ? 1 : 0)); }
        });
    });
}

/**
 * Normalizes agy stream-json lines into the OpenCode run events the runtime already records (sessionID, text,
 * step_finish usage, tool parts, error), plus `denied` for actions headless agy auto-denied (`result.denied_actions`).
 * Usage is per model request (step); `result.usage` is their sum and is never counted again. agy's input_tokens exclude
 * cache reads (a step reports cache_read > input with total = input + output), so both map raw. agy reports no cost.
 * Stateful per process: agent text deltas accumulate per step.
 */
export function agyEventNormalizer(): (event: any) => any[] {
    let conversation = '';
    const text = new Map<number, string>();
    const toolsSeen = new Set<number>();
    return (event: any) => {
        const step = event?.step_update ?? {};
        conversation = String(event?.conversation_id ?? event?.init?.conversation_id ?? step.conversation_id ?? event?.result?.conversation_id ?? conversation);
        const base = conversation ? { sessionID: conversation } : {};
        const out: any[] = [base];
        if (event?.event === 'step_update') {
            const index = Number(step.step_index ?? 0);
            const state = String(step.state ?? '');
            if (step.text_delta) { text.set(index, (text.get(index) ?? '') + String(step.text_delta)); }
            if (step.step_type === 'agent_response' || step.step_type === 'planner_response') {
                if (state === 'DONE' && text.get(index)?.trim()) { out.push({ ...base, type: 'text', part: { text: text.get(index) } }); }
            } else if (step.step_type === 'tool') {
                const info = step.tool_info ?? {};
                const name = String(step.tool_name ?? info.name ?? step.step_type);
                // An MCP call names its server and tool, like OpenCode's `<server>_<tool>` names.
                const tool = name === 'call_mcp_tool' && info.parameters?.ServerName ? `${info.parameters.ServerName}_${info.parameters.ToolName}` : name;
                const done = state === 'DONE' || /ERROR|FAIL|CANCEL/i.test(state);
                if (!done && !toolsSeen.has(index)) { toolsSeen.add(index); out.push({ ...base, part: { tool, callID: `step-${index}`, state: { status: 'running' } } }); }
                if (done) {
                    const ms = Math.round(Number(step.duration_seconds ?? 0) * 1000);
                    out.push({ ...base, part: { tool, callID: `step-${index}`, state: { status: state === 'DONE' ? 'completed' : 'error', input: info.parameters, output: info.output, time: ms ? { start: 1, end: 1 + ms } : {} } } });
                }
            }
            if (step.usage) {
                const usage = step.usage;
                out.push({ ...base, type: 'step_finish', part: { id: `step-${index}`, tokens: { input: Number(usage.input_tokens ?? 0),
                    output: Number(usage.output_tokens ?? 0), reasoning: Number(usage.thinking_tokens ?? 0), cache: { read: Number(usage.cache_read_tokens ?? 0), write: 0 } } } });
            }
        } else if (event?.event === 'result') {
            const result = event.result ?? {};
            if (result.response) { out.push({ ...base, type: 'text', part: { text: String(result.response) } }); }
            const denied = (Array.isArray(result.denied_actions) ? result.denied_actions : []).map((action: any) => String(action?.action ?? 'unknown'));
            if (denied.length) { out.push({ ...base, type: 'denied', actions: [...new Set(denied)] }); }
            if (result.status && result.status !== 'SUCCESS') { out.push({ ...base, type: 'error', error: { message: `agy ${String(result.status).toLowerCase()}${result.error ? `: ${String(result.error.message ?? result.error)}` : ''}` } }); }
        } else if (event?.event === 'error' || event?.error) {
            out.push({ ...base, type: 'error', error: { message: String(event.error?.message ?? event.error ?? event.message ?? 'agy error') } });
        }
        return out;
    };
}
