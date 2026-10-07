import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkerProfile } from './workerProfiles';
import type { KeepWarmWorker } from './keepWarm';
import { KEEP_WARM_PROMPT, MAX_PARALLEL_WORKERS, RouteResult, WorkerRouter } from './workerRouter';

export const MAX_WAIT_SECONDS = 240;
/** A run whose process emitted no event this long after spawn is STALLED (OpenCode is silent on a session/directory mismatch). */
export const STALL_AFTER_SECONDS = 60;
const MAX_EVIDENCE_LINES = 25;

export type RunState = 'STARTING' | 'RUNNING' | 'STALLED' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type LifecycleType = 'start' | 'message_update' | 'before_tool' | 'after_tool' | 'checkpoint' | 'approval' | 'stop' | 'error' | 'archive' | 'fork';

export interface RunUsage { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; cost: number; steps: number }

/** A lifecycle fact. It carries identities, tool names, and usage numbers, never message or transcript text. */
export interface LifecycleRecord {
    ts: number;
    type: LifecycleType;
    /** The owner workspace (dispatching window). */
    workspace: string;
    /** Directory OpenCode ran in, recorded only when it differs from the owner. */
    cwd?: string;
    workerId: string;
    runId: string;
    sessionId: string;
    dispatchTurnId: string;
    source: string;
    track?: string;
    /** Set on every fact of a worker that was forked from a busy one: the parent's worker id. */
    forkedFrom?: string;
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
    /** The spawned OpenCode process and its run directory, on the start fact written at spawn. */
    pid?: number;
    dir?: string;
    /** A keep-warm ping's checkpoint: a real request that only refreshed the prompt cache. */
    ping?: boolean;
}

export interface WorkerPacket {
    /** The OWNER: the dispatching window's workspace. Keys the ledger, Workers tab, banner and spend. */
    workspacePath: string;
    /** Where OpenCode runs (e.g. a git worktree of the owner); defaults to the owner. */
    cwd?: string;
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
    /** The orchestrator's track this packet belongs to (e.g. "A"); the Workers tab groups by it. */
    track?: string;
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
    track: string;
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
    /** Set when the packet asked for a thinking the reused worker does not have: it keeps its own (e.g. "thinking: medium (worker's)"). */
    thinkingNote?: string;
    /** Parent worker id when this run's worker was forked from a busy one. */
    forkedFrom?: string;
}

export interface ChildLike {
    pid?: number;
    stdout: NodeJS.ReadableStream | null;
    stderr?: NodeJS.ReadableStream | null;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    kill(signal?: NodeJS.Signals): boolean;
}

export type Spawner = (args: string[]) => ChildLike;

/** Forks an OpenCode session at its last completed message and returns the new session's id. */
export type ForkSession = (sessionId: string) => Promise<{ sessionId: string }>;

export interface RuntimeOptions {
    ledgerDir?: string;
    now?: () => number;
    spawner?: Spawner;
    attachUrl?: string;
    /** Defaults to the shared server's HTTP API at the attach URL; tests inject a fake. */
    forkSession?: ForkSession;
    /** One-shot timer for the stall detector; tests inject a manual one. Returns its canceller. */
    setTimer?: (fire: () => void, ms: number) => () => void;
}

interface RunRecord extends RunView {
    workspace: string;
    cwd: string;
    packet: string;
    evidence: string[];
    child?: ChildLike;
    waiters: Array<() => void>;
    autoResumes?: number;
}

interface ServerMessage { info: { id: string; role: string; parentID?: string; time?: { completed?: number } } }

/**
 * Forks a session through the shared OpenCode server (`POST /session/:id/fork`). The body's `messageID` is exclusive, so a
 * session that is mid-answer is cut at the user message of its unfinished reply: the fork keeps every completed message
 * and never copies the partial one. Errors carry the HTTP status only, never a response body.
 */
