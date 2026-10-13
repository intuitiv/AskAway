// Standard GitHub-hosted runner rates verified 2026-10-12:
// https://docs.github.com/en/billing/reference/actions-minute-multipliers
export const ACTIONS_USD_PER_MINUTE = { Linux: 0.006, Windows: 0.010, macOS: 0.062 } as const;
export const CLOUD_PREMIUM_REQUEST_USD = 0.04;

type TaskRuns = { endedAt?: string; queuedAt: string; workflowRuns?: Array<{ id: number; status: string; timing?: Array<{ os: string; billableMs: number }> }>; agentSessions?: Array<{ id: string }> };
/** A finished cloud task's estimate from its own matched workflow runs and Copilot sessions; undefined until every run has timing. */
export function cloudTaskCost(task: TaskRuns): { dollars: number; at: string; workflowRuns: number[]; sessions: string[] } | undefined {
    const runs = task.workflowRuns ?? [];
    if (runs.some(run => run.status !== 'completed' || !run.timing?.length)) return undefined;
    const minutes = runs.flatMap(run => run.timing!).reduce((sum, item) => {
        const rate = ACTIONS_USD_PER_MINUTE[item.os as keyof typeof ACTIONS_USD_PER_MINUTE];
        return sum + (rate && Number.isFinite(item.billableMs) && item.billableMs >= 0 ? item.billableMs / 60000 * rate : NaN);
    }, 0);
    const sessions = (task.agentSessions ?? []).map(session => session.id);
    const dollars = minutes + sessions.length * CLOUD_PREMIUM_REQUEST_USD;
    if (!Number.isFinite(dollars)) return undefined;
    return { dollars, at: task.endedAt ?? task.queuedAt, workflowRuns: runs.map(run => run.id), sessions };
}
