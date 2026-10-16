import * as fs from 'fs';
import { resolveSelection, workerRegistryKey, WorkerProfile, workerProfileRefresh } from './workerProfiles';

export const MAX_QUEUE_WAIT_SECONDS = 120;
export const MAX_CONTEXT_TOKENS = 300000;
export const START_REUSE_MAX_CONTEXT_TOKENS = 200000;
export const DEFAULT_CACHE_TTL_SECONDS = 300;
/** A submit to a busy worker whose expected wait exceeds this forks the worker's session instead of queuing. */
export const FORK_AFTER_SECONDS = 30;
/** Most workers executing at once; start, submit-fork and fanout refuse with PARALLEL_CAP beyond it. */
export const MAX_PARALLEL_WORKERS = 8;
/** A worker idle longer than this is never scheduled (reviewer: not more than a few hours old); status/logs/list still read it. */
export const WORKER_MAX_IDLE_MS = 3 * 60 * 60 * 1000;
/** After its cache expired, a worker is still reused by start while its next input is under this many tokens. */
export const EXPIRED_REUSE_MAX_CONTEXT_TOKENS = 100_000;
export const VALIDATOR_CACHE_TTL_MS = 30 * 60 * 1000;
export const VALIDATOR_MAX_INPUT_TOKENS = 100_000;
/** The one-line prompt of a keep-warm ping (spec 005 T018). */
export const KEEP_WARM_PROMPT = 'ping, reply ok';

/** Equal directories compare equal through symlinks; a missing path keeps its literal value. */
function realDir(dir: string): string {
    try { return fs.realpathSync(dir); } catch { return dir; }
}

export type RoutedWorkerState = 'IDLE' | 'RUNNING' | 'RETIRED' | 'ORPHANED';

export interface QueueEntry {
    runId: string;
    packetId: string;
    estimatedSeconds: number;
    enqueuedAt: number;
    startedAt?: number;
}

export interface RoutedWorker {
    workerId: string;
    registryKey: string;
    /** Directory its OpenCode session runs in. A session is only ever reused for this same directory. */
    cwd: string;
    workspacePath: string;
    profile: string;
    model: string;
    thinking: string;
    state: RoutedWorkerState;
    contextTokens: number;
    lastActivityAt: number;
    retiredReason?: string;
    /** The worker whose session this one was forked from; empty for a worker that started fresh. */
    forkedFrom?: string;
    /** Another extension host is running it (seen in the shared ledger); not routable meanwhile. */
    busyElsewhere?: boolean;
    sessionKey?: string;
    active?: QueueEntry;
    queue: QueueEntry[];
}

export interface RouteRequest {
    sessionKey?: string;
    workspacePath: string;
    /** Run directory; defaults to the owner workspace. */
    cwd?: string;
    profile: string;
    model?: string;
    thinking?: string;
    packetId: string;
    estimatedSeconds: number;
}

export type RouteResult =
    | { status: 'SELECTION_UNAVAILABLE'; reason: string }
    | {
        status: 'REUSED' | 'CREATED';
        workerId: string;
        runId: string;
        model: string;
        thinking: string;
        queuePosition: number;
        estimatedWaitSeconds: number;
        reason: string;
    };

export interface RouterOptions {
    now?: () => number;
    cacheTtlSeconds?: number;
}

/** Routes packets to workspace-bound serial workers, reusing a warm worker only when every eligibility rule holds. */
export class WorkerRouter {
    private readonly workersById = new Map<string, RoutedWorker>();
    private readonly profiles: Map<string, WorkerProfile>;
    private readonly refreshProfiles: () => WorkerProfile[] | undefined;
    private readonly now: () => number;
    private readonly cacheTtlMs: number;
    private sequence = 0;
    private readonly hostId = Math.random().toString(36).slice(2, 8);
    dispatches = 0;

