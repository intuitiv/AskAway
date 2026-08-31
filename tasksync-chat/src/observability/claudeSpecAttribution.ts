import * as fs from 'fs';
import * as path from 'path';

export const CLAUDE_COMMAND_STAGES = ['new', 'start', 'continue', 'plan', 'tasks', 'check', 'implement', 'handoff', 'review'] as const;

export interface ClaudeSpecEvent {
    provider: 'claude';
    event: 'submit' | 'stop';
    ts: number;
    sessionId: string;
    promptId: string;
    transcriptPath: string;
    cwd: string;
    prompt?: string;
    specSlug: string;
    taskId: string;
    cycleId: string;
    commandStage: string;
    branch: string;
}

export interface ClaudeTurnUsage {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWrite5mTokens: number;
    cacheWrite1hTokens: number;
    cacheMisses: number;
    estimatedUsd: number;
    models: string[];
    activeMs: number;
}

export interface ClaudeTurnBoundary {
    submit: ClaudeSpecEvent;
    stop?: ClaudeSpecEvent;
    endTs: number;
    specSlug: string;
}

export function commandSwitchesSpec(commandStage: string): boolean {
    return commandStage === 'new' || commandStage === 'start' || commandStage === 'continue';
}

export function pairClaudeTurns(events: ClaudeSpecEvent[]): ClaudeTurnBoundary[] {
    const ordered = [...events].sort((a, b) => a.ts - b.ts);
    const turns: ClaudeTurnBoundary[] = [];
    for (let index = 0; index < ordered.length; index++) {
        const submit = ordered[index];
        if (submit.event !== 'submit') { continue; }
        const nextSubmit = ordered.find((event, candidate) => candidate > index && event.event === 'submit' && event.sessionId === submit.sessionId);
        const stops = ordered.filter((event, candidate) => candidate > index && event.event === 'stop' && event.sessionId === submit.sessionId && (!nextSubmit || event.ts < nextSubmit.ts));
        const stop = stops[stops.length - 1];
        turns.push({
            submit,
            stop,
            endTs: stop?.ts || nextSubmit?.ts || Number.POSITIVE_INFINITY,
            specSlug: commandSwitchesSpec(submit.commandStage) && stop?.specSlug ? stop.specSlug : submit.specSlug
        });
    }
    return turns;
}

export function parseClaudeCommand(prompt: string): Pick<ClaudeSpecEvent, 'commandStage' | 'taskId' | 'cycleId'> {
    const trimmed = prompt.trim();
    const command = /^\/(?:sk\.)?(new|start|continue|plan|tasks|check|implement|handoff|review)\b/i.exec(trimmed)?.[1]?.toLowerCase() || 'other';
    const taskId = (/\/(?:sk\.)?implement\s+(T\d+[a-zA-Z]*)\b/i.exec(trimmed)?.[1] || '').toUpperCase();
    const cycleId = (/\/(?:sk\.)?implement\s+(CY-\d+)\b/i.exec(trimmed)?.[1] || '').toUpperCase();
    return { commandStage: command, taskId, cycleId };
}

function findWorkspaceRoot(cwd: string): string {
    let current = path.resolve(cwd);
    while (true) {
        if (fs.existsSync(path.join(current, '.specify', 'feature.json')) || fs.existsSync(path.join(current, '.git'))) { return current; }
        const parent = path.dirname(current);
        if (parent === current) { return path.resolve(cwd); }
        current = parent;
    }
}

function readActiveSpec(root: string): string {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(root, '.specify', 'feature.json'), 'utf8')) as { feature_directory?: string };
        const value = String(parsed.feature_directory || '').replace(/\\/g, '/').replace(/\/+$/, '');
        return path.posix.basename(value);
    } catch { return ''; }
}

