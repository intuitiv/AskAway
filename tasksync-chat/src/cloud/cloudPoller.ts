import { CloudRun, QueueIO, defaultIO, releaseHeld, serial } from './cloudQueue';
import { deriveCloudState, PrSignals } from './cloudState';

export async function pollPr(root: string, pr: string, io: QueueIO = defaultIO, agentLogins = ['Copilot'], now = Date.now(), pollMinutes = 3): Promise<CloudRun[]> {
    const updated = await serial(root, async () => {
        const runs = await io.load(root);
        const relevant = runs.filter(run => run.pr === pr && !['Held', 'Needs review', 'Accepted', 'Returned', 'Timed out', 'No response'].includes(run.state));
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
            const next = deriveCloudState(run, { at, branch: info.head.ref, state: info.state,
                timeline: timeline.flat(), commits: commits.flat(), comments: comments.flat(), reactions: reactions.flat(), checkRuns }, agentLogins);
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
