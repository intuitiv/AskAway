// Daily PR routine, step 0: the facts script decides run / pause / refuse and reports the PR, from the caller's view.
// Real git (a bare origin + a clone); only the GitHub CLI is faked. Run: node test-pr-daily-facts.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-pr-daily-')));
const home = path.join(tmp, 'home');
const origin = path.join(tmp, 'origin.git');
const ws = path.join(tmp, 'app');
const sh = (cwd, ...a) => childProcess.execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
fs.mkdirSync(home);
const gitEnv = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
Object.assign(process.env, gitEnv);

sh(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
sh(tmp, 'clone', '--quiet', origin, ws);
fs.writeFileSync(path.join(ws, 'a.txt'), 'one\n');
sh(ws, 'add', '.'); sh(ws, 'commit', '--quiet', '-m', 'base'); sh(ws, 'push', '--quiet', 'origin', 'main');
sh(ws, 'checkout', '--quiet', '-b', 'feature/x');
fs.writeFileSync(path.join(ws, 'b.txt'), 'two\n');
sh(ws, 'add', '.'); sh(ws, 'commit', '--quiet', '-m', 'feature'); sh(ws, 'push', '--quiet', '-u', 'origin', 'feature/x');
// A teammate lands a commit on main, so the branch is one behind.
const other = path.join(tmp, 'other');
sh(tmp, 'clone', '--quiet', origin, other);
fs.writeFileSync(path.join(other, 'c.txt'), 'three\n');
sh(other, 'add', '.'); sh(other, 'commit', '--quiet', '-m', 'main moves'); sh(other, 'push', '--quiet', 'origin', 'main');
// Files older than the quiet window, so only the scenarios below make the workspace look busy.
const old = new Date(Date.now() - 3 * 3600_000);
for (const f of ['a.txt', 'b.txt']) { fs.utimesSync(path.join(ws, f), old, old); }

const fakeGh = path.join(tmp, 'gh.cjs');
fs.writeFileSync(fakeGh, `#!/usr/bin/env node
const a = process.argv.slice(2).join(' ');
const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
if (a.startsWith('repo view')) out({ owner: { login: 'acme' }, name: 'app', defaultBranchRef: { name: 'main' } });
if (a.startsWith('pr view')) {
    if (process.env.FAKE_NO_PR) { process.stderr.write('no pull requests found for branch "feature/x"\\n'); process.exit(1); }
    out({ number: 42, url: 'https://github.com/acme/app/pull/42', title: 'Feature X', state: 'OPEN', isDraft: false,
        mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: 'CHANGES_REQUESTED',
        body: 'Summary\\r\\n- [x] done item\\r\\n- [ ] add coverage for parser\\r\\n* [ ] update README',
        statusCheckRollup: [
            { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { __typename: 'CheckRun', name: 'sonar', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/sonar' },
            { __typename: 'StatusContext', context: 'coverage', state: 'PENDING' },
        ] });
}
if (a.startsWith('api graphql')) out({ data: { repository: { pullRequest: { reviewThreads: { nodes: [
    { isResolved: true, path: 'a.txt', line: 1, comments: { nodes: [{ author: { login: 'peer' }, body: 'fixed', url: 'u1' }] } },
    { isResolved: false, path: 'b.txt', line: 1, comments: { nodes: [{ author: { login: 'peer' }, body: 'Please  rename\\nthis', url: 'u2' }] } },
] } } } } });
if (a.startsWith('pr list')) out([{ number: 7, title: 'Peer change', url: 'https://github.com/acme/app/pull/7', author: { login: 'peer' } }]);
process.stderr.write('unexpected gh ' + a + '\\n'); process.exit(2);
`);
fs.chmodSync(fakeGh, 0o755);

const facts = (extraArgs = [], env = {}) => JSON.parse(childProcess.execFileSync(process.execPath,
    [path.join(__dirname, 'tools', 'pr-daily-facts.cjs'), '--cwd', ws, ...extraArgs],
    { encoding: 'utf8', env: { ...process.env, HOME: home, PR_DAILY_GH: fakeGh, ...env } }));

// ── Quiet feature branch: run, with the PR as the reviewer would see it ──
const thursdayNoon = new Date(2026, 9, 1, 12).getTime();
const quiet = facts(['--now', String(thursdayNoon)]);
assert.equal(quiet.action, 'run', JSON.stringify(quiet.reasons));
assert.deepEqual([quiet.branch, quiet.defaultBranch, quiet.git.behindDefault, quiet.git.fetch, quiet.git.dirtyFiles], ['feature/x', 'main', 1, 'ok', 0]);
assert.equal(quiet.pr.number, 42);
assert.deepEqual([quiet.pr.mergeable, quiet.pr.reviewDecision], ['CONFLICTING', 'CHANGES_REQUESTED']);
assert.deepEqual([quiet.pr.checks.passing, quiet.pr.checks.failing.map((c) => c.name), quiet.pr.checks.pending], [1, ['sonar'], ['coverage']]);
assert.deepEqual(quiet.pr.unresolvedThreads.map((t) => [t.path, t.author, t.excerpt]), [['b.txt', 'peer', 'Please rename this']]);
assert.deepEqual(quiet.pr.openTasks, ['add coverage for parser', 'update README']);
assert.deepEqual(quiet.reviewRequests.map((p) => p.number), [7]);
assert.equal(quiet.mergeWindow, true, 'Thursday is a merge day');
assert.equal(facts(['--no-fetch', '--now', String(new Date(2026, 8, 29, 9).getTime())]).mergeWindow, false, 'Tuesday is not');

// ── The reviewer is mid-task: fresh uncommitted edits pause it ──
fs.writeFileSync(path.join(ws, 'b.txt'), 'two, edited\n');
const editing = facts(['--no-fetch']);
assert.equal(editing.action, 'pause');
assert.match(editing.reasons.join(), /uncommitted edits 0 min ago/);
fs.utimesSync(path.join(ws, 'b.txt'), old, old);
assert.equal(facts(['--no-fetch']).action, 'run', 'old uncommitted work is committed by the routine, not a pause');

// ── A chat message in this workspace 5 minutes ago pauses it; the routine's own prompt does not ──
const turnsDir = path.join(home, '.askaway', 'commentary');
fs.mkdirSync(turnsDir, { recursive: true });
const turnsFile = path.join(turnsDir, `${ws.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}.turns.json`);
const t = Date.now();
fs.writeFileSync(turnsFile, JSON.stringify({ starts: [t - 5 * 60_000, t - 2 * 60_000], prompts: ['Fix the parser bug', '/pr-daily'] }));
const chatting = facts(['--no-fetch']);
assert.equal(chatting.action, 'pause');
assert.match(chatting.reasons.join(), /chat active 5 min ago/);
fs.writeFileSync(turnsFile, JSON.stringify({ starts: [t - 3 * 3600_000, t - 2 * 60_000], prompts: ['Fix the parser bug', '/pr-daily'] }));
assert.equal(facts(['--no-fetch']).action, 'run', 'yesterday\'s chat and the routine prompt itself do not pause it');

// ── A rebase left half-way pauses it ──
fs.mkdirSync(path.join(ws, '.git', 'rebase-merge'));
assert.match(facts(['--no-fetch']).reasons.join(), /git rebase-merge in progress/);
fs.rmSync(path.join(ws, '.git', 'rebase-merge'), { recursive: true });

// ── On main it refuses to push; without a PR it still reports ──
sh(ws, 'checkout', '--quiet', '--', 'b.txt');
sh(ws, 'checkout', '--quiet', 'main');
const onMain = facts(['--no-fetch']);
assert.equal(onMain.action, 'refuse');
assert.match(onMain.reasons.join(), /on main: never pushed directly/);
sh(ws, 'checkout', '--quiet', 'feature/x');
const noPr = facts(['--no-fetch'], { FAKE_NO_PR: '1' });
assert.deepEqual([noPr.pr, noPr.prError, noPr.action], [null, undefined, 'run']);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('EV-PR-DAILY PrDailyFacts: PASS run=quiet pause=edits,chat,rebase refuse=main prFacts=mergeable,checks,threads,tasks reviewRequests=1 mergeWindow=thu');
