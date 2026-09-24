import { LifecycleRecord, OpenCodeWorkerRuntime, RunState, RunUsage } from './openCodeRuntime';
import type { ScoreRow } from './evalScoreboard';

export type ProjectedWorkerState = RunState | 'RETIRED' | 'ORPHANED';

/** One row of the Metrics turn trace: the single format both the chat's and the workers' traces render. */
export type TraceEvent =
    | { kind: 'request'; id: string; ts: number; model: string; inputTokens: number; outputTokens: number; cachedTokens: number; dollars: number }
    | { kind: 'tool'; id: string; ts: number; tool: string; durMs: number; status: string; inputTokens: number; outputTokens: number; inputPreview: string; outputPreview: string };

/** Per-run trace. cacheRead is the reused worker's historical input; elapsed and cost reset per run. */
export interface WorkerRunTrace {
    runId: string;
    state: RunState;
    dispatchTurnId: string;
    queuePosition: number;
    startedAt: number;
    endedAt?: number;
    elapsedMs: number;
    usage: RunUsage;
    reason: string;
    events: TraceEvent[];
}

export interface WorkerRow {
    workerId: string;
    state: ProjectedWorkerState;
    adapter: 'opencode';
    profile: string;
    model: string;
    thinking: string;
    sessionId: string;
    sessionOpenAction: string;
    lastUpdateAt: number;
    blocker: string;
    /** Tokens the worker's next request will send; the number that drives cost and the 300K retirement. */
    nextInputTokens: number;
    /** When the idle worker's prompt cache goes cold (0 while running or never reusable). */
    cacheExpiresAt: number;
    /** Not running and no longer reusable: cache cold or retired. The Workers tab hides these. */
    expired: boolean;
    knowledge: string;
    /** The orchestrator track of the worker's latest run that named one; '' when none did. */
    track: string;
    /** Same fields as the chat banner, for the worker's current (or last) run: requests, $, last in / run out, cache hit, age. */
    banner: { requests: number; dollars: number; lastIn: number; lastCached: number; turnOut: number; lastActivityAt: number };
    usage: RunUsage;
    runs: WorkerRunTrace[];
}

export interface WorkersState {
    workspacePath: string;
    generatedAt: number;
    server: { state: 'ATTACHED' | 'NOT_ATTACHED'; endpoint: string };
    workers: WorkerRow[];
    /** Eval results by mode × model, from `~/.askaway/evals/results.jsonl`. */
    scoreboard?: ScoreRow[];
}

const TERMINAL: RunState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** The open command for a session that belongs to a projected worker; undefined for anything else. */
export function sessionOpenCommand(state: WorkersState, sessionId: string): string | undefined {
    if (!SESSION_ID.test(sessionId || '')) { return undefined; }
    return state.workers.find((worker) => worker.sessionId === sessionId)?.sessionOpenAction || undefined;
}

export interface WorkerTrace { workerId: string; source: 'opencode' | 'unavailable'; reason: string; runs: Record<string, TraceEvent[]> }

/** The tab may cancel a run only before it starts, and only a run of this workspace's projection. */
export function cancelQueuedRun(runtime: OpenCodeWorkerRuntime, workspacePath: string, runId: string): { status: string; runId: string; reason?: string } {
    const run = projectWorkersState(runtime, workspacePath).workers.flatMap((w) => w.runs).find((r) => r.runId === runId);
    if (!run || !run.queuePosition || TERMINAL.includes(run.state)) { return { status: 'NOT_CANCELLABLE', runId, reason: 'only a queued run of this workspace can be cancelled here' }; }
    return runtime.cancel(runId);
}

/** A projected worker's full trace, read from its OpenCode session. */
export async function loadWorkerTrace(state: WorkersState, workerId: string, fetchMessages: (sessionId: string) => Promise<SessionMessage[]>): Promise<WorkerTrace> {
    const worker = state.workers.find((w) => w.workerId === workerId);
    if (!worker || !SESSION_ID.test(worker.sessionId)) { return { workerId, source: 'unavailable', reason: 'no OpenCode session yet', runs: {} }; }
    try {
        return { workerId, source: 'opencode', reason: '', runs: traceFromSession(await fetchMessages(worker.sessionId), worker.runs) };
    } catch (error) {
        return { workerId, source: 'unavailable', reason: `OpenCode server did not answer (${(error as Error).message})`, runs: {} };
    }
}

