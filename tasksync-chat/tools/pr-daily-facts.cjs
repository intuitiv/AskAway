#!/usr/bin/env node
// Daily PR routine, step 0: read-only facts about this workspace's branch and PR, plus whether it can run.
// Run from the workspace: node ~/PycharmProjects/TaskSync/tasksync-chat/tools/pr-daily-facts.cjs [--cwd dir] [--no-fetch]
// Prints one JSON object. Never commits, rebases, pushes, or edits files.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const cwd = path.resolve(flag('--cwd', process.cwd()));
const now = Number(flag('--now', String(Date.now())));
const gh = process.env.PR_DAILY_GH || 'gh';

function run(cmd, cmdArgs, { raw = false } = {}) {
    try {
        const out = childProcess.execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
        return { ok: true, out: raw ? out : out.trim() };
    } catch (error) {
        return { ok: false, out: String(error.stdout || '').trim(), err: String(error.stderr || error.message).trim().split('\n')[0] };
    }
}
const git = (...a) => run('git', a);
const ghJson = (...a) => { const r = run(gh, a); if (!r.ok) { return { error: r.err }; } try { return JSON.parse(r.out); } catch { return { error: 'unparsable gh output' }; } };

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function checksSummary(rollup) {
    const failing = [];
    const pending = [];
    let passing = 0;
    for (const c of Array.isArray(rollup) ? rollup : []) {
        const name = c.name || c.context || 'check';
        const outcome = String(c.conclusion || c.state || '').toUpperCase();
        if (FAILED.has(outcome)) { failing.push({ name, outcome, url: c.detailsUrl || c.targetUrl }); }
        else if ((c.status && c.status !== 'COMPLETED') || outcome === 'PENDING' || outcome === 'EXPECTED' || !outcome) { pending.push(name); }
        else { passing++; }
    }
    return { passing, failing, pending };
}

function main() {
    const top = git('rev-parse', '--show-toplevel');
    if (!top.ok) { return { cwd, action: 'refuse', reasons: ['not a git repository'] }; }
    const root = top.out;
    const gitDir = path.resolve(root, git('rev-parse', '--git-dir').out);
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').out;

    const repo = ghJson('repo', 'view', '--json', 'owner,name,defaultBranchRef');
    const defaultBranch = repo.defaultBranchRef?.name
        || git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').out.replace(/^origin\//, '') || 'main';
    const fetched = args.includes('--no-fetch') ? undefined : git('fetch', '--quiet', 'origin');

    const operation = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']
        .find((name) => fs.existsSync(path.join(gitDir, name)));
    const dirty = run('git', ['status', '--porcelain'], { raw: true }).out.split('\n').filter(Boolean);
    const upstream = git('rev-parse', '--abbrev-ref', '@{u}');
    const count = (range) => { const r = git('rev-list', '--count', range); return r.ok ? Number(r.out) : undefined; };

    const reasons = [];
    // A half-done rebase or merge is the reviewer's to finish; committing or rebasing over it would lose work.
    if (operation) { reasons.push(`git ${operation} in progress: finish or abort it first`); }
    if (branch === 'HEAD' || branch === defaultBranch) {
        reasons.push(branch === 'HEAD' ? 'detached HEAD' : `on ${defaultBranch}: never pushed directly`);
    }
    const action = reasons.length ? 'refuse' : 'run';

    const prView = ghJson('pr', 'view', '--json', 'number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,body');
    let pr = null;
    if (!prView.error) {
        const threads = repo.owner && !prView.error ? ghJson('api', 'graphql',
            '-f', 'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login} body url}}}}}}}',
            '-F', `owner=${repo.owner.login}`, '-F', `name=${repo.name}`, '-F', `number=${prView.number}`) : { error: 'no repo' };
        const nodes = threads.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
        pr = {
            number: prView.number, url: prView.url, title: prView.title, state: prView.state, draft: !!prView.isDraft,
            mergeable: prView.mergeable, mergeState: prView.mergeStateStatus, reviewDecision: prView.reviewDecision || null,
            checks: checksSummary(prView.statusCheckRollup),
            unresolvedThreads: nodes.filter((t) => !t.isResolved).map((t) => ({
                path: t.path, line: t.line, author: t.comments?.nodes?.[0]?.author?.login,
                excerpt: String(t.comments?.nodes?.[0]?.body || '').replace(/\s+/g, ' ').slice(0, 160), url: t.comments?.nodes?.[0]?.url,
            })),
            threadsError: threads.error,
            openTasks: String(prView.body || '').split(/\r?\n/).filter((l) => /^\s*[-*] \[ \]/.test(l)).map((l) => l.replace(/^\s*[-*] \[ \]\s*/, '').slice(0, 160)),
        };
    }
    const reviewRequests = ghJson('pr', 'list', '--search', 'review-requested:@me', '--json', 'number,title,url,author');
    const weekday = new Date(now).getDay();

    return {
        cwd: root, branch, defaultBranch, action, reasons,
        git: {
            operation: operation || null, dirtyFiles: dirty.length, upstream: upstream.ok ? upstream.out : null,
            aheadOfUpstream: upstream.ok ? count('@{u}..HEAD') : null, behindDefault: count(`HEAD..origin/${defaultBranch}`),
            fetch: fetched === undefined ? 'skipped' : fetched.ok ? 'ok' : `failed: ${fetched.err}`,
        },
        pr, prError: prView.error && !/no pull requests found/i.test(prView.error) ? prView.error : undefined,
        reviewRequests: Array.isArray(reviewRequests) ? reviewRequests.map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author?.login })) : [],
        mergeWindow: weekday === 4 || weekday === 5,
    };
}

process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
