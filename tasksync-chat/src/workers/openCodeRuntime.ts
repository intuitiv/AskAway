import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkerProfile } from './workerProfiles';
import { RouteResult, WorkerRouter } from './workerRouter';

export const MAX_WAIT_SECONDS = 240;
const MAX_EVIDENCE_LINES = 25;

export type RunState = 'STARTING' | 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type LifecycleType = 'start' | 'message_update' | 'before_tool' | 'after_tool' | 'checkpoint' | 'approval' | 'stop' | 'error';

export interface RunUsage { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; cost: number; steps: number }

/** A lifecycle fact. It carries identities, tool names, and usage numbers, never message or transcript text. */
export interface LifecycleRecord {
    ts: number;
    type: LifecycleType;
    workspace: string;
    workerId: string;
    runId: string;
    sessionId: string;
    dispatchTurnId: string;
    source: string;
    profile: string;
    model: string;
    thinking: string;
    tool?: string;
    /** OpenCode part id of a step, or call id of a tool. */
    callId?: string;
    durMs?: number;
    status?: string;
    /** Estimated tokens (chars / 4) of a tool's input and output. */
    toolTokens?: { input: number; output: number };
    usage?: RunUsage;
    exitCode?: number;
    state?: RunState;
    reason?: string;
}

export interface WorkerPacket {
    workspacePath: string;
    profile: string;
    model?: string;
    thinking?: string;
    dispatchTurnId: string;
    baseRevision: string;
    objective: string;
    allowedFiles: string[];
    acceptance: string;
    expected: string;
    command: string;
    estimatedSeconds?: number;
}

export interface RunView {
    runId: string;
    workerId: string;
    sessionId: string;
    state: RunState;
    profile: string;
    model: string;
    thinking: string;
    dispatchTurnId: string;
    startedAt: number;
    endedAt?: number;
    updatedAt: number;
    elapsedMs: number;
    usage: RunUsage;
    queuePosition: number;
    reason?: string;
    /** What the worker's next model request will send: last prompt (input + cache) plus last output. */
    nextInputTokens: number;
    /** Full prompt of the last model request (input + cache) and how much of it was a cache hit. */
    lastPromptTokens: number;
    lastCachedTokens: number;
    /** The worker's own one-line summary of the context it holds, for reuse decisions. */
    knowledge: string;
}

export interface ChildLike {
    stdout: NodeJS.ReadableStream | null;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    kill(signal?: NodeJS.Signals): boolean;
}

export type Spawner = (args: string[]) => ChildLike;

export interface RuntimeOptions {
    ledgerDir?: string;
    now?: () => number;
    spawner?: Spawner;
    attachUrl?: string;
}

interface RunRecord extends RunView {
    workspace: string;
    packet: string;
    evidence: string[];
    child?: ChildLike;
    waiters: Array<() => void>;
}

const REQUIRED: Array<keyof WorkerPacket> = ['workspacePath', 'profile', 'dispatchTurnId', 'baseRevision', 'objective', 'acceptance', 'expected', 'command'];
const PLACEHOLDER = /\bTBD\b|\bTODO\b|<required[^>]*>|\?\?\?/i;
export const CREDENTIAL = /\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|\bsqu_[A-Za-z0-9]{20,}|\d{8,}:[A-Za-z0-9_-]{30,}/;

/** Rejects packets that a worker could not execute from the packet alone, or that would leak a credential. */
export function validatePacket(packet: WorkerPacket): string {
    for (const field of REQUIRED) {
        const value = packet[field];
        if (value === undefined || String(value).trim() === '') { return `missing ${field}`; }
    }
    const text = JSON.stringify(packet);
    if (PLACEHOLDER.test(text)) { return 'packet contains an unresolved placeholder'; }
    if (CREDENTIAL.test(text)) { return 'packet contains a credential'; }
    return '';
}

