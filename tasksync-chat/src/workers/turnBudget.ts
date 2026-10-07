/** Same conversion as the chat banner (media/webview.js chatBannerHtml): $1 = 100 AIU. */
export const AIU_PER_DOLLAR = 100;

export function turnTotals(main: { requestCount: number; nanoAiu: number; inputTokens?: number; outputTokens?: number }, worker: { requests: number; dollars: number; runs: number; workers?: number; workerIds?: string[]; inputTokens?: number; outputTokens?: number }) {
    return { requests: main.requestCount + worker.requests, dollars: main.nanoAiu / 1e9 / AIU_PER_DOLLAR + worker.dollars,
        workers: worker.workers ?? 0, workerIds: worker.workerIds ?? [], workerRuns: worker.runs,
        inputTokens: (main.inputTokens ?? 0) + (worker.inputTokens ?? 0), outputTokens: (main.outputTokens ?? 0) + (worker.outputTokens ?? 0) };
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