    constructor(profiles: WorkerProfile[], options: RouterOptions = {}) {
        this.profiles = new Map(profiles.map((profile) => [profile.name, profile]));
        this.refreshProfiles = workerProfileRefresh(profiles);
        this.now = options.now ?? Date.now;
        this.cacheTtlMs = (options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
    }

    /** The installed profile by name (as last refreshed by route). */
    profile(name: string): WorkerProfile | undefined {
        return this.profiles.get(name);
    }

    route(request: RouteRequest): RouteResult {
        const refreshed = this.refreshProfiles();
        if (refreshed) {
            this.profiles.clear();
            for (const profile of refreshed) { this.profiles.set(profile.name, profile); }
        }
        const profile = this.profiles.get(request.profile);
        if (!profile) {
            return { status: 'SELECTION_UNAVAILABLE', reason: `unknown profile ${request.profile}` };
        }
        const selection = resolveSelection(profile, { model: request.model, thinking: request.thinking });
        if (selection.status !== 'SELECTED') {
            return { status: 'SELECTION_UNAVAILABLE', reason: selection.reason };
        }
        const registryKey = workerRegistryKey(request.workspacePath, profile.name, selection);
        const rejections: string[] = [];
        const cwd = realDir(request.cwd || request.workspacePath);
        const currentSession = request.sessionKey ? [...this.workersById.values()].reverse()
            .filter(worker => worker.workspacePath === request.workspacePath && worker.sessionKey === request.sessionKey)
            .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0] : undefined;
        // start means parallel: only an idle worker is reused; queuing behind a busy one is what submit is for.
        // Thinking is not part of the key: a reused worker keeps its own, so its session config and cache stay unchanged.
        // An expired-cache worker under EXPIRED_REUSE_MAX_CONTEXT_TOKENS is still reusable; a warm one is preferred.
        const eligible = [...this.workersById.values()]
            .filter((worker) => worker.registryKey === registryKey && worker.cwd === cwd
                && worker.sessionKey === request.sessionKey && (request.sessionKey ? worker === currentSession : !worker.active))
            .filter((worker) => {
                if (request.sessionKey) return worker.state !== 'RETIRED' && worker.state !== 'ORPHANED' && !worker.busyElsewhere
                    && this.now() - worker.lastActivityAt < VALIDATOR_CACHE_TTL_MS && worker.contextTokens <= VALIDATOR_MAX_INPUT_TOKENS;
                const reason = worker.contextTokens > START_REUSE_MAX_CONTEXT_TOKENS
                    ? `context ${worker.contextTokens} > start reuse limit ${START_REUSE_MAX_CONTEXT_TOKENS}`
                    : this.ineligibility(worker, true, true);
                if (reason) { rejections.push(`${worker.workerId}: ${reason}`); }
                return !reason;
            })
            .sort((a, b) => Number(this.isExpired(a)) - Number(this.isExpired(b))
                || this.estimatedWaitSeconds(a) - this.estimatedWaitSeconds(b) || a.workerId.localeCompare(b.workerId));

        const reused = eligible[0];
        const reusedExpired = !!reused && this.isExpired(reused);
        const worker = reused ?? this.createWorker(registryKey, request.workspacePath, profile.name, selection.model, selection.thinking, cwd);
        if (!reused && request.sessionKey) {
            for (const previous of this.workersById.values()) {
                if (previous !== worker && previous.workspacePath === request.workspacePath && previous.sessionKey === request.sessionKey) this.retire(previous.workerId, 'validator session replaced');
            }
        }
        worker.sessionKey = request.sessionKey;
        const estimatedWaitSeconds = this.estimatedWaitSeconds(worker);
        const entry: QueueEntry = { runId: this.nextId('run'), packetId: request.packetId, estimatedSeconds: request.estimatedSeconds, enqueuedAt: this.now() };
        this.dispatches++;
        let queuePosition = 0;
        if (worker.active) {
            worker.queue.push(entry);
            queuePosition = worker.queue.length;
        } else {
            this.start(worker, entry);
        }
        return {
            status: reused ? 'REUSED' : 'CREATED',
            workerId: worker.workerId,
            runId: entry.runId,
            model: worker.model,
            thinking: worker.thinking,
            queuePosition,
            estimatedWaitSeconds,
            reason: reused ? (reusedExpired ? 'expired-cache worker reused (small context)' : 'compatible warm worker within wait bound') : (rejections.length ? `no eligible worker (${rejections.join('; ')})` : 'no compatible worker'),
        };
    }

