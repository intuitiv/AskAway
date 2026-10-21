import { LifecycleRecord, OpenCodeWorkerRuntime, RunState, RunUsage } from './openCodeRuntime';
import type { ScoreRow } from './evalScoreboard';
import { initialsOf, teamRoster, type TeamRosterEntry } from '../team/roster';

export type ProjectedWorkerState = RunState | 'RETIRED' | 'ORPHANED';

/** One row of the Metrics turn trace: the single format both the chat's and the workers' traces render. */
export type TraceEvent =
    | { kind: 'request'; id: string; ts: number; model: string; inputTokens: number; outputTokens: number; cachedTokens: number; dollars: number }
    | { kind: 'tool'; id: string; ts: number; tool: string; durMs: number; status: string; inputTokens: number; outputTokens: number; inputPreview: string; outputPreview: string };

/** Per-run header. cacheRead is the reused worker's historical input; elapsed and cost reset per run. Rows load on expand. */
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
    adapter: 'opencode' | 'agy' | 'claude';
    profile: string;
    model: string;
    thinking: string;
    sessionId: string;
    sessionOpenAction: string;
    lastUpdateAt: number;
    lastPingAt: number;
    blocker: string;
    /** Tokens the worker's next request will send; the number that drives cost and the 300K retirement. */
    nextInputTokens: number;
    /** When the idle worker's prompt cache goes cold (0 while running or never reusable). */
    cacheExpiresAt: number;
    /** Not running and no longer reusable: cache cold, retired, or orphaned. The Workers tab hides these. */
    expired: boolean;
    knowledge: string;
    /** The worker this one's session was forked from while that worker was busy; '' for a fresh worker. */
    forkedFrom: string;
    /** The orchestrator track of the worker's latest run that named one; '' when none did. */
    track: string;
    /** Same fields as the chat banner, for the worker's current (or last) run: requests, $ (null: runtime reports no cost), last in / run out, cache hit, age. */
    banner: { requests: number; dollars: number | null; lastIn: number; lastCached: number; turnOut: number; lastActivityAt: number };
    usage: RunUsage;
    /** Spend since the current chat turn started: exactly the ledger checkpoints turn_budget (usageSince) counts. */
    turnCost: number;
    runs: WorkerRunTrace[];
}

export interface TeamMemberState {
    id: string;
    name: string;
    role: string;
    profile: string;
    pinned: boolean;
    initials: string;
    avatarSrc: string;
    creativeStatus: string;
    /** Hard-coded status phrases (3 to 4 each); the card rotates through them every 8 s (webview teamStatusText). */
    statusWorking: string[];
    statusIdle: string[];
    /** The roster's own model and thinking, for "Reset model to default". */
    defaultModel?: string;
    defaultThinking?: string;
    agentFile: string;
    /** The Edit form's saved picture (absolute path); the provider turns it into a webview URI. */
    avatarFile?: string;
    model: string;
    thinking: string;
    adapter: 'opencode' | 'agy' | 'claude' | 'copilot';
    /** 'main': the selected chat agent (never owns worker tasks); 'validator': Priya; 'worker': roster experts. */
    kind?: 'main' | 'validator' | 'worker';
    /** Main agent only: its chat turn is running. */
    active?: boolean;
    taskIds: string[];
    turnCost: number;
    monthCost: number;
}

export interface WorkersState {
    workspacePath: string;
    generatedAt: number;
    server: { state: 'ATTACHED' | 'NOT_ATTACHED'; endpoint: string };
    workers: WorkerRow[];
    members: TeamMemberState[];
    /** Distinct workers that actually ran in the current chat turn, including terminal workers. */
    turnWorkerIds?: string[];
    /** Eval results by mode × model, from `~/.askaway/evals/results.jsonl`. */
    scoreboard?: ScoreRow[];
    /** The Team dropdown choices by member id, shared by every workspace (~/.askaway/team/members.json). */
    memberSettings?: Record<string, { model: string; thinking: string }>;
}

const TERMINAL: RunState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** The open command for a session that belongs to a projected worker; undefined for anything else. */
export function sessionOpenCommand(state: WorkersState, sessionId: string): string | undefined {
    if (!SESSION_ID.test(sessionId || '')) { return undefined; }
    return state.workers.find((worker) => worker.sessionId === sessionId)?.sessionOpenAction || undefined;
}

/** source 'ledger': OpenCode could not answer, so rows are the ledger's facts without tool text; reason says why. */
export interface WorkerTrace { workerId: string; source: 'opencode' | 'ledger'; reason: string; runs: Record<string, TraceEvent[]> }

