const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./node_modules/typescript');
const cache = {};
function load(name) {
    if (cache[name]) return cache[name].exports;
    const filename = path.join(__dirname, 'src/cloud', name + '.ts');
    const loaded = cache[name] = new Module(filename, module);
    loaded.paths = module.paths;
    loaded.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return loaded.exports;
}
const { queueTask, releaseHeld } = load('cloudQueue');
const { deriveCloudState } = load('cloudState');
const { createGh } = load('gh');
const pr = 'https://github.com/fixture/project/pull/20';
const root = '/fixture/cloud-story';
const request = id => ({ root, pr, slug: '006-cloud-tasks', explicitRequest: true, enabled: true,
    task: { taskId: id, stage: 'implement', details: `Implement ${id}`, tags: ['cloud'],
        allowedPaths: ['src/shared.ts'], verify: [`node verify-${id}.cjs --offline`], expect: 'PASS', ceilingMinutes: 50 },
    story: { story: 'US6', independentTest: 'Verify each task then the unchanged 005 checkpoint' } });
function fixture() {
    let runs = [], head = '1234567890abcdef', posted = 0;
    const calls = [], files = new Map(), packets = [], comments = [];
    const io = {
        gh: createGh(async args => {
            calls.push(['gh', ...args]);
            if (args[0] === 'auth') return { code: 0, stderr: '', stdout: '' };
            if (args[0] === 'api') return { code: 0, stderr: '', stdout: JSON.stringify(args[1].includes('/pulls/')
                ? { state: 'open', head: { ref: 'story-pr', sha: head,
                    repo: { full_name: 'fixture/project', clone_url: 'https://github.com/fixture/project.git' } } }
                : { permissions: { push: true } }) };
            assert.equal(args[0], 'pr', 'fixture permits only the existing PR comment write');
            assert.equal(args[1], 'comment', 'no new PR or merge is permitted');
            comments.push(files.get(args.at(-1)));
            return { code: 0, stderr: '', stdout: `${pr}#issuecomment-${++posted}` };
        }),
        async git(args) { calls.push(['git', ...args]); return args[0] === 'rev-parse' ? 'abcdef0123456789' : ''; },
        async load() { return structuredClone(runs); }, async save(_, value) { runs = structuredClone(value); },
        async write(file, text) { files.set(file, text); if (file.includes('/packets/')) packets.push(text); },
        async temporary() { return '/fixture/cloud-story/tmp'; }, async cleanup() {}, knownValues() { return []; },
    };
    return { io, calls, packets, comments, get runs() { return runs; },
        update(index, run) { runs[index] = structuredClone(run); }, head(value) { head = value; } };
}
const signals = (run, at) => ({ at, branch: run.branch, state: 'open', reactions: [], timeline: [],
    commits: [], comments: [], checkRuns: { check_runs: [] } });