    /** Queues work on one named worker, refusing explicitly when that worker is no longer eligible or runs in another directory. */
    submitTo(workerId: string, packetId: string, estimatedSeconds: number, cwd?: string): RouteResult | { status: 'RETIRED' | 'INELIGIBLE' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD'; workerId: string; reason: string } {
        const worker = this.workersById.get(workerId);
        if (!worker) { return { status: 'INELIGIBLE', workerId, reason: 'unknown worker' }; }
        if (worker.state === 'RETIRED') { return { status: 'RETIRED', workerId, reason: worker.retiredReason || 'retired' }; }
        const mismatch = this.cwdMismatch(workerId, cwd);
        if (mismatch) { return { status: 'CWD_MISMATCH', workerId, reason: mismatch }; }
        const tooOld = this.tooOldReason(worker);
        if (tooOld) { return { status: 'WORKER_TOO_OLD', workerId, reason: tooOld }; }
        const reason = this.ineligibility(worker, false);
        // A cold cache or an oversized context never recovers: retire so no later caller reuses it either.
        if (reason && worker.state !== 'ORPHANED') {
            this.retire(workerId, reason);
            return { status: 'RETIRED', workerId, reason: `${reason}; start a fresh worker (action start)` };
        }
        const busy = reason || this.ineligibility(worker);
        if (busy) { return { status: 'INELIGIBLE', workerId, reason: busy }; }
        const estimatedWaitSeconds = this.estimatedWaitSeconds(worker);
        const entry: QueueEntry = { runId: this.nextId('run'), packetId, estimatedSeconds, enqueuedAt: this.now() };
        this.dispatches++;
        let queuePosition = 0;
        if (worker.active) {
            worker.queue.push(entry);
            queuePosition = worker.queue.length;
        } else {
            this.start(worker, entry);
        }
        return { status: 'REUSED', workerId, runId: entry.runId, model: worker.model, thinking: worker.thinking, queuePosition, estimatedWaitSeconds, reason: 'submitted to named worker' };
    }

    /**
     * OpenCode silently emits nothing when a session is reused from another directory, so a worker (its session, forks
     * and pings) only ever serves its own run directory. Empty when `cwd` matches or is not given.
     */
    cwdMismatch(workerId: string, cwd?: string): string {
        const worker = this.workersById.get(workerId);
        if (!worker || !cwd || realDir(cwd) === worker.cwd) { return ''; }
        return `worker ${workerId} runs in ${worker.cwd}, the packet in ${cwd}; a session is never reused across directories (start a new worker for that directory)`;
    }

    /** The running worker a submit should fork instead of queue behind: its expected wait is past FORK_AFTER_SECONDS. */
    forkCandidate(workerId: string): { parent: RoutedWorker; waitSeconds: number } | undefined {
        const worker = this.workersById.get(workerId);
        if (!worker || !worker.active || worker.state !== 'RUNNING' || this.ineligibility(worker, false)) { return undefined; }
        const waitSeconds = this.estimatedWaitSeconds(worker);
        return waitSeconds > FORK_AFTER_SECONDS ? { parent: worker, waitSeconds } : undefined;
    }

    /**
     * Registers a new worker for a session forked from a busy one (same profile, model, thinking, and the parent's
     * context size) and starts the packet on it at once, in parallel with the parent.
     */
    startFork(parentId: string, packetId: string, estimatedSeconds: number): (RouteResult & { forkedFrom: string }) | undefined {
        const parent = this.workersById.get(parentId);
        if (!parent) { return undefined; }
        const worker = this.createWorker(parent.registryKey, parent.workspacePath, parent.profile, parent.model, parent.thinking, parent.cwd);
        worker.contextTokens = parent.contextTokens;
        worker.forkedFrom = parentId;
        const entry: QueueEntry = { runId: this.nextId('run'), packetId, estimatedSeconds, enqueuedAt: this.now() };
        this.dispatches++;
        this.start(worker, entry);
        return { status: 'CREATED', workerId: worker.workerId, runId: entry.runId, model: worker.model, thinking: worker.thinking,
            queuePosition: 0, estimatedWaitSeconds: 0, reason: `forked from worker ${parentId}`, forkedFrom: parentId };
    }

    /** Workers executing a run right now (running or starting); queued entries add no parallelism. */
    runningCount(): number {
        return [...this.workersById.values()].filter((worker) => worker.active).length;
    }

