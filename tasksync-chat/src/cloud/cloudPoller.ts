import { CloudRun, QueueIO, defaultIO, releaseHeld, serial } from './cloudQueue';
import { deriveCloudState, PrSignals } from './cloudState';

export async function pollPr(root: string, pr: string, io: QueueIO = defaultIO, agentLogins = ['Copilot'], now = Date.now(), pollMinutes = 3): Promise<CloudRun[]> {
    const updated = await serial(root, async () => {
        const runs = await io.load(root);
        const relevant = runs.filter(run => run.pr === pr && run.state !== 'Held');
        if (!relevant.length) { return runs; }
        if (relevant.some(run => Date.parse(run.nextPollAt ?? '') > now)) { return runs; }
        const at = new Date(now).toISOString();
        try {
        const [, , , owner, repo, , number] = pr.split('/');
        const prefix = `repos/${owner}/${repo}`;
        const info = await io.gh.json<{ state: string; head: { ref: string; sha: string } }>(['api', `${prefix}/pulls/${number}`]);
        const timeline = await io.gh.json<PrSignals['timeline']>(['api', '--paginate', '--slurp', `${prefix}/issues/${number}/timeline?per_page=100`]);
        const commits = await io.gh.json<PrSignals['commits']>(['api', '--paginate', '--slurp', `${prefix}/pulls/${number}/commits?per_page=100`]);
        const comments = await io.gh.json<PrSignals['comments']>(['api', '--paginate', '--slurp', `${prefix}/issues/${number}/comments?per_page=100`]);
        const checkRuns = await io.gh.json<PrSignals['checkRuns']>(['api', `${prefix}/commits/${info.head.sha}/check-runs?per_page=100`]);
        for (const run of relevant) {
            const reactions = await io.gh.json<PrSignals['reactions']>(['api', '--paginate', '--slurp', `${prefix}/issues/comments/${run.commentId}/reactions?per_page=100`]);
            const next = ['Needs review', 'Accepted', 'Returned', 'Timed out', 'No response'].includes(run.state) ? structuredClone(run)
                : deriveCloudState(run, { at, branch: info.head.ref, state: info.state,
                    timeline: timeline.flat(), commits: commits.flat(), comments: comments.flat(), reactions: reactions.flat(), checkRuns }, agentLogins);
            // Cost collection cannot invalidate the independently observed task progress.
            try {
                const workflows = await io.gh.json<Array<{ databaseId: number; status: string; headSha: string }>>(
                    ['run', 'list', '--repo', `${owner}/${repo}`, '--branch', run.branch, '--limit', '1000', '--json', 'databaseId,status,headSha']);
                const owned = new Set([run.packetSha, ...(next.commits ?? []).map(commit => commit.sha), ...(run.commits ?? []).map(commit => commit.sha)]);
                next.workflowRuns ??= [];
                for (const workflow of workflows) {
                    if (!owned.has(workflow.headSha)) continue;
                    let stored = next.workflowRuns.find(item => item.id === workflow.databaseId);
                    if (!stored) { stored = { id: workflow.databaseId, workspace: root, headSha: workflow.headSha, status: workflow.status, ts: at }; next.workflowRuns.push(stored); }
                    stored.status = workflow.status;
                    if (stored.status !== 'completed' || stored.timing) continue;
                    const cached = runs.flatMap(item => item.workflowRuns ?? []).find(item => item.id === stored!.id && item.timing);
                    if (cached) { stored.timing = cached.timing; continue; }
                    const timing = await io.gh.json<{ billable?: Record<string, { total_ms: number }>; run_duration_ms?: number }>(['api', `${prefix}/actions/runs/${stored.id}/timing`]);
                    const duration = timing.run_duration_ms ?? 0;
                    const billable = Object.entries(timing.billable ?? {}).filter(([, value]) => Number.isFinite(value.total_ms) && value.total_ms > 0);
                    const extracted = billable.flatMap(([os, value]) => ['Linux', 'Windows', 'macOS'].includes(os)
                        ? [{ os: os as 'Linux' | 'Windows' | 'macOS', billableMs: value.total_ms, runDurationMs: duration, estimated: true }] : []);
                    if (extracted.length) stored.timing = extracted;
                    if (!billable.length) {
                        const jobs = await io.gh.json<{ jobs: Array<{ labels?: string[] }> }>(['api', `${prefix}/actions/runs/${stored.id}/jobs`]);
                        const labels = jobs.jobs.flatMap(job => job.labels ?? []).join(' ').toLowerCase();
                        const os = /macos|macosx/.test(labels) ? 'macOS' : /windows/.test(labels) ? 'Windows' : /ubuntu|linux/.test(labels) ? 'Linux' : undefined;
                        if (os && Number.isFinite(duration) && duration >= 0) stored.timing = [{ os, billableMs: duration, runDurationMs: duration, estimated: true }];
                    }
                }
                next.agentSessions ??= [];
                for (const event of timeline.flat()) {
                    if (event.event !== 'copilot_work_started' || event.performed_via_github_app?.slug !== 'copilot-swe-agent' || event.created_at < run.queuedAt || (run.endedAt && event.created_at > run.endedAt)) continue;
                    const id = `${owner}/${repo}:${event.id}`;
                    if (!next.agentSessions.some(session => session.id === id)) next.agentSessions.push({ id, ts: event.created_at });
                }
            } catch { /* Retry missing cost facts next poll; never invent billing data. */ }
            delete next.staleSince;
            next.pollFailures = 0;
            next.nextPollAt = new Date(now + Math.min(15, Math.max(1, pollMinutes)) * 60000).toISOString();
            runs[runs.indexOf(run)] = next;
        }
        } catch {
            // Failed snapshots cannot establish a state transition or elapsed-time exit.
            for (const run of relevant) {
                run.staleSince ??= at;
                run.pollFailures = (run.pollFailures ?? 0) + 1;
                run.nextPollAt = new Date(now + Math.min(15, Math.max(1, pollMinutes) * 2 ** run.pollFailures) * 60000).toISOString();
            }
        }
        await io.save(root, runs);
        return runs;
    });
    // This only releases a stored explicit request; it never discovers or queues eligible tasks.
    await releaseHeld(root, pr, io);
    return updated;
}