/** The tab may cancel a run only before it starts, and only a run of this workspace's projection. */
export function cancelQueuedRun(runtime: OpenCodeWorkerRuntime, workspacePath: string, runId: string): { status: string; runId: string; reason?: string } {
    const run = projectWorkersState(runtime, workspacePath).workers.flatMap((w) => w.runs).find((r) => r.runId === runId);
    if (!run || !run.queuePosition || TERMINAL.includes(run.state)) { return { status: 'NOT_CANCELLABLE', runId, reason: 'only a queued run of this workspace can be cancelled here' }; }
    return runtime.cancel(runId);
}

/** A worker's trace, built only when it is expanded: its OpenCode session, else the workspace ledger's facts. */
export async function loadWorkerTrace(runtime: OpenCodeWorkerRuntime, workspacePath: string, workerId: string,
    fetchMessages: (sessionId: string) => Promise<SessionMessage[]>): Promise<WorkerTrace> {
    const worker = projectWorkersState(runtime, workspacePath).workers.find((w) => w.workerId === workerId);
    if (!worker) { return { workerId, source: 'ledger', reason: 'not a worker of this workspace', runs: {} }; }
    const fromLedger = (reason: string): WorkerTrace => {
        const runs: Record<string, TraceEvent[]> = {};
        for (const run of worker.runs) { runs[run.runId] = []; }
        const facts = runtime.facts(workspacePath).filter((fact) => fact.runId in runs);
        for (const runId of Object.keys(runs)) { runs[runId] = traceEvents(facts.filter((fact) => fact.runId === runId)); }
        return { workerId, source: 'ledger', reason, runs };
    };
    if (worker.adapter === 'agy') { return fromLedger('agy conversation: no OpenCode transcript; facts from the AskAway ledger'); }
    if (worker.adapter === 'claude') { return fromLedger('claude conversation: no OpenCode transcript; facts from the AskAway ledger'); }
    if (!SESSION_ID.test(worker.sessionId)) { return fromLedger('no OpenCode session yet'); }
    try {
        return { workerId, source: 'opencode', reason: '', runs: traceFromSession(await fetchMessages(worker.sessionId), worker.runs) };
    } catch (error) {
        return fromLedger(`OpenCode server did not answer (${(error as Error).message})`);
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

export function traceEvents(facts: LifecycleRecord[]): TraceEvent[] {
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

function matchRosterEntry(worker: WorkerRow, allEntries: TeamRosterEntry[]): TeamRosterEntry {
    // The main agent (AskAway Build / AA.Orchestrator chat mode) never owns worker tasks.
    const roster = allEntries.filter((m) => m.kind !== 'main');
    const priya = roster.find((m) => m.id === 'priya')!;
    if (worker.track === 'validator' || worker.profile === 'validator') { return priya; }
    const wid = String(worker.workerId || '').toLowerCase();
    const prof = String(worker.profile || '').toLowerCase();
    for (const entry of roster) {
        if (entry.id === prof || entry.name.toLowerCase() === prof || wid === entry.id || wid.includes(`-${entry.id}-`) || wid.startsWith(`${entry.id}-`)) {
            return entry;
        }
    }
    for (const entry of roster) {
        if (entry.profile.toLowerCase() === prof || entry.profiles.some((p) => p.toLowerCase() === prof)) {
            return entry;
        }
    }
    const aliases: Record<string, string> = { test: 'tara', pipeline: 'paolo', performance: 'pavel' };
    return roster.find(entry => entry.id === aliases[prof]) ?? roster.find(entry => entry.id === 'diego')!;
}

/** Every roster member (Priya first, then roster order, then the user's own profile members), idle ones included,
 *  each with the worker tasks it owns. The main agent row is added by the provider. */
export function projectTeamMembers(workers: WorkerRow[], roster: TeamRosterEntry[] = teamRoster()): TeamMemberState[] {
    const entries = roster.filter((m) => m.kind !== 'main');
    const ordered = [...entries.filter((m) => m.id === 'priya'), ...entries.filter((m) => m.id !== 'priya')];
    const groups = ordered.map((entry) => ({ entry, workers: [] as WorkerRow[] }));
    const byId = new Map(groups.map((group) => [group.entry.id, group]));
    for (const worker of workers) {
        byId.get(matchRosterEntry(worker, roster).id)!.workers.push(worker);
    }
    return groups.map(({ entry, workers: memberWorkers }) => {
        const first = memberWorkers[0];
        const model = first?.model || entry.model;
        const thinking = first?.thinking || entry.thinking;
        const adapter: 'opencode' | 'agy' | 'claude' = first?.adapter ? first.adapter : (model.startsWith('agy/') ? 'agy' : model.startsWith('claude/') ? 'claude' : 'opencode');
        const active = memberWorkers.some((w) => w.state === 'RUNNING' || w.state === 'STARTING' || w.state === 'WAITING_APPROVAL');
        const turnCost = memberWorkers.reduce((sum, w) => sum + w.turnCost, 0);
        const monthCost = memberWorkers.reduce((sum, w) => sum + (w.adapter === 'agy' ? 0 : w.usage.cost), 0);
        return {
            id: entry.id,
            name: entry.name,
            role: entry.role,
            profile: first?.profile || entry.profile,
            pinned: Boolean(entry.pinnedFirst || entry.id === 'priya' || entry.kind === 'validator'),
            kind: entry.kind,
            initials: initialsOf(entry.name),
            avatarSrc: '',
            creativeStatus: active ? entry.workingStatus : entry.idleStatus,
            statusWorking: entry.statusWorking.slice(),
            statusIdle: entry.statusIdle.slice(),
            defaultModel: entry.defaultModel ?? entry.model,
            defaultThinking: entry.defaultThinking ?? entry.thinking,
            agentFile: entry.agentFile,
            avatarFile: entry.avatarFile ?? '',
            model,
            thinking,
            adapter,
            taskIds: memberWorkers.map((w) => w.workerId),
            turnCost,
            monthCost,
        };
    });
}

/** Workers view state for one workspace. Packet, assistant text, and evidence never leave the runtime; trace rows load on expand.
 *  turnStartedAt: the current chat turn's start (the provider's _lastSubmitTs, as turn_budget uses); 0 means no turn yet. */
export function projectWorkersState(runtime: OpenCodeWorkerRuntime, workspacePath: string, now: () => number = Date.now, turnStartedAt = 0): WorkersState {
    const byWorker = new Map<string, ReturnType<OpenCodeWorkerRuntime['list']>>();
    for (const run of runtime.list(workspacePath)) {
        const runs = byWorker.get(run.workerId) ?? [];
        runs.push(run);
        byWorker.set(run.workerId, runs);
    }
    const workers: WorkerRow[] = [];
    const pings = new Map<string, number>();
    const turnSpend = new Map<string, number>();
    for (const fact of runtime.facts(workspacePath)) {
        if (fact.ping) pings.set(fact.workerId, Math.max(pings.get(fact.workerId) ?? 0, fact.ts));
        if (turnStartedAt && fact.ts >= turnStartedAt && fact.type === 'checkpoint' && fact.usage) {
            turnSpend.set(fact.workerId, (turnSpend.get(fact.workerId) ?? 0) + fact.usage.cost);
        }
    }
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
        }));
        const session = [...runs].reverse().find((run) => run.sessionId);
        const agy = latest.model.startsWith('agy/');
        const cacheExpiresAt = !agy && routed ? runtime.router.cacheExpiresAt(routed) : 0;
        const expired = !active && (state === 'RETIRED' || state === 'ORPHANED' || (cacheExpiresAt > 0 && now() >= cacheExpiresAt));
        const lastPingAt = agy ? 0 : (pings.get(workerId) ?? 0);
        workers.push({
            workerId, state, adapter: agy ? 'agy' : latest.model.startsWith('claude/') ? 'claude' : 'opencode', profile: latest.profile, model: latest.model, thinking: latest.thinking,
            sessionId: session?.sessionId ?? '', sessionOpenAction: session?.sessionOpenAction ?? '',
            lastUpdateAt: Math.max(...runs.map((run) => run.updatedAt)), lastPingAt, blocker,
            nextInputTokens: current.nextInputTokens || routed?.contextTokens || 0, cacheExpiresAt, expired,
            knowledge: [...runs].reverse().find((run) => run.knowledge)?.knowledge ?? '',
            forkedFrom: routed?.forkedFrom ?? runs.find((run) => run.forkedFrom)?.forkedFrom ?? '',
            track: [...runs].reverse().find((run) => run.track)?.track ?? '',
            banner: { requests: current.usage.steps, dollars: agy ? null : current.usage.cost, lastIn: current.lastPromptTokens, lastCached: current.lastCachedTokens,
                turnOut: current.usage.output, lastActivityAt: Math.max(current.updatedAt, lastPingAt) },
            usage: sumUsage(traces), turnCost: turnSpend.get(workerId) ?? 0, runs: traces,
        });
    }
    workers.sort((a, b) => Number(b.track === 'validator' || b.profile === 'validator') - Number(a.track === 'validator' || a.profile === 'validator') || b.lastUpdateAt - a.lastUpdateAt);
    const endpoint = runtime.serverEndpoint;
    return { workspacePath, generatedAt: now(), server: { state: endpoint ? 'ATTACHED' : 'NOT_ATTACHED', endpoint }, workers, members: projectTeamMembers(workers) };
}