function sumUsage(runs: WorkerRunTrace[]): RunUsage {
    const total: RunUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 };
    for (const run of runs) {
        for (const key of Object.keys(total) as Array<keyof RunUsage>) { total[key] += run.usage[key]; }
    }
    return total;
}

/** A short display ID like the Metrics trace's, stable for the same OpenCode part. */
function shortId(value: string, fallback: string): string {
    const tail = String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(-5).toUpperCase();
    return tail || fallback;
}

function traceEvents(facts: LifecycleRecord[]): TraceEvent[] {
    const events: TraceEvent[] = [];
    // A step's usage arrives after its tools ran; like the Metrics trace, the request row leads its tools.
    let stepTools: TraceEvent[] = [];
    for (const fact of facts) {
        if (fact.type === 'checkpoint' && fact.usage) {
            const u = fact.usage;
            events.push({ kind: 'request', id: shortId(fact.callId ?? '', `S${events.length + 1}`), ts: fact.ts, model: fact.model.split('/').pop() || fact.model,
                inputTokens: u.input + u.cacheRead + u.cacheWrite, outputTokens: u.output, cachedTokens: u.cacheRead, dollars: u.cost }, ...stepTools);
            stepTools = [];
        } else if (fact.type === 'after_tool') {
            stepTools.push({ kind: 'tool', id: shortId(fact.callId ?? '', `T${events.length + stepTools.length + 1}`), ts: fact.ts, tool: fact.tool ?? 'unknown',
                durMs: fact.durMs ?? 0, status: fact.status ?? 'ok', inputTokens: fact.toolTokens?.input ?? 0, outputTokens: fact.toolTokens?.output ?? 0,
                inputPreview: '', outputPreview: '' });
        }
    }
    return events.concat(stepTools);
}

const TRACE_TEXT_CHARS = 8000;

/** One OpenCode `/session/:id/message` entry, reduced to the fields the trace reads. */
export interface SessionMessage {
    info: { role: string; modelID?: string; time?: { created?: number } };
    parts: Array<{ type: string; id?: string; callID?: string; tool?: string; cost?: number;
        tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
        state?: { status?: string; input?: unknown; output?: unknown; error?: unknown; time?: { start?: number; end?: number } } }>;
}

/**
 * The worker's conversation as Metrics trace events, split by run. OpenCode owns the transcript, so this reads it
 * from the shared server; each message belongs to the latest run that started before it.
 */
export function traceFromSession(messages: SessionMessage[], runs: Array<{ runId: string; startedAt: number; queuePosition?: number; reason?: string }>): Record<string, TraceEvent[]> {
    const byRun: Record<string, TraceEvent[]> = {};
    for (const run of runs) { byRun[run.runId] = []; }
    // A queued run's startedAt is its admission time; it owns nothing until it launches.
    const ordered = runs.filter((run) => !run.queuePosition && run.reason !== 'cancelled before start').sort((a, b) => a.startedAt - b.startedAt);
    for (const message of messages) {
        if (message.info.role !== 'assistant') { continue; }
        const created = message.info.time?.created ?? 0;
        const owner = [...ordered].reverse().find((run) => run.startedAt <= created) ?? ordered[0];
        if (!owner) { break; }
        const events = byRun[owner.runId];
        let stepTools: TraceEvent[] = [];
        for (const part of message.parts) {
            if (part.type === 'tool') {
                const state = part.state ?? {};
                const input = JSON.stringify(state.input ?? {});
                const output = String(state.output ?? state.error ?? '');
                const status = state.status === 'completed' ? 'ok' : String(state.status ?? 'unknown');
                stepTools.push({ kind: 'tool', id: shortId(part.callID ?? part.id ?? '', `T${events.length + stepTools.length + 1}`), ts: state.time?.end ?? created,
                    tool: part.tool ?? 'unknown', durMs: state.time?.start && state.time?.end ? state.time.end - state.time.start : 0, status,
                    inputTokens: Math.ceil(input.length / 4), outputTokens: Math.ceil(output.length / 4),
                    inputPreview: input.slice(0, TRACE_TEXT_CHARS), outputPreview: output.slice(0, TRACE_TEXT_CHARS) });
            } else if (part.type === 'step-finish') {
                const t = part.tokens ?? {};
                const cached = t.cache?.read ?? 0;
                events.push({ kind: 'request', id: shortId(part.id ?? '', `S${events.length + 1}`), ts: created, model: message.info.modelID ?? 'unknown',
                    inputTokens: (t.input ?? 0) + cached + (t.cache?.write ?? 0), outputTokens: t.output ?? 0, cachedTokens: cached, dollars: part.cost ?? 0 }, ...stepTools);
                stepTools = [];
            }
        }
        events.push(...stepTools);
    }
    return byRun;
}