export function renderPacket(packet: WorkerPacket): string {
    return [
        `Objective: ${packet.objective}`,
        `Base revision: ${packet.baseRevision}`,
        `Allowed files: ${packet.allowedFiles.length ? packet.allowedFiles.join(', ') : 'none (read-only)'}`,
        `Acceptance: ${packet.acceptance}`,
        `Expected result: ${packet.expected}`,
        `Verification command: ${packet.command}`,
        'Finish with: Result: PASS|FAIL|BLOCKED, Evidence: <exact line>, Not done: <list or none>, Knowledge: <up to 25 words on the code and context you now hold, so later packets can reuse you>.',
    ].join('\n');
}

function workspaceKey(workspace: string): string {
    return workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function canonical(workspace: string): string {
    try { return fs.realpathSync(workspace); } catch { return workspace; }
}

function emptyUsage(): RunUsage {
    return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 };
}

// Worker stderr goes to a per-run file: it never enters the caller's context, but remains for diagnosis.
const defaultSpawner: Spawner = (args) => {
    fs.mkdirSync('/tmp/aa', { recursive: true });
    const title = args[args.indexOf('--title') + 1] || 'run';
    const stderr = fs.openSync(path.join('/tmp/aa', `${title.replace(/[^a-zA-Z0-9-]+/g, '_')}.err`), 'a');
    return childProcess.spawn('opencode', args, { stdio: ['ignore', 'pipe', stderr] });
};

/** Runs AskAway worker packets as OpenCode sessions and records their lifecycle and real provider usage. */
export class OpenCodeWorkerRuntime {
    readonly router: WorkerRouter;
    private readonly runs = new Map<string, RunRecord>();
    private readonly sessionsByWorker = new Map<string, string>();
    private readonly rehydrated = new Set<string>();
    private readonly adopted = new Map<string, { workspace: string; profile: string; model: string; thinking: string; sessionId: string; contextTokens: number; lastTs: number }>();
    private readonly ledgerDir: string;
    private readonly now: () => number;
    private readonly spawner: Spawner;
    private attachUrl?: string;

    constructor(profiles: WorkerProfile[], options: RuntimeOptions = {}) {
        this.now = options.now ?? Date.now;
        this.router = new WorkerRouter(profiles, { now: this.now });
        this.ledgerDir = options.ledgerDir ?? path.join(os.homedir(), '.askaway', 'worker-ledger');
        this.spawner = options.spawner ?? defaultSpawner;
        this.attachUrl = options.attachUrl;
    }

    /** The shared OpenCode server workers attach to; empty when each run hosts its own. */
    get serverEndpoint(): string {
        return this.attachUrl ?? '';
    }

    /** Later launches attach to this server instead of hosting their own. */
    setServerEndpoint(url: string): void {
        this.attachUrl = url || undefined;
    }

    start(packet: WorkerPacket): RunView | { status: 'SELECTION_UNAVAILABLE' | 'INELIGIBLE'; reason: string } {
        const invalid = validatePacket(packet);
        if (invalid) { return { status: 'INELIGIBLE', reason: invalid }; }
        const workspace = canonical(packet.workspacePath);
        const routed = this.router.route({ workspacePath: workspace, profile: packet.profile, model: packet.model, thinking: packet.thinking,
            packetId: packet.objective.slice(0, 40), estimatedSeconds: packet.estimatedSeconds ?? 60 });
        if (routed.status === 'SELECTION_UNAVAILABLE') { return routed; }
        return this.admit(routed, workspace, packet);
    }

    submit(workerId: string, packet: WorkerPacket): RunView | { status: 'RETIRED' | 'INELIGIBLE'; workerId?: string; reason: string } {
        const invalid = validatePacket(packet);
        if (invalid) { return { status: 'INELIGIBLE', workerId, reason: invalid }; }
        const routed = this.router.submitTo(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60);
        if (!('runId' in routed)) {
            return { status: routed.status === 'RETIRED' ? 'RETIRED' : 'INELIGIBLE', workerId, reason: routed.reason };
        }
        return this.admit(routed, canonical(packet.workspacePath), packet);
    }

    status(runId: string): RunView | undefined {
        const run = this.runs.get(runId);
        return run ? this.view(run) : undefined;
    }

