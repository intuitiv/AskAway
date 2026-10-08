const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./node_modules/typescript');
const cache = {};
function load(name) {
    if (cache[name]) return cache[name].exports;
    const filename = path.join(__dirname, 'src/cloud', name + '.ts');
    const m = cache[name] = new Module(filename, module); m.paths = module.paths;
    m.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return m.exports;
}
const { deriveCloudState } = load('cloudState');
const { pollPr } = load('cloudPoller');
const fixture = require('./test-fixtures/cloud-signals-2026-10-07.json');
const pr = `https://github.com/${fixture.repo}/pull/${fixture.pr}`;
const branch = 'askaway/cloud-proof-throwaway';
function run(index) {
    const taskId = index ? 'PROOF-1b' : 'PROOF-1';
    return { v: 1, slug: '006-cloud-tasks', taskId, attempt: 1, packetPath: `.askaway/specs/006-cloud-tasks/packets/${taskId}-1.md`, packetSha: fixture.base,
        pr, branch, commentId: fixture.comments[index].id, commentUrl: fixture.comments[index].url, model: 'PR default (not independently observed)',
        state: 'Queued', queuedAt: fixture.comments[index].at, history: [], request: { root: '/fixture', slug: '006-cloud-tasks', pr, enabled: true, explicitRequest: true,
            task: { taskId, tags: ['cloud'], stage: 'implement', details: `- [ ] ${taskId}`, allowedPaths: ['proof.md'], verify: [`grep -c "${taskId}" proof.md`], expect: '1', ceilingMinutes: 15 }, story: { story: 'US1', independentTest: 'proof' } } };
}
function signals(index, taskIndex = 0) { const p = structuredClone(fixture.polls[index]); return { ...p, branch, state: 'open', reactions: p.reactions[taskIndex] }; }
(async () => {
    let passed = 0;
    const first = deriveCloudState(run(0), signals(0));
    assert.equal(first.state, 'Checks passed'); assert.equal(first.startedAt, '2026-10-07T11:41:49Z');
    assert.ok(first.history.some(h => h.signal === 'eyes')); assert.equal(first.commits.length, 1); passed++;
    for (const index of [0, 1]) {
        let result = run(index);
        for (let poll = 0; poll < 3; poll++) result = deriveCloudState(result, signals(poll, index));
        assert.equal(result.state, 'Needs review');
        assert.equal(result.report.verifyOutput, '1'); assert.equal(result.report.result, 'done');
        assert.equal(result.model, 'self-reported: ' + (index ? 'GPT-5.6 Terra' : 'Claude Sonnet 5.5'));
        assert.equal(result.commits.length, 1); assert.ok(result.report.url.startsWith(pr));
        assert.deepEqual(result.report.commands, run(index).request.task.verify);
        assert.ok(result.commits[0].url.includes(result.commits[0].sha));
        assert.ok(result.checkRuns.some(c => c.conclusion === 'failure'));
        assert.equal(result.request.task.details, `- [ ] ${result.taskId}`);
        assert.equal(result.acceptance, undefined); passed++;
    }
    const genuine = signals(2).comments.find(c => c.body.includes('\nReport PROOF-1\n'));
    for (const change of [
        { user: { login: 'machs_pega', type: 'User' } },
        { performed_via_github_app: { slug: 'other' } },
        { body: genuine.body.replace('Report PROOF-1\n', 'Report OTHER\n') },
        { body: genuine.body.split('\n').map(l => '> ' + l).join('\n') },
        { body: '```\n' + genuine.body + '\n```' },
        { html_url: 'https://github.com/other/repo/pull/1608#issuecomment-1' },
        { body: genuine.body.replace('3642c63', 'deadbee') },
    ]) {
        const s = signals(2); s.comments = [{ ...genuine, ...change }];
        assert.notEqual(deriveCloudState(run(0), s).state, 'Needs review'); passed++;
    }
    const wrongBranch = signals(2); wrongBranch.branch = 'other';
    assert.equal(deriveCloudState(run(0), wrongBranch).state, 'Returned'); passed++;
    const orphan = signals(2); orphan.commits.forEach(c => c.parents = []);
    assert.notEqual(deriveCloudState(run(0), orphan).state, 'Needs review'); passed++;
    const blocked = signals(2); blocked.comments = [{ ...genuine, body: 'Report PROOF-1\n- Result: blocked\n- Question (if blocked): Which API?\n- Model: not observed' }];
    assert.equal(deriveCloudState(run(0), blocked).decisionNeeded, 'Which API?'); passed++;
    const actions = deriveCloudState(run(0), signals(1));
    assert.ok(actions.checkRuns.some(c => c.name === 'copilot' && c.status === 'in_progress')); passed++;
    const approval = signals(0); approval.comments = []; approval.checkRuns.check_runs[0].conclusion = 'action_required';
    assert.equal(deriveCloudState(run(0), approval).state, 'Checks waiting for approval'); passed++;
    const eyes = signals(0); eyes.commits = []; eyes.timeline = [];
    assert.equal(deriveCloudState(run(0), eyes).state, 'Working'); passed++;
    let stored = [run(0)]; let current = 0; let posted = 0; const calls = [];
    const io = { async load() { return structuredClone(stored); }, async save(root, runs) { stored = structuredClone(runs); },
        gh: { async json(args) {
            calls.push(args); const endpoint = args.at(-1); const s = signals(current);
            if (endpoint.endsWith('/pulls/1608')) return { state: 'open', head: { ref: branch, sha: s.commits.at(-1).sha, repo: { full_name: fixture.repo, clone_url: 'https://github.com/' + fixture.repo + '.git' } } };
            if (endpoint.includes('/timeline')) return [s.timeline]; if (endpoint.includes('/reactions')) return [s.reactions];
            if (endpoint.includes('/check-runs')) return s.checkRuns;
            if (endpoint.includes('/pulls/1608/commits')) return [s.commits];
            if (endpoint.includes('/issues/1608/comments')) return [s.comments];
            return { permissions: { push: true } };
        }, async text(args) { if (args[0] === 'pr') { posted++; return pr + '#issuecomment-99'; } return ''; } },
        async git(args) { return args[0] === 'rev-parse' ? 'abcdef0123456789' : ''; },
        async write() {}, async temporary() { return '/fixture/tmp'; }, async cleanup() {}, knownValues() { return []; } };
    const pollFixture = () => pollPr('/fixture', pr, io, ['Copilot'], Date.parse(fixture.polls[current].at), 1);
    await pollFixture(); assert.equal(stored[0].state, 'Checks passed');
    const held = run(1); held.state = 'Held'; held.packetSha = ''; held.commentId = ''; stored.push(held);
    const unrequested = run(1); unrequested.taskId = 'NEVER'; unrequested.state = 'Held'; unrequested.request.explicitRequest = false; stored.push(unrequested);
    current = 1; await pollFixture();
    assert.equal(stored[0].state, 'Needs review'); assert.equal(stored[1].state, 'Queued'); assert.equal(posted, 1);
    // Replay the second actual session with its actual request identity and ancestry.
    stored[1] = run(1); current = 2; await pollFixture();
    assert.equal(stored[1].state, 'Needs review'); assert.equal(stored[2].state, 'Held'); assert.equal(posted, 1);
    const history = stored[0].history.length; await pollFixture();
    assert.equal(stored[0].history.length, history); assert.equal(posted, 1);
    assert.ok(calls.every(args => args.at(-1) === 'repos/' + fixture.repo || args.at(-1).startsWith('repos/' + fixture.repo + '/'))); passed++;
    stored = []; const before = calls.length; await pollFixture(); assert.equal(calls.length, before); passed++;
    console.log(`test-cloud-task-report: ${passed} passed, 0 failed (PR #1608 fixture replay)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