function readBranch(root: string): string {
    try {
        let gitDir = path.join(root, '.git');
        if (fs.statSync(gitDir).isFile()) {
            const pointer = /^gitdir:\s*(.+)$/i.exec(fs.readFileSync(gitDir, 'utf8').trim());
            if (!pointer) { return ''; }
            gitDir = path.resolve(root, pointer[1]);
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : (head ? `detached:${head.slice(0, 7)}` : '');
    } catch { return ''; }
}

export function createClaudeSpecEvent(payload: Record<string, unknown>, now = Date.now()): ClaudeSpecEvent | undefined {
    if (payload.agent_id || (payload.hook_event_name !== 'UserPromptSubmit' && payload.hook_event_name !== 'Stop')) { return undefined; }
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
    if (!cwd || !sessionId || !transcriptPath) { return undefined; }
    const event = payload.hook_event_name === 'Stop' ? 'stop' : 'submit';
    const prompt = event === 'submit' && typeof payload.prompt === 'string' ? payload.prompt : '';
    const parsed = parseClaudeCommand(prompt);
    const root = findWorkspaceRoot(cwd);
    return {
        provider: 'claude', event, ts: now, sessionId,
        promptId: typeof payload.prompt_id === 'string' ? payload.prompt_id : '',
        transcriptPath, cwd: root, prompt, specSlug: readActiveSpec(root),
        taskId: parsed.taskId, cycleId: parsed.cycleId, commandStage: parsed.commandStage,
        branch: readBranch(root)
    };
}

function modelRates(model: string, speed: string): [number, number] | undefined {
    const value = model.toLowerCase();
    if (value.includes('fable') || value.includes('mythos')) { return [10, 50]; }
    if (value.includes('opus-4-1') || /opus-4(?:$|[-_.]0)/.test(value)) { return [15, 75]; }
    if (value.includes('opus')) { return speed === 'fast' ? [10, 50] : [5, 25]; }
    if (value.includes('sonnet-5')) { return [2, 10]; }
    if (value.includes('sonnet')) { return [3, 15]; }
    if (value.includes('haiku-3-5')) { return [0.8, 4]; }
    if (value.includes('haiku')) { return [1, 5]; }
    return undefined;
}

export function parseClaudeUsage(jsonlFiles: string[], startMs: number, endMs = Number.POSITIVE_INFINITY): ClaudeTurnUsage {
    const seen = new Set<string>();
    const models = new Set<string>();
    const result: ClaudeTurnUsage = {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheMisses: 0,
        estimatedUsd: 0,
        models: [],
        activeMs: 0
    };
    for (const jsonl of jsonlFiles) {
        for (const line of jsonl.split('\n')) {
            if (!line || line.indexOf('"usage"') < 0) { continue; }
            let row: any;
            try { row = JSON.parse(line); } catch { continue; }
            if (row.type !== 'assistant' || row.isApiErrorMessage) { continue; }
            const ts = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number(row.ts);
            if (!Number.isFinite(ts) || ts < startMs || ts >= endMs) { continue; }
            const requestId = String(row.requestId || row.message?.id || '');
            if (!requestId || seen.has(requestId)) { continue; }
            const usage = row.message?.usage;
            if (!usage || typeof usage !== 'object') { continue; }
            seen.add(requestId);
            const input = Number(usage.input_tokens) || 0;
            const output = Number(usage.output_tokens) || 0;
            const cached = Number(usage.cache_read_input_tokens) || 0;
            const writes = usage.cache_creation || {};
            const write5m = Number(writes.ephemeral_5m_input_tokens) || 0;
            const write1h = Number(writes.ephemeral_1h_input_tokens) || 0;
            const unclassifiedWrite = Math.max(0, (Number(usage.cache_creation_input_tokens) || 0) - write5m - write1h);
            const model = String(row.message?.model || 'unknown');
            const rates = modelRates(model, String(usage.speed || row.message?.speed || ''));
            const geoMultiplier = usage.inference_geo === 'us' ? 1.1 : 1;
            const webSearches = Number(usage.server_tool_use?.web_search_requests) || 0;
            if (rates) {
                const [inputRate, outputRate] = rates;
                result.estimatedUsd += geoMultiplier * (
                    input * inputRate +
                    (write5m + unclassifiedWrite) * inputRate * 1.25 +
                    write1h * inputRate * 2 +
                    cached * inputRate * 0.1 +
                    output * outputRate
                ) / 1_000_000 + webSearches * 0.01;
            }
            result.requestCount++;
            result.inputTokens += input + cached + write5m + write1h + unclassifiedWrite;
            result.outputTokens += output;
            result.cachedTokens += cached;
            result.cacheWrite5mTokens += write5m + unclassifiedWrite;
            result.cacheWrite1hTokens += write1h;
            if (cached < (input + cached + write5m + write1h + unclassifiedWrite) * 0.5) { result.cacheMisses++; }
            result.activeMs = Math.max(result.activeMs, ts - startMs);
            models.add(model);
        }
    }
    result.models = [...models].sort();
    return result;
}