import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function persistTurnTotals(workspace: string, turnStartedAt: number, totals: ReturnType<typeof turnTotals>): void {
    if (!turnStartedAt) { return; }
    let canonical = workspace;
    try { canonical = fs.realpathSync(workspace); } catch { /* retain literal workspace key */ }
    const key = canonical.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const dir = path.join(os.homedir(), '.askaway', 'turn-totals');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({ turnStartedAt, spentAiu: totals.dollars * AIU_PER_DOLLAR, requests: totals.requests }));
}

/** Same conversion as the chat banner (media/webview.js chatBannerHtml): $1 = 100 AIU. */
export const AIU_PER_DOLLAR = 100;

export function turnTotals(main: { requestCount: number; nanoAiu: number; inputTokens?: number; outputTokens?: number; cachedTokens?: number }, worker: { requests: number; dollars: number; runs: number; workers?: number; workerIds?: string[]; inputTokens?: number; outputTokens?: number; cachedTokens?: number }) {
    return { requests: main.requestCount + worker.requests, dollars: main.nanoAiu / 1e9 / AIU_PER_DOLLAR + worker.dollars,
        workers: worker.workers ?? 0, workerIds: worker.workerIds ?? [], workerRuns: worker.runs,
        inputTokens: (main.inputTokens ?? 0) + (worker.inputTokens ?? 0), outputTokens: (main.outputTokens ?? 0) + (worker.outputTokens ?? 0),
        cachedTokens: (main.cachedTokens ?? 0) + (worker.cachedTokens ?? 0) };
}

export function usageScope(main: Parameters<typeof turnTotals>[0], worker: Parameters<typeof turnTotals>[1]) {
    const totals = turnTotals(main, worker);
    return { ...main, requestCount: totals.requests, nanoAiu: Math.round(totals.dollars * 100 * 1e9),
        inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, cachedTokens: totals.cachedTokens };
}

export function mergeToolUsage<T extends { tool: string; calls: number; outputTokens: number; avgMs: number; minMs: number; maxMs: number; errors: number; cacheRisk: boolean }>(main: T[], workers: T[]): T[] {
    const rows = new Map(main.map(row => [row.tool, { ...row }]));
    for (const worker of workers) {
        const row = rows.get(worker.tool);
        if (!row) { rows.set(worker.tool, { ...worker }); continue; }
        row.avgMs = (row.avgMs * row.calls + worker.avgMs * worker.calls) / (row.calls + worker.calls);
        row.calls += worker.calls; row.outputTokens += worker.outputTokens; row.errors += worker.errors;
        row.minMs = Math.min(row.minMs, worker.minMs); row.maxMs = Math.max(row.maxMs, worker.maxMs);
        row.cacheRisk ||= worker.cacheRisk;
    }
    return [...rows.values()];
}

export interface TurnBudget {
    mainAiu: number;
    workerAiu: number;
    workerRuns: number;
    spentAiu: number;
    limitAiu: number;
    exceeded: boolean;
}

/** Main-agent credits plus worker dollars for the same turn, against the soft limit (0 = no limit). */
export function turnBudget(mainNanoAiu: number, workerDollars: number, workerRuns: number, limitAiu: number): TurnBudget {
    const mainAiu = mainNanoAiu / 1e9;
    const workerAiu = workerDollars * AIU_PER_DOLLAR;
    const spentAiu = mainAiu + workerAiu;
    const limit = limitAiu > 0 ? limitAiu : 0;
    return { mainAiu, workerAiu, workerRuns, spentAiu, limitAiu: limit, exceeded: limit > 0 && spentAiu >= limit };
}
