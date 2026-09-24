import { resolveSelection, workerRegistryKey, WorkerProfile } from './workerProfiles';

export const MAX_QUEUE_WAIT_SECONDS = 120;
export const MAX_CONTEXT_TOKENS = 300000;
export const DEFAULT_CACHE_TTL_SECONDS = 300;

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
    workspacePath: string;
    profile: string;
    model: string;
    thinking: string;
    state: RoutedWorkerState;
    contextTokens: number;
    lastActivityAt: number;
    retiredReason?: string;
    active?: QueueEntry;
    queue: QueueEntry[];
}

export interface RouteRequest {
    workspacePath: string;
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
    private readonly now: () => number;
    private readonly cacheTtlMs: number;
    private sequence = 0;
    private readonly hostId = Math.random().toString(36).slice(2, 8);
    dispatches = 0;

    constructor(profiles: WorkerProfile[], options: RouterOptions = {}) {
        this.profiles = new Map(profiles.map((profile) => [profile.name, profile]));
        this.now = options.now ?? Date.now;
        this.cacheTtlMs = (options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
    }

    route(request: RouteRequest): RouteResult {
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
        const eligible = [...this.workersById.values()]
            .filter((worker) => worker.registryKey === registryKey)
            .filter((worker) => {
                const reason = this.ineligibility(worker);
                if (reason) { rejections.push(`${worker.workerId}: ${reason}`); }
                return !reason;
            })
            .sort((a, b) => this.estimatedWaitSeconds(a) - this.estimatedWaitSeconds(b) || a.workerId.localeCompare(b.workerId));

        const reused = eligible[0];
        const worker = reused ?? this.createWorker(registryKey, request.workspacePath, profile.name, selection.model, selection.thinking);
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
            reason: reused ? 'compatible warm worker within wait bound' : (rejections.length ? `no eligible worker (${rejections.join('; ')})` : 'no compatible worker'),
        };
    }

    /** Queues work on one named worker, refusing explicitly when that worker is no longer eligible. */
    submitTo(workerId: string, packetId: string, estimatedSeconds: number): RouteResult | { status: 'RETIRED' | 'INELIGIBLE'; workerId: string; reason: string } {
        const worker = this.workersById.get(workerId);
        if (!worker) { return { status: 'INELIGIBLE', workerId, reason: 'unknown worker' }; }
        if (worker.state === 'RETIRED') { return { status: 'RETIRED', workerId, reason: worker.retiredReason || 'retired' }; }
        const reason = this.ineligibility(worker);
        if (reason) { return { status: 'INELIGIBLE', workerId, reason }; }
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

    /** Only a not-yet-started entry can be cancelled; running work is never cancelled here. */
    cancelQueued(workerId: string, runId: string): { status: 'CANCELLED' | 'NOT_QUEUED' } {
        const worker = this.workersById.get(workerId);
        const index = worker ? worker.queue.findIndex((entry) => entry.runId === runId) : -1;
        if (!worker || index < 0) { return { status: 'NOT_QUEUED' }; }
        worker.queue.splice(index, 1);
        return { status: 'CANCELLED' };
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
    adopt(record: Pick<RoutedWorker, 'workerId' | 'workspacePath' | 'profile' | 'model' | 'thinking' | 'contextTokens' | 'lastActivityAt'>,
        state: 'IDLE' | 'ORPHANED', reason?: string): void {
        const existing = this.workersById.get(record.workerId);
        if (existing) {
            if (existing.state === 'ORPHANED' || existing.state === 'IDLE') { existing.state = state; existing.retiredReason = reason; }
            return;
        }
        this.workersById.set(record.workerId, {
            ...record, registryKey: workerRegistryKey(record.workspacePath, record.profile, record), state, retiredReason: reason, queue: [],
        });
    }

    worker(workerId: string): RoutedWorker | undefined {
        return this.workersById.get(workerId);
    }

    /** When an idle worker's prompt cache goes cold and it stops being reusable; 0 while running or when never reusable. */
    cacheExpiresAt(worker: RoutedWorker): number {
        if (worker.active || worker.state === 'RETIRED' || worker.state === 'ORPHANED') { return 0; }
        return worker.lastActivityAt + this.cacheTtlMs;
    }

    workers(workspacePath?: string): RoutedWorker[] {
        const all = [...this.workersById.values()];
        if (!workspacePath) { return all; }
        const prefix = workerRegistryKey(workspacePath, '', { model: '', thinking: '' }).split('::')[0];
        return all.filter((worker) => worker.registryKey.split('::')[0] === prefix);
    }

    /** Remaining time on the active run plus every queued estimate. */
    estimatedWaitSeconds(worker: RoutedWorker): number {
        const active = worker.active
            ? Math.max(0, worker.active.estimatedSeconds - (this.now() - (worker.active.startedAt ?? this.now())) / 1000)
            : 0;
        return active + worker.queue.reduce((sum, entry) => sum + entry.estimatedSeconds, 0);
    }

    private ineligibility(worker: RoutedWorker): string {
        if (worker.state === 'RETIRED' || worker.state === 'ORPHANED') { return worker.state.toLowerCase(); }
        if (worker.contextTokens > MAX_CONTEXT_TOKENS) { return `context ${worker.contextTokens} > ${MAX_CONTEXT_TOKENS}`; }
        if (!worker.active && this.now() - worker.lastActivityAt > this.cacheTtlMs) { return 'cache expired'; }
        const wait = this.estimatedWaitSeconds(worker);
        if (wait > MAX_QUEUE_WAIT_SECONDS) { return `estimated wait ${wait}s > ${MAX_QUEUE_WAIT_SECONDS}s`; }
        return '';
    }

    private createWorker(registryKey: string, workspacePath: string, profile: string, model: string, thinking: string): RoutedWorker {
        const worker: RoutedWorker = {
            workerId: this.nextId('worker'), registryKey, workspacePath, profile, model, thinking,
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
