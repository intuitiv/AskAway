import { LifecycleRecord, OpenCodeWorkerRuntime, RunState, RunUsage } from './openCodeRuntime';

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
}

const TERMINAL: RunState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** The open command for a session that belongs to a projected worker; undefined for anything else. */
export function sessionOpenCommand(state: WorkersState, sessionId: string): string | undefined {
    if (!SESSION_ID.test(sessionId || '')) { return undefined; }
    return state.workers.find((worker) => worker.sessionId === sessionId)?.sessionOpenAction || undefined;
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

function traceEvents(runtime: OpenCodeWorkerRuntime, runId: string, facts: LifecycleRecord[]): TraceEvent[] {
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
            const preview = runtime.toolPreview(runId, fact.callId ?? '');
            stepTools.push({ kind: 'tool', id: shortId(fact.callId ?? '', `T${events.length + stepTools.length + 1}`), ts: fact.ts, tool: fact.tool ?? 'unknown',
                durMs: fact.durMs ?? 0, status: fact.status ?? 'ok', inputTokens: fact.toolTokens?.input ?? 0, outputTokens: fact.toolTokens?.output ?? 0,
                inputPreview: preview?.input ?? '', outputPreview: preview?.output ?? '' });
        }
    }
    return events.concat(stepTools);
}

/** Workers view state for one workspace. Packet, assistant text, and evidence never leave the runtime; tool previews are bounded. */
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
            events: traceEvents(runtime, run.runId, factsByRun.get(run.runId) ?? []),
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
            banner: { requests: current.usage.steps, dollars: current.usage.cost, lastIn: current.lastPromptTokens, lastCached: current.lastCachedTokens,
                turnOut: current.usage.output, lastActivityAt: current.updatedAt },
            usage: sumUsage(traces), runs: traces,
        });
    }
    workers.sort((a, b) => b.lastUpdateAt - a.lastUpdateAt);
    const endpoint = runtime.serverEndpoint;
    return { workspacePath, generatedAt: now(), server: { state: endpoint ? 'ATTACHED' : 'NOT_ATTACHED', endpoint }, workers };
}