/** Workers view state for one workspace. Packet, assistant text, and evidence never leave the runtime; tool text comes from OpenCode on expand. */
export function projectWorkersState(runtime: OpenCodeWorkerRuntime, workspacePath: string, now: () => number = Date.now): WorkersState {
    const factsByRun = new Map<string, LifecycleRecord[]>();
    for (const fact of runtime.facts(workspacePath)) {
        const list = factsByRun.get(fact.runId) ?? [];
        list.push(fact);
        factsByRun.set(fact.runId, list);
    }
    const byWorker = new Map<string, ReturnType<OpenCodeWorkerRuntime['list']>>();
    for (const run of runtime.list(workspacePath)) {
        const runs = byWorker.get(run.workerId) ?? [];
        runs.push(run);
        byWorker.set(run.workerId, runs);
    }
    const workers: WorkerRow[] = [];
    for (const [workerId, runs] of byWorker) {
        runs.sort((a, b) => a.startedAt - b.startedAt);
        const routed = runtime.router.worker(workerId);
        // A queue entry cancelled before it started never ran, so it does not define the worker's state.
        const latest = [...runs].reverse().find((run) => run.reason !== 'cancelled before start') ?? runs[runs.length - 1];
        const active = runs.find((run) => run.queuePosition === 0 && !TERMINAL.includes(run.state));
        const current = active ?? latest;
        const state: ProjectedWorkerState = routed?.state === 'RETIRED' || routed?.state === 'ORPHANED' ? routed.state : current.state;
        const blocker = state === 'RETIRED' ? `retired: ${routed?.retiredReason ?? 'unknown reason'}`
            : state === 'ORPHANED' ? `orphaned: ${routed?.retiredReason ?? 'no owning runtime'}`
            : state === 'WAITING_APPROVAL' ? 'waiting for approval in OpenCode'
            : state === 'FAILED' ? current.reason ?? 'failed'
            : '';
        const traces: WorkerRunTrace[] = runs.map((run) => ({
            runId: run.runId, state: run.state, dispatchTurnId: run.dispatchTurnId, queuePosition: run.queuePosition,
            startedAt: run.startedAt, endedAt: run.endedAt, elapsedMs: run.elapsedMs, usage: { ...run.usage }, reason: run.reason ?? '',
            events: traceEvents(factsByRun.get(run.runId) ?? []),
        }));
        const session = [...runs].reverse().find((run) => run.sessionId);
        const cacheExpiresAt = routed ? runtime.router.cacheExpiresAt(routed) : 0;
        const expired = !active && (state === 'RETIRED' || (cacheExpiresAt > 0 && now() >= cacheExpiresAt));
        workers.push({
            workerId, state, adapter: 'opencode', profile: latest.profile, model: latest.model, thinking: latest.thinking,
            sessionId: session?.sessionId ?? '', sessionOpenAction: session?.sessionOpenAction ?? '',
            lastUpdateAt: Math.max(...runs.map((run) => run.updatedAt)), blocker,
            nextInputTokens: current.nextInputTokens || routed?.contextTokens || 0, cacheExpiresAt, expired,
            knowledge: [...runs].reverse().find((run) => run.knowledge)?.knowledge ?? '',
            track: [...runs].reverse().find((run) => run.track)?.track ?? '',
            banner: { requests: current.usage.steps, dollars: current.usage.cost, lastIn: current.lastPromptTokens, lastCached: current.lastCachedTokens,
                turnOut: current.usage.output, lastActivityAt: current.updatedAt },
            usage: sumUsage(traces), runs: traces,
        });
    }
    workers.sort((a, b) => b.lastUpdateAt - a.lastUpdateAt);
    const endpoint = runtime.serverEndpoint;
    return { workspacePath, generatedAt: now(), server: { state: endpoint ? 'ATTACHED' : 'NOT_ATTACHED', endpoint }, workers };
}
