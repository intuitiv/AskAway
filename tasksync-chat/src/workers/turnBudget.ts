/** Same conversion as the chat banner (media/webview.js chatBannerHtml): $1 = 100 AIU. */
export const AIU_PER_DOLLAR = 100;

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