let matched = 0, passed = 0;
async function test(name, action) {
    matched++;
    await action();
    passed++;
    console.log(`PASS T020 ${name}`);
}
const pending = [
    'implement-only whole-story request and all-task cloud/no-local preflight before any dispatch',
    'automatic tasks.md row-order expansion skips Accepted tasks and starts no unrelated work',
    'failure stops remaining story tasks as Not queued, including generic Held-release protection',
    'explicit retry re-queues failed task only, retains successes, and does not resume suffix',
    'aggregate story status derives from latest task attempts with failure task/reason',
    'all tasks Accepted invokes unchanged 005 checkpoint; local evidence gates story acceptance',
];
(async () => {
    await test('existing per-task explicit request gate refuses without GitHub writes', async () => {
        const f = fixture();
        assert.match((await queueTask({ ...request('T030'), explicitRequest: false }, f.io)).refusal, /explicit reviewer/);
        assert.equal(f.calls.length, 0, 'unrequested task must not touch GitHub/git');
        assert.equal(await releaseHeld(root, pr, f.io), undefined, 'startup has no requested work to release');
    });
    await test('existing per-task eligibility refuses local and untagged tasks', async () => {
        for (const tags of [[], ['cloud', 'local: local service']]) {
            const f = fixture(), req = request('T030'); req.task.tags = tags;
            assert.match((await queueTask(req, f.io)).refusal, /not cloud-eligible/);
            assert.equal(f.packets.length, 0, 'ineligible task must not write a packet');
            assert.equal(f.comments.length, 0, 'ineligible task must not post');
        }
    });
    await test('caller-ordered per-task expansion is serial; overlap releases at Needs review', async () => {
        const f = fixture();
        for (const id of ['T030', 'T010', 'T020']) {
            const result = await queueTask(request(id), f.io);
            assert.equal(result.run?.state, id === 'T030' ? 'Queued' : 'Held', 'only first caller-ordered task posts');
        }
        assert.equal(f.packets.length, 1, 'Held tasks write no packets');
        for (const state of ['Queued', 'Working', 'Pushed', 'Checks passed', 'Checks failed', 'Checks waiting for approval']) {
            f.update(0, { ...f.runs[0], state });
            assert.equal(await releaseHeld(root, pr, f.io), undefined, `${state} must block overlapping release`);
        }
        f.update(0, { ...f.runs[0], state: 'Needs review' });
        f.head('fedcba9876543210');
        assert.equal((await releaseHeld(root, pr, f.io))?.taskId, 'T010', 'review releases first Held, not sorted task ID');
        assert.equal(f.comments.length, 2, 'release posts once');
        assert.equal(await releaseHeld(root, pr, f.io), undefined, 'new active task blocks next release');
        f.update(1, { ...f.runs[1], state: 'Needs review' });
        assert.equal((await releaseHeld(root, pr, f.io))?.taskId, 'T020', 'remaining caller order preserved');
        assert.equal(f.packets.length, 3, 'one packet per task');
        for (let i = 0; i < f.runs.length; i++) {
            const run = f.runs[i];
            assert.ok(f.packets[i].includes(JSON.stringify(run.request.task.verify[0])), 'exact task verification retained');
            assert.ok(f.comments[i].includes(run.packetPath), 'comment references that task packet');
            assert.ok(f.comments[i].includes('(US6, stage implement)'), 'story and stage retained');
        }
        assert.ok(f.packets[1].includes('base: "fedcba9876543210"'), 'released packet uses current PR head');
        assert.ok(f.calls.filter(call => call[0] === 'git' && call[1] === 'push').every(call => call.includes('HEAD:refs/heads/story-pr')),
            'all task pushes target the active PR branch');
        assert.ok(!f.calls.some(call => call.includes('merge')), 'no merge side effect');
    });
    await test('authenticated blocked task report is Needs review, never acceptance', async () => {
        const f = fixture(), run = (await queueTask(request('T030'), f.io)).run;
        const at = new Date(Date.parse(run.queuedAt) + 60000).toISOString();
        const snapshot = signals(run, at);
        snapshot.comments = [{ created_at: at, html_url: `${pr}#issuecomment-99`, user: { login: 'Copilot', type: 'Bot' },
            performed_via_github_app: { slug: 'copilot-swe-agent' },
            body: 'Report T030\n- Result: blocked\n- Commits: \n- Verify output: not run\n- Question: Clarify scope' }];
        const next = deriveCloudState(run, snapshot);
        assert.equal(next.state, 'Needs review', 'blocked report must reach local review');
        assert.equal(next.report?.result, 'blocked', 'failure information retained for future story coordinator');
        assert.equal(next.decisionNeeded, 'Clarify scope', 'caller sees blocker');
        assert.equal(next.acceptance, undefined, 'agent report must not accept story/task');
    });
    await test('local timeout and explicit failed-task n+1 retry do not replay successful task', async () => {
        const f = fixture(), first = (await queueTask(request('T030'), f.io)).run;
        f.update(0, { ...first, state: 'Accepted' });
        const failed = (await queueTask(request('T010'), f.io)).run;
        const next = deriveCloudState({ ...failed, state: 'Working', startedAt: failed.queuedAt },
            signals(failed, new Date(Date.parse(failed.queuedAt) + 50 * 60000).toISOString()));
        assert.equal(next.state, 'Timed out', 'configured cap must report Timed out locally');
        f.update(1, next);
        assert.equal(f.comments.length, 2, 'state derivation must not cancel/repost remotely');
        const retry = await queueTask(request('T010'), f.io);
        assert.equal(retry.run?.attempt, 2, 'explicit retry creates new failed-task attempt');
        assert.equal(f.runs.filter(run => run.taskId === 'T030').length, 1, 'successful task is not replayed');
        assert.equal(f.runs.some(run => run.taskId === 'T020'), false, 'unrequested suffix stays without a run');
    });
    for (const name of pending) console.log(`PENDING T020 ${name}`);
    console.log(`test-cloud-story: ${passed} passed, 0 failed, ${matched} matched, ${pending.length} pending`);
})().catch(error => {
    console.error(error.message);
    console.error((error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 3).join('\n'));
    console.log(`test-cloud-story: ${passed} passed, 1 failed, ${matched} matched`);
    process.exitCode = 1;
});
