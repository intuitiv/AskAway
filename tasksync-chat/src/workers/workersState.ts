import { OpenCodeWorkerRuntime, RunState, RunUsage } from './openCodeRuntime';

export type ProjectedWorkerState = RunState | 'RETIRED' | 'ORPHANED';

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
    contextTokens: number;
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

/** Workers view state for one workspace. Carries identities, states, and numbers only, never packet or transcript text. */
export function projectWorkersState(runtime: OpenCodeWorkerRuntime, workspacePath: string, now: () => number = Date.now): WorkersState {
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
        const latest = runs[runs.length - 1];
        const active = runs.find((run) => run.queuePosition === 0 && !TERMINAL.includes(run.state));
        const current = active ?? latest;
        const state: ProjectedWorkerState = routed?.state === 'RETIRED' || routed?.state === 'ORPHANED' ? routed.state : current.state;
        const blocker = state === 'RETIRED' ? `retired: ${routed?.retiredReason ?? 'unknown reason'}`
            : state === 'ORPHANED' ? 'orphaned: no owning runtime'
            : state === 'WAITING_APPROVAL' ? 'waiting for approval in OpenCode'
            : state === 'FAILED' ? current.reason ?? 'failed'
            : '';
        const traces: WorkerRunTrace[] = runs.map((run) => ({
            runId: run.runId, state: run.state, dispatchTurnId: run.dispatchTurnId, queuePosition: run.queuePosition,
            startedAt: run.startedAt, endedAt: run.endedAt, elapsedMs: run.elapsedMs, usage: { ...run.usage }, reason: run.reason ?? '',
        }));
        const session = [...runs].reverse().find((run) => run.sessionId);
        workers.push({
            workerId, state, adapter: 'opencode', profile: latest.profile, model: latest.model, thinking: latest.thinking,
            sessionId: session?.sessionId ?? '', sessionOpenAction: session?.sessionOpenAction ?? '',
            lastUpdateAt: Math.max(...runs.map((run) => run.updatedAt)), blocker,
            contextTokens: latest.contextTokens, usage: sumUsage(traces), runs: traces,
        });
    }
    workers.sort((a, b) => b.lastUpdateAt - a.lastUpdateAt);
    const endpoint = runtime.serverEndpoint;
    return { workspacePath, generatedAt: now(), server: { state: endpoint ? 'ATTACHED' : 'NOT_ATTACHED', endpoint }, workers };
}
