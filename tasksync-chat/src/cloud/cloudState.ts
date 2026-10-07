import { CloudRun } from './cloudQueue';

interface Identity { login: string; type: string }
interface App { slug: string }
export interface PrSignals {
    at: string;
    branch: string;
    state: string;
    reactions: Array<{ user: Identity; content: string; created_at: string }>;
    timeline: Array<{ id: number; event: string; created_at: string; performed_via_github_app?: App }>;
    commits: Array<{ sha: string; html_url: string; author: Identity; parents: Array<{ sha: string }>;
        commit: { message: string; author: { name: string; date: string } } }>;
    checkRuns: { check_runs: Array<{ name: string; head_sha: string; status: string; conclusion: string | null; html_url: string }> };
    comments: Array<{ body: string; html_url: string; created_at: string; user: Identity; performed_via_github_app?: App }>;
}
export function deriveCloudState(run: CloudRun, signals: PrSignals, agentLogins = ['Copilot']): CloudRun {
    const next: CloudRun = structuredClone(run);
    if (['Held', 'Accepted', 'Returned', 'Timed out', 'No response'].includes(run.state)) { return next; }
    const record = (state: string, at: string, signal: string) => {
        if (!next.history.some(entry => entry.signal === signal && entry.at === at)) { next.history.push({ state, at, signal }); }
    };
    if (signals.branch !== run.branch || signals.state !== 'open') {
        next.state = 'Returned'; record(next.state, signals.at, 'PR closed or branch changed'); return next;
    }
    const bot = (user: Identity | undefined) => user?.type === 'Bot' && agentLogins.includes(user.login);
    const events = signals.timeline.filter(event => event.performed_via_github_app?.slug === 'copilot-swe-agent' && event.created_at >= run.queuedAt);
    const start = events.find(event => event.event === 'copilot_work_started');
    const eyes = signals.reactions.find(reaction => bot(reaction.user) && reaction.content === 'eyes' && reaction.created_at >= run.queuedAt);
    if (start) { next.startedAt = start.created_at; record('Working', start.created_at, `copilot_work_started:${start.id}`); }
    if (eyes) { record('Working', eyes.created_at, 'eyes'); }
    const finish = events.find(event => event.event === 'copilot_work_finished');
    if (finish) { next.endedAt = finish.created_at; record(next.state, finish.created_at, `copilot_work_finished:${finish.id}`); }
    // Only commits reachable after our packet on this PR may authenticate a report.
    const reachable = new Set([run.packetSha]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const commit of signals.commits) {
            if (!reachable.has(commit.sha) && commit.parents.some(parent => reachable.has(parent.sha))) {
                reachable.add(commit.sha); changed = true;
            }
        }
    }
    const commits = signals.commits.filter(commit => commit.sha !== run.packetSha && reachable.has(commit.sha) &&
        bot(commit.author) && commit.commit.author.name === 'copilot-swe-agent[bot]' &&
        commit.commit.message.startsWith(`[${run.taskId}]`) && !commit.commit.message.includes('AskAway-Commit:'));
    next.commits = commits.map(commit => ({ sha: commit.sha, author: commit.author.login, at: commit.commit.author.date, url: commit.html_url }));
    const latest = commits.at(-1);
    const observedChecks = signals.checkRuns.check_runs.filter(check => check.head_sha === latest?.sha)
        .map(check => ({ name: check.name, status: check.status, conclusion: check.conclusion, url: check.html_url }));
    next.checkRuns = observedChecks.length ? observedChecks : (run.commits?.at(-1)?.sha === latest?.sha ? run.checkRuns ?? [] : []);
    let state = start || eyes ? 'Working' : run.state;
    if (latest) {
        state = 'Pushed'; record(state, latest.commit.author.date, `commit:${latest.sha}`);
        const checks = next.checkRuns;
        if (checks.some(check => check.conclusion === 'action_required')) { state = 'Checks waiting for approval'; }
        else if (checks.some(check => ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(check.conclusion ?? ''))) { state = 'Checks failed'; }
        else if (checks.length && checks.every(check => check.status === 'completed' && ['success', 'neutral', 'skipped'].includes(check.conclusion ?? ''))) { state = 'Checks passed'; }
    }
    for (const comment of signals.comments) {
        if (!bot(comment.user) || comment.performed_via_github_app?.slug !== 'copilot-swe-agent' ||
            !comment.html_url.startsWith(run.pr + '#issuecomment-') || comment.created_at < run.queuedAt) { continue; }
        // Quoted and fenced text is context, never an agent report.
        let fenced = false;
        const lines = comment.body.split(/\r?\n/).filter(line => {
            if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return false; }
            return !fenced && !/^\s*>/.test(line);
        });
        const index = lines.findIndex(line => line.trim() === `Report ${run.taskId}`);
        if (index < 0) { continue; }
        const section = lines.slice(index + 1);
        const value = (name: string) => section.find(line => line.startsWith(`- ${name}:`))?.slice(name.length + 3).trim() ?? '';
        const result = value('Result');
        if (!['done', 'blocked'].includes(result)) { continue; }
        const claimed = value('Commits').split(/[\s,]+/).filter(Boolean);
        if (claimed.some(sha => !/^[a-f0-9]{7,40}$/.test(sha) || !commits.some(commit => commit.sha.startsWith(sha)))) { continue; }
        if (result === 'done' && !claimed.length) { continue; }
        const model = value('Model') || 'not observed: report omitted model';
        next.report = { url: comment.html_url, result, verifyOutput: value('Verify output'),
            commands: [...run.request.task.verify], question: value('Question (if blocked)') || value('Question'), model: `self-reported: ${model}` };
        next.model = next.report.model;
        next.decisionNeeded = next.report.question || undefined;
        next.endedAt = comment.created_at;
        record('Needs review', comment.created_at, `report:${comment.html_url}`);
    }
    next.state = next.report ? 'Needs review' : state;
    if (next.state !== run.state) { record(next.state, signals.at, `state:${next.state}`); }
    return next;
}
