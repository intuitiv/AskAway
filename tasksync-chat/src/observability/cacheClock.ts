import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The provider's prompt cache expires ~5 min after a request STARTS. Tool waits used to be timed from the tool's own
 * start, which is later by the whole model response, so a 240s wait after a slow response still missed the cache.
 */
export const CACHE_TTL_MS = 300_000;
const MARGIN_MS = 30_000;
const FLOOR_MS = 5_000;

export const cacheClockFile = (): string => path.join(os.homedir(), '.askaway', 'cache-clock.json');

let lastRequestStart = 0;
const bySession: Record<string, number> = {};

/** Called with each observed model request start; persisted per chat session so hook processes can read it. */
export function noteRequestStart(ts: number, sessionId?: string, file = cacheClockFile()): void {
    if (ts > lastRequestStart) { lastRequestStart = ts; }
    if (!sessionId || ts <= (bySession[sessionId] ?? 0)) { return; }
    bySession[sessionId] = ts;
    // Replaying old logs at startup must not rewrite the file hundreds of times; only a live cache matters to hooks.
    if (Date.now() - ts >= CACHE_TTL_MS) { return; }
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const recent = Object.entries(bySession).filter(([, t]) => ts - t < 86_400_000);
        fs.writeFileSync(`${file}.tmp`, JSON.stringify({ lastRequestStart, sessions: Object.fromEntries(recent) }));
        fs.renameSync(`${file}.tmp`, file);
    } catch { /* the clock is advisory */ }
}

/** How long a blocking wait may last so the next model request still hits the cache; the requested time once it is cold anyway. */
export function cacheSafeWaitMs(requestedMs: number, now = Date.now(), last = lastRequestStart): number {
    if (!last || now - last >= CACHE_TTL_MS) { return requestedMs; }
    return Math.max(FLOOR_MS, Math.min(requestedMs, last + CACHE_TTL_MS - MARGIN_MS - now));
}