    /** Why an idle worker cannot be the warm parent of a fan-out; empty when it can. */
    fanoutRefusal(workerId: string): string {
        const worker = this.workersById.get(workerId);
        if (!worker) { return 'unknown worker'; }
        if (worker.active || worker.state !== 'IDLE') { return `worker is ${worker.active ? 'running' : worker.state.toLowerCase()}, fan-out needs an idle warm worker`; }
        return this.ineligibility(worker, false);
    }

    /** Only a not-yet-started entry can be cancelled; running work is never cancelled here. */
    cancelQueued(workerId: string, runId: string): { status: 'CANCELLED' | 'NOT_QUEUED' } {
        const worker = this.workersById.get(workerId);
        const index = worker ? worker.queue.findIndex((entry) => entry.runId === runId) : -1;
        if (!worker || index < 0) { return { status: 'NOT_QUEUED' }; }
        worker.queue.splice(index, 1);
        return { status: 'CANCELLED' };
    }

    /** Reserves an idle worker for a previously finished run before its session is relaunched. */
    resumeRun(workerId: string, runId: string, packetId: string, estimatedSeconds: number): boolean {
        const worker = this.workersById.get(workerId);
        if (!worker || worker.state !== 'IDLE' || worker.active || worker.busyElsewhere) { return false; }
        this.start(worker, { runId, packetId, estimatedSeconds, enqueuedAt: this.now() });
        return true;
    }

    /** Records a finished run and starts the next queued entry, if any. */
    complete(workerId: string, runId: string, usage: { contextTokens: number }): QueueEntry | undefined {
        const worker = this.workersById.get(workerId);
        if (!worker || worker.active?.runId !== runId) { return undefined; }
        worker.active = undefined;
        worker.contextTokens = usage.contextTokens;
        worker.lastActivityAt = this.now();
        if (worker.contextTokens > MAX_CONTEXT_TOKENS) {
            this.retire(workerId, `context ${worker.contextTokens} exceeds ${MAX_CONTEXT_TOKENS}`);
            return undefined;
        }
        const next = worker.queue.shift();
        if (next) { this.start(worker, next); } else { worker.state = 'IDLE'; }
        return next;
    }

    retire(workerId: string, reason: string): void {
        const worker = this.workersById.get(workerId);
        if (!worker) { return; }
        worker.state = 'RETIRED';
        worker.retiredReason = reason;
    }

    /** Re-registers a worker known from the ledger after a reload. It keeps its identity and never re-runs work. */
    adopt(record: Pick<RoutedWorker, 'workerId' | 'workspacePath' | 'profile' | 'model' | 'thinking' | 'contextTokens' | 'lastActivityAt' | 'forkedFrom'> & { cwd?: string; sessionKey?: string },
        state: 'IDLE' | 'ORPHANED', reason?: string): void {
        const existing = this.workersById.get(record.workerId);
        if (existing) {
            if (existing.state === 'ORPHANED' || existing.state === 'IDLE') { existing.state = state; existing.retiredReason = reason; }
            return;
        }
        this.workersById.set(record.workerId, {
            ...record, cwd: realDir(record.cwd || record.workspacePath), registryKey: workerRegistryKey(record.workspacePath, record.profile, record), state, retiredReason: reason, queue: [],
        });
    }

    /** Flags this workspace's workers that another host is executing right now; they are not routed to until it finishes. */
    markBusyElsewhere(workspacePath: string, workerIds: Set<string>): void {
        for (const worker of this.workers(workspacePath)) { worker.busyElsewhere = workerIds.has(worker.workerId); }
    }

    /** An idle worker another host reused later than we knew: take its newer activity time and context size. */
    refreshIdle(workerId: string, lastActivityAt: number, contextTokens: number): void {
        const worker = this.workersById.get(workerId);
        if (!worker || worker.active || worker.state !== 'IDLE' || lastActivityAt <= worker.lastActivityAt) { return; }
        worker.lastActivityAt = lastActivityAt;
        worker.contextTokens = contextTokens;
    }

    worker(workerId: string): RoutedWorker | undefined {
        return this.workersById.get(workerId);
    }

    /** Drops an archived worker from routing; it can never be selected or submitted to again. */
    forget(workerId: string): void {
        this.workersById.delete(workerId);
    }

