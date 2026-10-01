/** Keep-warm decision logic (spec 005 T018): which idle workers get a one-line ping so their prompt cache survives. */

export const KEEP_WARM_MAIN_ACTIVE_MS = 300_000;
export const KEEP_WARM_LEAD_MS = 60_000;
export const KEEP_WARM_MAX_CONTEXT_TOKENS = 300_000;
export const KEEP_WARM_MAX_UNUSED_PINGS = 2;
export { KEEP_WARM_PROMPT } from './workerRouter';

export interface KeepWarmWorker {
    workerId: string;
    state: string;
    /** A run is active. */
    active: boolean;
    queued: number;
    /** Router `cacheExpiresAt`: 0 when the worker is running or never reusable. */
    cacheExpiresAt: number;
    nextInputTokens: number;
    /** Pings sent since the worker's last real run. */
    unusedPings: number;
    /** A ping is already in flight. */
    pinging?: boolean;
}

/** Worker ids to ping now: idle, queue empty, cache alive but expiring within the lead time, main chat active, within limits. */
export function workersToPing(workers: KeepWarmWorker[], now: number, mainActiveAt: number): string[] {
    if (!mainActiveAt || now - mainActiveAt > KEEP_WARM_MAIN_ACTIVE_MS) { return []; }
    return workers.filter((worker) => worker.state === 'IDLE' && !worker.active && worker.queued === 0 && !worker.pinging
        && worker.cacheExpiresAt > now && worker.cacheExpiresAt - now <= KEEP_WARM_LEAD_MS
        && worker.nextInputTokens < KEEP_WARM_MAX_CONTEXT_TOKENS && worker.unusedPings < KEEP_WARM_MAX_UNUSED_PINGS)
        .map((worker) => worker.workerId);
}

export const KEEP_WARM_INTERVAL_MS = 20_000;

/** What the tick needs from the worker runtime (OpenCodeWorkerRuntime satisfies it). */
export interface KeepWarmRuntime {
    now: () => number;
    keepWarmWorkers(workspacePath: string): KeepWarmWorker[];
    ping(workerId: string, fetchImpl?: typeof fetch): Promise<{ status: string }>;
}

/** One check: pings every worker `workersToPing` selects and returns the ids that were pinged. */
export async function keepWarmTick(runtime: KeepWarmRuntime, workspacePath: string, mainActiveAt: number, fetchImpl?: typeof fetch): Promise<string[]> {
    const pinged: string[] = [];
    for (const workerId of workersToPing(runtime.keepWarmWorkers(workspacePath), runtime.now(), mainActiveAt)) {
        if ((await runtime.ping(workerId, fetchImpl)).status === 'PINGED') { pinged.push(workerId); }
    }
    return pinged;
}

export interface KeepWarmTimerOptions {
    /** The `askaway.workers.keepWarm` setting, read on every tick. */
    enabled: () => boolean;
    /** When the main chat last had a request; 0 when unknown or cold. */
    mainActiveAt: (now: number) => number;
    intervalMs?: number;
    fetchImpl?: typeof fetch;
}

/** Runs `keepWarmTick` on an interval while a runtime exists and the setting is on. Returns a stop function. */
export function startKeepWarmTimer(getRuntime: () => KeepWarmRuntime | undefined, workspacePath: string, options: KeepWarmTimerOptions): () => void {
    let running = false;
    const timer = setInterval(() => {
        const runtime = getRuntime();
        if (running || !runtime || !options.enabled()) { return; }
        running = true;
        keepWarmTick(runtime, workspacePath, options.mainActiveAt(runtime.now()), options.fetchImpl)
            .catch(() => undefined)
            .finally(() => { running = false; });
    }, options.intervalMs ?? KEEP_WARM_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
}