    list(workspacePath: string): Array<RunView & { sessionOpenAction: string; contextTokens: number; workerState: string }> {
        const workspace = canonical(workspacePath);
        return [...this.runs.values()]
            .filter((run) => run.workspace === workspace)
            .map((run) => {
                const worker = this.router.worker(run.workerId);
                return { ...this.view(run), contextTokens: worker?.contextTokens ?? 0, workerState: worker?.state ?? 'UNKNOWN',
                    sessionOpenAction: !run.sessionId ? '' : this.attachUrl
                        ? `opencode attach ${this.attachUrl} --session ${run.sessionId}` : `opencode --session ${run.sessionId}` };
            });
    }

    /** Waits at most 240 seconds; reaching the ceiling is a normal STILL_RUNNING result, not a failure. */
    async wait(runId: string, timeoutSeconds = MAX_WAIT_SECONDS): Promise<
        | { status: 'COMPLETED'; runId: string; evidence: string[] }
        | { status: 'FAILED' | 'CANCELLED'; runId: string; reason: string }
        | { status: 'STILL_RUNNING'; runId: string; workerId: string; state: RunState; waitedSeconds: number }
        | { status: 'UNKNOWN_RUN'; runId: string }> {
        const run = this.runs.get(runId);
        if (!run) { return { status: 'UNKNOWN_RUN', runId }; }
        const bound = Math.min(Math.max(0, timeoutSeconds), MAX_WAIT_SECONDS);
        const started = this.now();
        if (!this.terminal(run.state)) {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, bound * 1000);
                run.waiters.push(() => { clearTimeout(timer); resolve(); });
            });
        }
        if (run.state === 'COMPLETED') { return { status: 'COMPLETED', runId, evidence: run.evidence }; }
        if (run.state === 'FAILED' || run.state === 'CANCELLED') { return { status: run.state, runId, reason: run.reason ?? run.state.toLowerCase() }; }
        return { status: 'STILL_RUNNING', runId, workerId: run.workerId, state: run.state, waitedSeconds: Math.round((this.now() - started) / 1000) };
    }

    cancel(runId: string): { status: 'CANCELLATION_REQUESTED' | 'NOT_CANCELLABLE'; runId: string; reason?: string } {
        const run = this.runs.get(runId);
        if (!run || this.terminal(run.state)) { return { status: 'NOT_CANCELLABLE', runId, reason: run ? `already ${run.state}` : 'unknown run' }; }
        if (run.queuePosition > 0) {
            this.router.cancelQueued(run.workerId, runId);
            this.finish(run, 'CANCELLED', 'cancelled before start');
        } else {
            run.reason = 'cancelled by caller';
            run.child?.kill('SIGTERM');
        }
        return { status: 'CANCELLATION_REQUESTED', runId };
    }

    /** Resume continues a run's OpenCode session; without a session or on a retired worker a fresh submission is required. */
    resume(runId: string): RunView | { status: 'FRESH_SUBMISSION_REQUIRED'; runId: string; reason: string } {
        const run = this.runs.get(runId);
        const worker = run ? this.router.worker(run.workerId) : undefined;
        if (!run || !worker) { return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'unknown run' }; }
        if (worker.state === 'RETIRED' || worker.state === 'ORPHANED') {
            return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: worker.retiredReason ?? `worker ${worker.state.toLowerCase()}` };
        }
        if (!run.sessionId) { return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'no OpenCode session to resume' }; }
        if (!this.terminal(run.state)) { return this.view(run); }
        if (run.state === 'COMPLETED') { return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'run already completed' }; }
        run.state = 'STARTING';
        run.endedAt = undefined;
        run.reason = undefined;
        this.launch(run, 'Continue the previous packet from where it stopped and finish it.');
        return this.view(run);
    }

    /** Lifecycle facts for a run. Text is never included. */
    logs(runId: string): LifecycleRecord[] {
        const run = this.runs.get(runId);
        if (!run) { return []; }
        return this.readLedger(run.workspace).filter((record) => record.runId === runId);
    }

    /** Every lifecycle fact of a workspace, in the order they happened. */
    facts(workspacePath: string): LifecycleRecord[] {
        return this.readLedger(canonical(workspacePath));
    }

    /**
     * Restores this workspace's workers and runs from the ledger after a reload. A worker reconnects only when the
     * shared server is live and it has a recorded session; otherwise it is ORPHANED with the reason. Safe to call again:
     * once the server is up, server-orphaned workers reconnect.
     */
    rehydrate(workspacePath: string, serverLive: boolean): { reconnected: string[]; orphaned: Array<{ workerId: string; reason: string }> } {
        const workspace = canonical(workspacePath);
        if (!this.rehydrated.has(workspace)) {
            this.rehydrated.add(workspace);
            this.restoreRuns(workspace);
        }
        const result = { reconnected: [] as string[], orphaned: [] as Array<{ workerId: string; reason: string }> };
        for (const [workerId, adopted] of this.adopted) {
            if (adopted.workspace !== workspace) { continue; }
            const reason = !serverLive ? 'shared OpenCode server not reachable after reload'
                : !adopted.sessionId ? 'no OpenCode session was recorded before reload' : '';
            this.router.adopt({ workerId, workspacePath: workspace, profile: adopted.profile, model: adopted.model, thinking: adopted.thinking,
                contextTokens: adopted.contextTokens, lastActivityAt: adopted.lastTs }, reason ? 'ORPHANED' : 'IDLE', reason || undefined);
            if (reason) { result.orphaned.push({ workerId, reason }); } else {
                this.sessionsByWorker.set(workerId, adopted.sessionId);
                result.reconnected.push(workerId);
            }
        }
        return result;
    }

    private restoreRuns(workspace: string): void {
        const byRun = new Map<string, LifecycleRecord[]>();
        for (const record of this.readLedger(workspace)) {
            // IDs without a host segment predate host-unique IDs and are ambiguous across reloads.
            if (/^run-\d+$/.test(record.runId) || this.runs.has(record.runId)) { continue; }
            const records = byRun.get(record.runId) ?? [];
            records.push(record);
            byRun.set(record.runId, records);
        }
        for (const [runId, records] of byRun) {
            const first = records[0];
            const last = records[records.length - 1];
            const usage = emptyUsage();
            let contextTokens = 0;
            let lastPromptTokens = 0;
            let lastCachedTokens = 0;
            for (const record of records) {
                if (record.type !== 'checkpoint' || !record.usage) { continue; }
                for (const key of Object.keys(usage) as Array<keyof RunUsage>) { usage[key] += record.usage[key]; }
                lastPromptTokens = record.usage.input + record.usage.cacheRead + record.usage.cacheWrite;
                lastCachedTokens = record.usage.cacheRead;
                contextTokens = lastPromptTokens + record.usage.output;
            }
            const sessionId = [...records].reverse().find((record) => record.sessionId)?.sessionId ?? '';
            const ended = last.exitCode !== undefined;
            const state: RunState = ended ? last.state ?? (last.type === 'stop' ? 'COMPLETED' : 'FAILED') : 'FAILED';
            const reason = ended ? last.reason ?? (state === 'COMPLETED' ? undefined : `exit code ${last.exitCode}`)
                : 'interrupted by reload; worker_resume continues its session';
            this.runs.set(runId, {
                runId, workerId: first.workerId, sessionId, state, profile: first.profile, model: first.model, thinking: first.thinking,
                dispatchTurnId: first.dispatchTurnId, startedAt: first.ts, endedAt: last.ts, updatedAt: last.ts, elapsedMs: last.ts - first.ts,
                usage, queuePosition: 0, reason, workspace, packet: '', evidence: [], waiters: [], nextInputTokens: contextTokens, knowledge: '',
                lastPromptTokens, lastCachedTokens,
            });
            const adopted = this.adopted.get(first.workerId);
            if (!adopted || last.ts >= adopted.lastTs) {
                this.adopted.set(first.workerId, { workspace, profile: first.profile, model: first.model, thinking: first.thinking,
                    sessionId: sessionId || adopted?.sessionId || '', contextTokens: contextTokens || adopted?.contextTokens || 0, lastTs: last.ts });
            }
        }
    }

    /** Worker usage grouped by the main-agent turn that dispatched it. */
    usageByTurn(workspacePath: string): Record<string, RunUsage & { runs: number; source: string }> {
        const totals: Record<string, RunUsage & { runs: number; source: string }> = {};
        const counted = new Set<string>();
        for (const record of this.readLedger(canonical(workspacePath))) {
            if (record.type !== 'checkpoint' || !record.usage) { continue; }
            const bucket = totals[record.dispatchTurnId] ??= { ...emptyUsage(), runs: 0, source: record.source };
            for (const key of Object.keys(record.usage) as Array<keyof RunUsage>) { bucket[key] += record.usage[key]; }
            if (!counted.has(record.runId)) { counted.add(record.runId); bucket.runs++; }
        }
        return totals;
    }

    private admit(routed: Extract<RouteResult, { runId: string }>, workspace: string, packet: WorkerPacket): RunView {
        const run: RunRecord = {
            runId: routed.runId, workerId: routed.workerId, sessionId: this.sessionsByWorker.get(routed.workerId) ?? '',
            state: 'STARTING', profile: packet.profile, model: routed.model, thinking: routed.thinking,
            dispatchTurnId: packet.dispatchTurnId, startedAt: this.now(), updatedAt: this.now(), elapsedMs: 0, usage: emptyUsage(),
            queuePosition: routed.queuePosition, workspace, packet: renderPacket(packet), evidence: [], waiters: [],
            nextInputTokens: this.router.worker(routed.workerId)?.contextTokens ?? 0, knowledge: '', lastPromptTokens: 0, lastCachedTokens: 0,
        };
        this.runs.set(run.runId, run);
        if (routed.queuePosition === 0) { this.launch(run, run.packet); }
        return this.view(run);
    }

    private launch(run: RunRecord, message: string): void {
        run.queuePosition = 0;
        run.startedAt = this.now();
        const sessionId = this.sessionsByWorker.get(run.workerId) || run.sessionId;
        // --print-logs is required: without it `opencode run` is SIGKILLed after ~14s.
        const args = ['run', '--print-logs', '--log-level', 'ERROR', '--format', 'json', '--agent', `aa-${run.profile}`,
            '--model', run.model, '--variant', run.thinking, '--dir', run.workspace, '--title', `${run.workerId}/${run.runId}`];
        if (sessionId) { args.push('--session', sessionId); }
        if (this.attachUrl) { args.push('--attach', this.attachUrl); }
        args.push(message);
        const child = this.spawner(args);
        run.child = child;
        let buffer = '';
        let lastText = '';
        let started = false;
        child.stdout?.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                let event: any;
                try { event = JSON.parse(line); } catch { continue; }
                if (event?.sessionID && !run.sessionId) {
                    run.sessionId = event.sessionID;
                    this.sessionsByWorker.set(run.workerId, event.sessionID);
                }
                if (!started) { started = true; run.state = 'RUNNING'; this.record(run, { type: 'start' }); }
                const part = event?.part ?? {};
                if (event?.type === 'text' && part.text) {
                    lastText = String(part.text);
                    this.record(run, { type: 'message_update' });
                } else if (event?.type === 'step_finish') {
                    const tokens = part.tokens ?? {};
                    const usage: RunUsage = { input: tokens.input ?? 0, output: tokens.output ?? 0, reasoning: tokens.reasoning ?? 0,
                        cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0, cost: part.cost ?? 0, steps: 1 };
                    for (const key of Object.keys(usage) as Array<keyof RunUsage>) { run.usage[key] += usage[key]; }
                    run.nextInputTokens = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
                    run.lastPromptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
                    run.lastCachedTokens = usage.cacheRead;
                    this.record(run, { type: 'checkpoint', usage, callId: part.id ? String(part.id) : undefined });
                } else if (/permission/i.test(String(event?.type))) {
                    run.state = 'WAITING_APPROVAL';
                    this.record(run, { type: 'approval' });
                } else if (event?.type === 'error') {
                    run.reason = 'provider or tool error';
                    this.record(run, { type: 'error' });
                } else if (part.tool) {
                    const status = String(part.state?.status ?? '');
                    const callId = String(part.callID ?? part.id ?? '');
                    if (status !== 'completed' && status !== 'error') {
                        this.record(run, { type: 'before_tool', tool: String(part.tool), callId });
                    } else {
                        const input = JSON.stringify(part.state?.input ?? {});
                        const output = String(part.state?.output ?? part.state?.error ?? '');
                        const time = part.state?.time ?? {};
                        this.record(run, { type: 'after_tool', tool: String(part.tool), callId, status: status === 'error' ? 'error' : 'ok',
                            durMs: time.start && time.end ? time.end - time.start : undefined,
                            toolTokens: { input: Math.ceil(input.length / 4), output: Math.ceil(output.length / 4) } });
                    }
                }
            }
        });
        child.on('exit', (code, signal) => {
            run.evidence = lastText.trim().split('\n').slice(-MAX_EVIDENCE_LINES);
            const worker = this.router.worker(run.workerId);
            this.router.complete(run.workerId, run.runId, { contextTokens: run.nextInputTokens || worker?.contextTokens || 0 });
            const knowledge = [...run.evidence].reverse().find((line) => /^\W*Knowledge:/i.test(line));
            if (knowledge) { run.knowledge = knowledge.replace(/^\W*Knowledge:\s*/i, '').slice(0, 200); }
            const cancelled = run.reason === 'cancelled by caller';
            // The packet contract requires a Result/Evidence report; a silent exit 0 proves nothing.
            const silent = code === 0 && !signal && !cancelled && run.evidence.join('').trim() === '';
            if (silent) { run.reason = 'worker ended without a report (no Result/Evidence text)'; }
            const state: RunState = cancelled ? 'CANCELLED' : code === 0 && !signal && !silent ? 'COMPLETED' : 'FAILED';
            if (state === 'FAILED' && !run.reason) { run.reason = signal ? `terminated by ${signal}` : `exit code ${code}`; }
            this.record(run, { type: state === 'COMPLETED' ? 'stop' : 'error', exitCode: code ?? -1, state, reason: run.reason });
            this.finish(run, state, run.reason);
            const next = worker?.active;
            if (next) {
                const queued = this.runs.get(next.runId);
                if (queued && queued.state === 'STARTING') { this.launch(queued, queued.packet); }
            }
        });
    }

    private finish(run: RunRecord, state: RunState, reason?: string): void {
        run.state = state;
        run.reason = reason;
        run.endedAt = this.now();
        run.updatedAt = run.endedAt;
        for (const waiter of run.waiters.splice(0)) { waiter(); }
    }

    private terminal(state: RunState): boolean {
        return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
    }

    private view(run: RunRecord): RunView {
        const { runId, workerId, sessionId, state, profile, model, thinking, dispatchTurnId, startedAt, endedAt, updatedAt, usage, queuePosition, reason, nextInputTokens, knowledge, lastPromptTokens, lastCachedTokens } = run;
        return { runId, workerId, sessionId, state, profile, model, thinking, dispatchTurnId, startedAt, endedAt, updatedAt, nextInputTokens, knowledge, lastPromptTokens, lastCachedTokens,
            elapsedMs: (endedAt ?? this.now()) - startedAt, usage: { ...usage }, queuePosition, reason };
    }

    private record(run: RunRecord, fact: Pick<LifecycleRecord, 'type'> & Partial<LifecycleRecord>): void {
        const record: LifecycleRecord = {
            ts: this.now(), workspace: run.workspace, workerId: run.workerId, runId: run.runId, sessionId: run.sessionId,
            dispatchTurnId: run.dispatchTurnId, source: run.model.split('/')[0] || 'unknown',
            profile: run.profile, model: run.model, thinking: run.thinking, ...fact,
        };
        run.updatedAt = record.ts;
        fs.mkdirSync(this.ledgerDir, { recursive: true });
        fs.appendFileSync(path.join(this.ledgerDir, `${workspaceKey(run.workspace)}.jsonl`), `${JSON.stringify(record)}\n`);
    }

    private readLedger(workspace: string): LifecycleRecord[] {
        const file = path.join(this.ledgerDir, `${workspaceKey(workspace)}.jsonl`);
        const records: LifecycleRecord[] = [];
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch { return records; }
        for (const line of text.split('\n')) {
            if (!line) { continue; }
            try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
        }
        return records;
    }
}