export async function forkSessionViaServer(baseUrl: string, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<{ sessionId: string }> {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) { throw new Error('invalid session id'); }
    const call = async (method: string, route: string, body?: unknown): Promise<any> => {
        const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${route}`, {
            method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(FORK_HTTP_TIMEOUT_MS),
        });
        if (!res.ok) { throw new Error(`${method} ${route.replace(sessionId, ':id')} -> HTTP ${res.status}`); }
        const text = await res.text();
        return text ? JSON.parse(text) : undefined;
    };
    const messages: ServerMessage[] = await call('GET', `/session/${sessionId}/message`);
    const unfinished = messages.find((m) => m.info.role === 'assistant' && !m.info.time?.completed);
    const last = messages[messages.length - 1];
    const cut = unfinished ? (messages.some((m) => m.info.id === unfinished.info.parentID) ? unfinished.info.parentID : unfinished.info.id)
        : last?.info.role === 'user' ? last.info.id : undefined;
    if ((cut ? messages.findIndex((m) => m.info.id === cut) : messages.length) <= 0) { throw new Error('no completed message to fork from yet'); }
    const fork = await call('POST', `/session/${sessionId}/fork`, cut ? { messageID: cut } : {});
    if (!fork?.id) { throw new Error('fork returned no session id'); }
    return { sessionId: String(fork.id) };
}


const MAX_AUTO_RESUMES = 2;
const FORK_HTTP_TIMEOUT_MS = 15000;
const PING_HTTP_TIMEOUT_MS = 60000;
const UNFINISHED_FEEDBACK = 'You stopped before finishing the packet. Continue from where you stopped, run the verification command, '
    + 'and end with the required report including a `Result: PASS | FAIL | BLOCKED` line.';

/** Feedback for a worker whose command was auto-rejected, so it adapts instead of the run dying. */
export function rejectionFeedback(rejected: string[]): string {
    return `These commands were auto-rejected (headless run, not in the allowlist): ${rejected.join('; ')}. Do not retry them. `
        + 'Read files with your read/grep/glob tools. Run shell commands only as ONE simple command prefixed with `rtk ` '
        + '(no cd, &&, |, ; or redirects). Continue the packet from where you stopped and finish it with the required report.';
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

/** The directory OpenCode runs a packet in: its cwd, else the owner workspace. Session reuse is keyed by it. */
function runDir(packet: WorkerPacket): string {
    return canonical(packet.cwd || packet.workspacePath);
}

function workspaceKey(workspace: string): string {
    return workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function canonical(workspace: string): string {
    try { return fs.realpathSync(workspace); } catch { return workspace; }
}

const worktreeCache = new Map<string, { at: number; paths: string[] }>();

/** Other git worktrees of `workspace` (`git worktree list --porcelain`), cached 30s; empty when not a git repo. */
function worktreesOf(workspace: string): string[] {
    const cached = worktreeCache.get(workspace);
    if (cached && Date.now() - cached.at < 30_000) { return cached.paths; }
    let paths: string[] = [];
    try {
        const out = childProcess.execFileSync('git', ['-C', workspace, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
        paths = out.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => canonical(line.slice('worktree '.length).trim()))
            .filter((dir) => dir !== workspace);
    } catch { /* not a git repo or git missing */ }
    worktreeCache.set(workspace, { at: Date.now(), paths });
    return paths;
}

function emptyUsage(): RunUsage {
    return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 };
}

// Worker stderr is also kept in a per-run file: it never enters the caller's context, but remains for diagnosis.
const defaultSpawner: Spawner = (args) => {
    fs.mkdirSync('/tmp/aa', { recursive: true });
    const title = args[args.indexOf('--title') + 1] || 'run';
    const child = childProcess.spawn('opencode', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.pipe(fs.createWriteStream(path.join('/tmp/aa', `${title.replace(/[^a-zA-Z0-9-]+/g, '_')}.err`), { flags: 'a' }));
    return child;
};

/** Runs AskAway worker packets as OpenCode sessions and records their lifecycle and real provider usage. */
export class OpenCodeWorkerRuntime {
    readonly router: WorkerRouter;
    private readonly runs = new Map<string, RunRecord>();
    private readonly sessionsByWorker = new Map<string, string>();
    /** Keep-warm pings sent since each worker's last real run, and the pings in flight. */
    private readonly unusedPings = new Map<string, number>();
    private readonly pinging = new Set<string>();
    private readonly rehydrated = new Set<string>();
    private readonly adopted = new Map<string, { workspace: string; profile: string; model: string; thinking: string; sessionId: string; contextTokens: number; lastTs: number; forkedFrom?: string; cwd: string }>();
    private readonly ledgerDir: string;
    readonly now: () => number;
    private readonly spawner: Spawner;
    private attachUrl?: string;
    private readonly forkSession?: ForkSession;
    private readonly setTimer: (fire: () => void, ms: number) => () => void;

    constructor(profiles: WorkerProfile[], options: RuntimeOptions = {}) {
        this.now = options.now ?? Date.now;
        this.router = new WorkerRouter(profiles, { now: this.now });
        this.ledgerDir = options.ledgerDir ?? path.join(os.homedir(), '.askaway', 'worker-ledger');
        this.spawner = options.spawner ?? defaultSpawner;
        this.attachUrl = options.attachUrl;
        this.forkSession = options.forkSession;
        this.setTimer = options.setTimer ?? ((fire, ms) => { const timer = setTimeout(fire, ms); timer.unref?.(); return () => clearTimeout(timer); });
    }

    /** The shared OpenCode server workers attach to; empty when each run hosts its own. */
    get serverEndpoint(): string {
        return this.attachUrl ?? '';
    }

    /** Later launches attach to this server instead of hosting their own. */
    setServerEndpoint(url: string): void {
        this.attachUrl = url || undefined;
    }

    private capRefusal(adding: number): { status: 'PARALLEL_CAP'; running: number; max: number; reason: string } | undefined {
        const running = this.router.runningCount();
        if (running + adding <= MAX_PARALLEL_WORKERS) { return undefined; }
        return { status: 'PARALLEL_CAP', running, max: MAX_PARALLEL_WORKERS,
            reason: `${running} workers running; ${adding} more would exceed the cap of ${MAX_PARALLEL_WORKERS}. Wait for a worker to finish.` };
    }

    start(packet: WorkerPacket): RunView | { status: 'SELECTION_UNAVAILABLE' | 'INELIGIBLE'; reason: string } | NonNullable<ReturnType<OpenCodeWorkerRuntime['capRefusal']>> {
        const invalid = validatePacket(packet);
        if (invalid) { return { status: 'INELIGIBLE', reason: invalid }; }
        const workspace = canonical(packet.workspacePath);
        this.refreshFromLedger(workspace);
        const capped = this.capRefusal(1);
        if (capped) { return capped; }
        const routed = this.router.route({ workspacePath: workspace, cwd: runDir(packet), profile: packet.profile, model: packet.model, thinking: packet.thinking,
            packetId: packet.objective.slice(0, 40), estimatedSeconds: packet.estimatedSeconds ?? 60 });
        if (routed.status === 'SELECTION_UNAVAILABLE') { return routed; }
        return this.admit(routed, workspace, packet);
    }

    submit(workerId: string, packet: WorkerPacket): RunView | { status: 'RETIRED' | 'INELIGIBLE' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD'; workerId?: string; reason: string } | NonNullable<ReturnType<OpenCodeWorkerRuntime['capRefusal']>> {
        const invalid = validatePacket(packet);
        if (invalid) { return { status: 'INELIGIBLE', workerId, reason: invalid }; }
        this.refreshFromLedger(canonical(packet.workspacePath));
        // Queuing behind a running worker adds no parallelism; starting on an idle one does.
        const capped = this.router.worker(workerId)?.active ? undefined : this.capRefusal(1);
        if (capped) { return capped; }
        const routed = this.router.submitTo(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60, runDir(packet));
        if (!('runId' in routed)) {
            return { status: routed.status === 'RETIRED' || routed.status === 'CWD_MISMATCH' || routed.status === 'WORKER_TOO_OLD' ? routed.status : 'INELIGIBLE', workerId, reason: routed.reason };
        }
        return this.admit(routed, canonical(packet.workspacePath), packet);
    }

    /**
     * submit, except that a busy worker whose expected wait is past FORK_AFTER_SECONDS is forked at its last completed
     * message and the packet runs on the fork in parallel (status FORKED). When the fork is impossible the packet queues
     * as submit does, with the reason in `forkSkipped`.
     */
    async submitForking(workerId: string, packet: WorkerPacket): Promise<ReturnType<OpenCodeWorkerRuntime['submit']> | (RunView & { status: 'FORKED'; forkedFrom: string })
        | (RunView & { forkSkipped: string })> {
        const mismatch = validatePacket(packet) ? '' : this.router.cwdMismatch(workerId, runDir(packet));
        if (mismatch) { return { status: 'CWD_MISMATCH', workerId, reason: mismatch }; }
        const candidate = validatePacket(packet) ? undefined : this.router.forkCandidate(workerId);
        if (!candidate) { return this.submit(workerId, packet); }
        const forkCapped = this.capRefusal(1);
        if (forkCapped) { return forkCapped; }
        const parentSession = this.sessionsByWorker.get(workerId);
        const fork = this.forkSession ?? (this.attachUrl ? ((id: string) => forkSessionViaServer(this.attachUrl as string, id)) : undefined);
        let forkedSession = '';
        let skipped = '';
        if (!parentSession) { skipped = 'the busy worker has no OpenCode session yet'; }
        else if (!fork) { skipped = 'no shared OpenCode server attached'; }
        else {
            try { forkedSession = (await fork(parentSession)).sessionId; } catch (error) { skipped = `fork failed: ${(error as Error).message}`; }
        }
        if (!forkedSession) {
            const queued = this.submit(workerId, packet);
            return 'runId' in queued ? { ...queued, forkSkipped: skipped } : { ...queued, reason: `${queued.reason}; fork skipped: ${skipped}` };
        }
        const workspace = canonical(packet.workspacePath);
        const routed = this.router.startFork(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60);
        if (!routed || !('runId' in routed)) { return this.submit(workerId, packet); }
        this.sessionsByWorker.set(routed.workerId, forkedSession);
        const parentKnowledge = [...this.runs.values()].filter((run) => run.workerId === workerId && run.knowledge).pop()?.knowledge ?? '';
        const view = this.admit(routed, workspace, packet, parentKnowledge);
        this.record(this.runs.get(view.runId) as RunRecord, { type: 'fork', reason: `forked from ${workerId} (session ${parentSession})` });
        return { ...this.view(this.runs.get(view.runId) as RunRecord), status: 'FORKED', forkedFrom: workerId };
    }

    /**
     * Warm-then-fan-out: forks an IDLE warm worker's session once per packet. Every fork is a new worker with the warm
     * worker's profile, model and thinking (the point is to reuse its prompt cache), runs in parallel, and stays reusable.
     * Refused whole (nothing forked or started) on any mismatch, on the parallel cap, or when a fork fails.
     */
    async fanout(workerId: string, packets: WorkerPacket[]): Promise<{ status: 'FANNED_OUT'; workerId: string; runs: Array<RunView & { forkedFrom: string }> }
        | { status: 'INELIGIBLE' | 'MODEL_MISMATCH' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD'; workerId: string; reason: string } | NonNullable<ReturnType<OpenCodeWorkerRuntime['capRefusal']>>> {
        const refuse = (status: 'INELIGIBLE' | 'MODEL_MISMATCH' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD', reason: string) => ({ status, workerId, reason });
        if (packets.length < 2 || packets.length > MAX_PARALLEL_WORKERS) { return refuse('INELIGIBLE', `fanout needs 2..${MAX_PARALLEL_WORKERS} packets, got ${packets.length}`); }
        const parentReason = this.router.fanoutRefusal(workerId);
        if (parentReason) { return refuse(/^idle more than/.test(parentReason) ? 'WORKER_TOO_OLD' : 'INELIGIBLE', parentReason); }
        const parent = this.router.worker(workerId) as NonNullable<ReturnType<WorkerRouter['worker']>>;
        for (const [index, packet] of packets.entries()) {
            const invalid = validatePacket(packet);
            if (invalid) { return refuse('INELIGIBLE', `packet ${index + 1}: ${invalid}`); }
            const wrongDir = this.router.cwdMismatch(workerId, runDir(packet));
            if (wrongDir) { return refuse('CWD_MISMATCH', `packet ${index + 1}: ${wrongDir}`); }
            const mismatch = packet.profile !== parent.profile ? `profile ${packet.profile} != ${parent.profile}`
                : packet.model && packet.model !== parent.model ? `model ${packet.model} != ${parent.model}`
                : packet.thinking && packet.thinking !== parent.thinking ? `thinking ${packet.thinking} != ${parent.thinking}` : '';
            if (mismatch) { return refuse('MODEL_MISMATCH', `packet ${index + 1}: ${mismatch}; forks reuse the warm worker's cache, so they keep its profile, model and thinking`); }
        }
        const capped = this.capRefusal(packets.length);
        if (capped) { return capped; }
        const parentSession = this.sessionsByWorker.get(workerId);
        const fork = this.forkSession ?? (this.attachUrl ? ((id: string) => forkSessionViaServer(this.attachUrl as string, id)) : undefined);
        if (!parentSession) { return refuse('INELIGIBLE', 'the warm worker has no OpenCode session yet'); }
        if (!fork) { return refuse('INELIGIBLE', 'no shared OpenCode server attached'); }
        let sessions: string[];
        try { sessions = (await Promise.all(packets.map(() => fork(parentSession)))).map((forked) => forked.sessionId); }
        catch (error) { return refuse('INELIGIBLE', `fork failed: ${(error as Error).message}`); }
        // The forks awaited above may have let other dispatches in: re-check so the cap holds.
        const recapped = this.capRefusal(packets.length);
        if (recapped) { return recapped; }
        const parentKnowledge = [...this.runs.values()].filter((run) => run.workerId === workerId && run.knowledge).pop()?.knowledge ?? '';
        const runs: Array<RunView & { forkedFrom: string }> = [];
        for (const [index, packet] of packets.entries()) {
            const routed = this.router.startFork(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60);
            if (!routed || !('runId' in routed)) { continue; }
            this.sessionsByWorker.set(routed.workerId, sessions[index]);
            const view = this.admit(routed, canonical(packet.workspacePath), packet, parentKnowledge);
            this.record(this.runs.get(view.runId) as RunRecord, { type: 'fork', reason: `fanned out from ${workerId} (session ${parentSession})` });
            runs.push({ ...this.view(this.runs.get(view.runId) as RunRecord), forkedFrom: workerId });
        }
        return { status: 'FANNED_OUT', workerId, runs };
    }

    status(runId: string): (RunView & { evidence?: string[] }) | undefined {
        const run = this.runs.get(runId);
        if (!run) { return undefined; }
        return this.terminal(run.state) ? { ...this.view(run), evidence: run.evidence } : this.view(run);
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
        | { status: 'STALLED'; runId: string; workerId: string; sessionId: string; reason: string }
        | { status: 'STILL_RUNNING'; runId: string; workerId: string; state: RunState; waitedSeconds: number }
        | { status: 'UNKNOWN_RUN'; runId: string }> {
        const run = this.runs.get(runId);
        if (!run) { return { status: 'UNKNOWN_RUN', runId }; }
        const bound = Math.min(Math.max(0, timeoutSeconds), MAX_WAIT_SECONDS);
        const started = this.now();
        if (!this.terminal(run.state) && run.state !== 'STALLED') {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, bound * 1000);
                run.waiters.push(() => { clearTimeout(timer); resolve(); });
            });
        }
        if (run.state === 'COMPLETED') { return { status: 'COMPLETED', runId, evidence: run.evidence }; }
        if (run.state === 'FAILED' || run.state === 'CANCELLED') { return { status: run.state, runId, reason: run.reason ?? run.state.toLowerCase() }; }
        if (run.state === 'STALLED') { return { status: 'STALLED', runId, workerId: run.workerId, sessionId: run.sessionId, reason: run.reason ?? 'stalled' }; }
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
        // The spawn-time start fact of a fresh session is written before OpenCode names it: readers see the run's session on it.
        return this.readLedger(run.workspace).filter((record) => record.runId === runId)
            .map((record) => (record.sessionId || !run.sessionId ? record : { ...record, sessionId: run.sessionId }));
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
                contextTokens: adopted.contextTokens, lastActivityAt: adopted.lastTs, forkedFrom: adopted.forkedFrom, cwd: adopted.cwd }, reason ? 'ORPHANED' : 'IDLE', reason || undefined);
            if (reason) { result.orphaned.push({ workerId, reason }); } else {
                this.sessionsByWorker.set(workerId, adopted.sessionId);
                result.reconnected.push(workerId);
            }
        }
        return result;
    }

    /**
     * Archive-only prune. Takes only workers that are not running, have an empty queue, and can no longer be reused
     * (retired, orphaned, or cache cold). Their ledger facts stay (cost history is never deleted); live views drop them.
     */
    archive(workspacePath: string): { archived: string[]; kept: Array<{ workerId: string; reason: string }> } {
        const workspace = canonical(workspacePath);
        const byWorker = new Map<string, RunRecord[]>();
        for (const run of this.runs.values()) {
            if (run.workspace !== workspace) { continue; }
            byWorker.set(run.workerId, [...(byWorker.get(run.workerId) ?? []), run]);
        }
        const result = { archived: [] as string[], kept: [] as Array<{ workerId: string; reason: string }> };
        for (const [workerId, runs] of byWorker) {
            const routed = this.router.worker(workerId);
            const busy = runs.some((run) => !this.terminal(run.state)) || !!routed?.active || (routed?.queue.length ?? 0) > 0;
            const expires = routed ? this.router.cacheExpiresAt(routed) : 0;
            const reusable = !!routed && routed.state !== 'RETIRED' && routed.state !== 'ORPHANED' && expires > 0 && this.now() < expires;
            if (busy || reusable) { result.kept.push({ workerId, reason: busy ? 'running or queued work' : 'still reusable (cache warm)' }); continue; }
            const latest = runs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
            this.record(latest, { type: 'archive' });
            for (const run of runs) { this.runs.delete(run.runId); }
            this.router.forget(workerId);
            this.sessionsByWorker.delete(workerId);
            this.adopted.delete(workerId);
            result.archived.push(workerId);
        }
        return result;
    }

    /**
     * Another extension host (window) shares this ledger: before routing, adopt the idle workers it wrote since this host
     * last looked, and refresh the activity time of idle workers it reused. Runs of workers that are still executing
     * elsewhere are skipped, so a busy sibling is never taken. Reuses restoreRuns; never changes a known worker's state.
     */
    private refreshFromLedger(workspace: string): void {
        const unfinishedWorkers = this.restoreRuns(workspace, true);
        this.router.markBusyElsewhere(workspace, unfinishedWorkers);
        for (const [workerId, adopted] of this.adopted) {
            if (adopted.workspace !== workspace) { continue; }
            const known = this.router.worker(workerId);
            if (unfinishedWorkers.has(workerId)) { continue; }
            if (!known) {
                this.router.adopt({ workerId, workspacePath: workspace, profile: adopted.profile, model: adopted.model, thinking: adopted.thinking,
                    contextTokens: adopted.contextTokens, lastActivityAt: adopted.lastTs, forkedFrom: adopted.forkedFrom, cwd: adopted.cwd }, adopted.sessionId ? 'IDLE' : 'ORPHANED',
                    adopted.sessionId ? undefined : 'no OpenCode session was recorded');
                if (adopted.sessionId) { this.sessionsByWorker.set(workerId, adopted.sessionId); }
            } else {
                this.router.refreshIdle(workerId, adopted.lastTs, adopted.contextTokens);
                if (adopted.sessionId && known.state === 'IDLE') { this.sessionsByWorker.set(workerId, adopted.sessionId); }
            }
        }
    }

    private restoreRuns(workspace: string, skipUnfinished = false): Set<string> {
        const byRun = new Map<string, LifecycleRecord[]>();
        const ledger = this.readLedger(workspace);
        const archived = new Set(ledger.filter((record) => record.type === 'archive').map((record) => record.workerId));
        for (const record of ledger) {
            // IDs without a host segment predate host-unique IDs and are ambiguous across reloads.
            if (/^run-\d+$/.test(record.runId) || this.runs.has(record.runId) || archived.has(record.workerId)) { continue; }
            const records = byRun.get(record.runId) ?? [];
            records.push(record);
            byRun.set(record.runId, records);
        }
        // A run with no exit fact may be executing in another host: when refreshing, leave it and its worker alone.
        // A run stamped later than this host's clock comes from a skewed clock and is ignored.
        const unfinishedWorkers = new Set<string>();
        if (skipUnfinished) {
            for (const [runId, records] of byRun) {
                const last = records.filter((record) => !record.ping).pop() ?? records[records.length - 1];
                if (records[records.length - 1].ts > this.now()) { byRun.delete(runId); }
                else if (last.exitCode === undefined) { unfinishedWorkers.add(records[0].workerId); byRun.delete(runId); }
            }
        }
        for (const [runId, records] of byRun) {
            if (unfinishedWorkers.has(records[0].workerId)) { continue; }
            const first = records[0];
            const last = records.filter((record) => !record.ping).pop() ?? records[records.length - 1];
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
                : 'interrupted by reload; action resume continues its session';
            this.runs.set(runId, {
                runId, workerId: first.workerId, sessionId, state, profile: first.profile, model: first.model, thinking: first.thinking,
                dispatchTurnId: first.dispatchTurnId, track: first.track ?? '', startedAt: first.ts, endedAt: last.ts, updatedAt: last.ts, elapsedMs: last.ts - first.ts,
                usage, queuePosition: 0, reason, workspace, cwd: first.cwd ?? workspace, packet: '', evidence: [], waiters: [], nextInputTokens: contextTokens, knowledge: '',
                lastPromptTokens, lastCachedTokens, ...(first.forkedFrom ? { forkedFrom: first.forkedFrom } : {}),
            });
            const lastTs = records[records.length - 1].ts;
            const adopted = this.adopted.get(first.workerId);
            if (!adopted || lastTs >= adopted.lastTs) {
                this.adopted.set(first.workerId, { workspace, cwd: first.cwd ?? workspace, profile: first.profile, model: first.model, thinking: first.thinking,
                    sessionId: sessionId || adopted?.sessionId || '', contextTokens: contextTokens || adopted?.contextTokens || 0, lastTs,
                    forkedFrom: first.forkedFrom ?? adopted?.forkedFrom });
            }
        }
        return unfinishedWorkers;
    }

    /** The workspace's workers as keep-warm inputs (see keepWarm.ts); a worker with no recorded session cannot be pinged. */
    keepWarmWorkers(workspacePath: string): KeepWarmWorker[] {
        return this.router.workers(canonical(workspacePath)).filter((worker) => this.sessionsByWorker.has(worker.workerId)).map((worker) => ({
            workerId: worker.workerId, state: worker.state, active: !!worker.active, queued: worker.queue.length,
            cacheExpiresAt: this.router.cacheExpiresAt(worker), nextInputTokens: worker.contextTokens,
            unusedPings: this.unusedPings.get(worker.workerId) ?? 0, pinging: this.pinging.has(worker.workerId),
        }));
    }

    /**
     * One minimal message to the worker's OpenCode session (`POST /session/:id/message`, same agent and model) so the
     * provider's prompt cache refreshes. Its step_finish usage goes to the ledger as a checkpoint tagged `ping`.
     * Never pings a busy, queued, retired, orphaned or expired worker.
     */
    async ping(workerId: string, fetchImpl: typeof fetch = fetch): Promise<{ status: 'PINGED' | 'SKIPPED' | 'FAILED'; reason?: string }> {
        const worker = this.router.worker(workerId);
        const sessionId = this.sessionsByWorker.get(workerId) ?? '';
        const run = [...this.runs.values()].filter((candidate) => candidate.workerId === workerId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!worker || !run || !this.attachUrl || !/^[A-Za-z0-9_-]+$/.test(sessionId)) { return { status: 'SKIPPED', reason: 'no attached session' }; }
        const expires = this.router.cacheExpiresAt(worker);
        if (worker.state !== 'IDLE' || worker.active || worker.queue.length > 0 || expires <= this.now() || this.pinging.has(workerId)) {
            return { status: 'SKIPPED', reason: 'not an idle warm worker' };
        }
        const slash = run.model.indexOf('/');
        this.pinging.add(workerId);
        try {
            const res = await fetchImpl(`${this.attachUrl.replace(/\/$/, '')}/session/${sessionId}/message`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(PING_HTTP_TIMEOUT_MS),
                body: JSON.stringify({ agent: `aa-${run.profile}`, model: { providerID: run.model.slice(0, slash), modelID: run.model.slice(slash + 1) },
                    variant: run.thinking, parts: [{ type: 'text', text: KEEP_WARM_PROMPT }] }),
            });
            if (!res.ok) { return { status: 'FAILED', reason: `HTTP ${res.status}` }; }
            const text = await res.text();
            let body: any = {};
            try { body = text ? JSON.parse(text) : {}; } catch { /* the cache is refreshed even when the reply is unreadable */ }
            const finish = (Array.isArray(body.parts) ? body.parts : []).find((part: any) => part?.type === 'step-finish') ?? {};
            const tokens = finish.tokens ?? body.info?.tokens ?? {};
            const usage: RunUsage = { input: tokens.input ?? 0, output: tokens.output ?? 0, reasoning: tokens.reasoning ?? 0,
                cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0, cost: finish.cost ?? body.info?.cost ?? 0, steps: 1 };
            for (const key of Object.keys(usage) as Array<keyof RunUsage>) { run.usage[key] += usage[key]; }
            const context = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
            if (context > 0) { run.nextInputTokens = context; run.lastPromptTokens = usage.input + usage.cacheRead + usage.cacheWrite; run.lastCachedTokens = usage.cacheRead; }
            this.record(run, { type: 'checkpoint', usage, ping: true, callId: finish.id ? String(finish.id) : undefined });
            this.router.touch(workerId, context);
            this.unusedPings.set(workerId, (this.unusedPings.get(workerId) ?? 0) + 1);
            return { status: 'PINGED' };
        } catch (error) {
            return { status: 'FAILED', reason: (error as Error).message };
        } finally {
            this.pinging.delete(workerId);
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

    /** Worker spend since a moment (the turn start): one checkpoint is one model request; session totals are never used. */
    usageSince(workspacePath: string, sinceMs: number): { requests: number; dollars: number; runs: number; inputTokens: number; outputTokens: number } {
        const total = { requests: 0, dollars: 0, runs: 0, inputTokens: 0, outputTokens: 0 };
        const runIds = new Set<string>();
        for (const record of this.readLedger(canonical(workspacePath))) {
            if (record.type !== 'checkpoint' || !record.usage || record.ts < sinceMs) { continue; }
            total.requests++;
            total.dollars += record.usage.cost;
            total.inputTokens += record.usage.input + record.usage.cacheRead + record.usage.cacheWrite;
            total.outputTokens += record.usage.output;
            runIds.add(record.runId);
        }
        total.runs = runIds.size;
        return total;
    }

    private admit(routed: Extract<RouteResult, { runId: string }>, workspace: string, packet: WorkerPacket, knowledge = ''): RunView {
        const run: RunRecord = {
            runId: routed.runId, workerId: routed.workerId, sessionId: this.sessionsByWorker.get(routed.workerId) ?? '',
            state: 'STARTING', profile: packet.profile, model: routed.model, thinking: routed.thinking,
            dispatchTurnId: packet.dispatchTurnId, track: String(packet.track ?? '').trim().slice(0, 24), startedAt: this.now(), updatedAt: this.now(), elapsedMs: 0, usage: emptyUsage(),
            queuePosition: routed.queuePosition, workspace, cwd: packet.cwd ? canonical(packet.cwd) : workspace, packet: renderPacket(packet), evidence: [], waiters: [],
            nextInputTokens: this.router.worker(routed.workerId)?.contextTokens ?? 0, knowledge, lastPromptTokens: 0, lastCachedTokens: 0,
            ...(packet.thinking && packet.thinking !== routed.thinking ? { thinkingNote: `thinking: ${routed.thinking} (worker's)` } : {}),
            ...(this.router.worker(routed.workerId)?.forkedFrom ? { forkedFrom: this.router.worker(routed.workerId)?.forkedFrom } : {}),
        };
        this.runs.set(run.runId, run);
        if (routed.queuePosition === 0) { this.launch(run, run.packet); }
        return this.view(run);
    }

    private launch(run: RunRecord, message: string): void {
        run.queuePosition = 0;
        this.unusedPings.delete(run.workerId);
        run.startedAt = this.now();
        const sessionId = this.sessionsByWorker.get(run.workerId) || run.sessionId;
        // --print-logs is required: without it `opencode run` is SIGKILLed after ~14s.
        const args = ['run', '--print-logs', '--log-level', 'ERROR', '--format', 'json', '--agent', `aa-${run.profile}`,
            '--model', run.model, '--variant', run.thinking, '--dir', run.cwd, '--title', `${run.workerId}/${run.runId}`];
        if (sessionId) { args.push('--session', sessionId); }
        if (this.attachUrl) { args.push('--attach', this.attachUrl); }
        args.push(message);
        const child = this.spawner(args);
        run.child = child;
        // The start fact is written at spawn, so a run that never speaks is still in the ledger with its pid, session and directory.
        this.record(run, { type: 'start', sessionId, pid: child.pid, dir: run.cwd });
        const cancelStall = this.setTimer(() => this.stall(run, sessionId), STALL_AFTER_SECONDS * 1000);
        // Headless OpenCode rejects anything that would ask and then ends the run; that rejection is the real reason.
        const rejected: string[] = [];
        let errBuffer = '';
        child.stderr?.on('data', (chunk: Buffer) => {
            errBuffer += chunk.toString();
            const lines = errBuffer.split('\n');
            errBuffer = lines.pop() ?? '';
            for (const line of lines) {
                const match = /permission requested:\s*(.+?);\s*auto-rejecting/i.exec(line);
                if (match && !rejected.includes(match[1])) { rejected.push(match[1]); }
            }
        });
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
                if (!started) { started = true; cancelStall(); }
                if (run.state === 'STARTING' || run.state === 'STALLED') { run.state = 'RUNNING'; run.reason = undefined; }
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
            cancelStall();
            run.evidence = lastText.trim().split('\n').slice(-MAX_EVIDENCE_LINES);
            // Only a `Result:` line ends a packet; text that stops mid-thought is an unfinished run, not a completion.
            const hasResult = run.evidence.some((line) => /^\W*Result:\s*(PASS|FAIL|BLOCKED)\b/i.test(line));
            const unfinished = code === 0 && !signal && run.reason !== 'cancelled by caller' && !hasResult;
            if (unfinished && run.sessionId && (run.autoResumes ?? 0) < MAX_AUTO_RESUMES) {
                run.autoResumes = (run.autoResumes ?? 0) + 1;
                this.record(run, { type: 'approval', reason: rejected.length ? `auto-rejected, resumed with feedback: ${rejected.join('; ')}` : 'stopped without a Result line, resumed' });
                this.launch(run, rejected.length ? rejectionFeedback(rejected) : UNFINISHED_FEEDBACK);
                return;
            }
            const worker = this.router.worker(run.workerId);
            this.router.complete(run.workerId, run.runId, { contextTokens: run.nextInputTokens || worker?.contextTokens || 0 });
            const knowledge = [...run.evidence].reverse().find((line) => /^\W*Knowledge:/i.test(line));
            if (knowledge) { run.knowledge = knowledge.replace(/^\W*Knowledge:\s*/i, '').slice(0, 200); }
            const cancelled = run.reason === 'cancelled by caller';
            const silent = unfinished;
            if (silent) {
                run.reason = rejected.length
                    ? `permission auto-rejected: ${rejected.join(', ')} (not allowed for this worker; allow it in the OpenCode config or change the packet)`
                    : run.evidence.join('').trim() === '' ? 'worker ended without a report (no Result/Evidence text)' : 'worker stopped without a Result line';
            }
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

    /** No stdout event STALL_AFTER_SECONDS after spawn: surface it at once. The process is never killed automatically. */
    private stall(run: RunRecord, sessionId: string): void {
        if (run.state !== 'STARTING') { return; }
        run.state = 'STALLED';
        run.reason = `no event ${STALL_AFTER_SECONDS} s after spawn (session ${sessionId || run.sessionId || 'none'}, dir ${run.cwd})`;
        this.record(run, { type: 'error', state: 'STALLED', reason: run.reason });
        for (const waiter of run.waiters.splice(0)) { waiter(); }
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
        const { runId, workerId, sessionId, state, profile, model, thinking, dispatchTurnId, track, startedAt, endedAt, updatedAt, usage, queuePosition, reason, nextInputTokens, knowledge, lastPromptTokens, lastCachedTokens, forkedFrom, thinkingNote } = run;
        return { runId, workerId, sessionId, state, profile, model, thinking, dispatchTurnId, track, startedAt, endedAt, updatedAt, nextInputTokens, knowledge, lastPromptTokens, lastCachedTokens,
            elapsedMs: (endedAt ?? this.now()) - startedAt, usage: { ...usage }, queuePosition, reason, ...(forkedFrom ? { forkedFrom } : {}), ...(thinkingNote ? { thinkingNote } : {}) };
    }

    private record(run: RunRecord, fact: Pick<LifecycleRecord, 'type'> & Partial<LifecycleRecord>): void {
        const record: LifecycleRecord = {
            ts: this.now(), workspace: run.workspace, ...(run.cwd && run.cwd !== run.workspace ? { cwd: run.cwd } : {}), workerId: run.workerId, runId: run.runId, sessionId: run.sessionId,
            dispatchTurnId: run.dispatchTurnId, source: run.model.split('/')[0] || 'unknown', ...(run.track ? { track: run.track } : {}),
            ...(run.forkedFrom ? { forkedFrom: run.forkedFrom } : {}), profile: run.profile, model: run.model, thinking: run.thinking, ...fact,
        };
        run.updatedAt = record.ts;
        fs.mkdirSync(this.ledgerDir, { recursive: true });
        fs.appendFileSync(path.join(this.ledgerDir, `${workspaceKey(run.workspace)}.jsonl`), `${JSON.stringify(record)}\n`);
    }

    /**
     * The owner's ledger plus the ledgers of its git worktrees: runs dispatched before owner/cwd were separated were
     * keyed by the worktree path they ran in. Rule: a worktree is any path `git worktree list` reports for the owner.
     */
    private readLedger(workspace: string): LifecycleRecord[] {
        const records: LifecycleRecord[] = [];
        for (const key of [workspace, ...worktreesOf(workspace)]) {
            const file = path.join(this.ledgerDir, `${workspaceKey(key)}.jsonl`);
            let text = '';
            try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
            for (const line of text.split('\n')) {
                if (!line) { continue; }
                try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
            }
        }
        return records.length > 1 ? records.sort((a, b) => a.ts - b.ts) : records;
    }
}