    /** When an idle worker's prompt cache goes cold and it stops being reusable; 0 while running or when never reusable. */
    cacheExpiresAt(worker: RoutedWorker): number {
        if (worker.active || worker.state === 'RETIRED' || worker.state === 'ORPHANED') { return 0; }
        return worker.lastActivityAt + this.cacheTtlMs;
    }

    /** A keep-warm ping refreshed the provider's cache: the idle worker's clock restarts and its context grew by the ping. */
    touch(workerId: string, contextTokens: number): void {
        const worker = this.workersById.get(workerId);
        if (!worker || worker.active || worker.state !== 'IDLE') { return; }
        worker.lastActivityAt = this.now();
        if (contextTokens > 0) { worker.contextTokens = contextTokens; }
    }

    workers(workspacePath?: string): RoutedWorker[] {
        const all = [...this.workersById.values()];
        if (!workspacePath) { return all; }
        const prefix = workerRegistryKey(workspacePath, '', { model: '', thinking: '' }).split('::')[0];
        return all.filter((worker) => worker.registryKey.split('::')[0] === prefix);
    }

    /**
     * A worker idle past WORKER_MAX_IDLE_MS is never scheduled (start, submit, fanout); it stays readable through
     * status, logs and list for audit. Empty when the worker is running or recent enough.
     */
    tooOldReason(worker: RoutedWorker): string {
        if (worker.active || this.now() - worker.lastActivityAt <= WORKER_MAX_IDLE_MS) { return ''; }
        return `idle more than ${WORKER_MAX_IDLE_MS / 3_600_000} hours; read it with status/logs but start a fresh worker for new work`;
    }

    /** Remaining time on the active run plus every queued estimate. */
    estimatedWaitSeconds(worker: RoutedWorker): number {
        const active = worker.active
            ? Math.max(0, worker.active.estimatedSeconds - (this.now() - (worker.active.startedAt ?? this.now())) / 1000)
            : 0;
        return active + worker.queue.reduce((sum, entry) => sum + entry.estimatedSeconds, 0);
    }

    private isExpired(worker: RoutedWorker): boolean {
        return !worker.active && this.now() - worker.lastActivityAt > this.cacheTtlMs;
    }

    private ineligibility(worker: RoutedWorker, checkWait = true, allowExpired = false): string {
        if (worker.state === 'RETIRED' || worker.state === 'ORPHANED') { return worker.state.toLowerCase(); }
        if (worker.contextTokens > MAX_CONTEXT_TOKENS) { return `context ${worker.contextTokens} > ${MAX_CONTEXT_TOKENS}`; }
        const tooOld = this.tooOldReason(worker);
        if (tooOld) { return tooOld; }
        if (!worker.active && this.now() - worker.lastActivityAt > this.cacheTtlMs
            && !(allowExpired && worker.contextTokens < EXPIRED_REUSE_MAX_CONTEXT_TOKENS)) { return 'cache expired'; }
        if (!checkWait) { return ''; }
        if (worker.busyElsewhere) { return 'running in another window'; }
        const wait = this.estimatedWaitSeconds(worker);
        if (wait > MAX_QUEUE_WAIT_SECONDS) { return `estimated wait ${wait}s > ${MAX_QUEUE_WAIT_SECONDS}s`; }
        return '';
    }

    private createWorker(registryKey: string, workspacePath: string, profile: string, model: string, thinking: string, cwd: string): RoutedWorker {
        const worker: RoutedWorker = {
            workerId: this.nextId('worker'), registryKey, workspacePath, cwd, profile, model, thinking,
            state: 'IDLE', contextTokens: 0, lastActivityAt: this.now(), queue: [],
        };
        this.workersById.set(worker.workerId, worker);
        return worker;
    }

    private start(worker: RoutedWorker, entry: QueueEntry): void {
        entry.startedAt = this.now();
        worker.active = entry;
        worker.state = 'RUNNING';
        worker.lastActivityAt = this.now();
    }

    // The host prefix keeps IDs unique across extension reloads, which share one ledger.
    private nextId(kind: 'worker' | 'run'): string {
        return `${kind}-${this.hostId}-${++this.sequence}`;
    }
}
