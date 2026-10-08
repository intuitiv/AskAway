const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./node_modules/typescript');
const vm = require('node:vm');
const cache = {};
function load(name) {
    if (cache[name]) return cache[name].exports;
    const filename = path.join(__dirname, 'src/cloud', name + '.ts');
    const m = cache[name] = new Module(filename, module); m.paths = module.paths;
    m.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return m.exports;
}
const { CloudSpecsController, shouldPollCloud } = load('cloudSpecs');
const { queueTask } = load('cloudQueue');
const fixture = require('./test-fixtures/cloud-signals-2026-10-07.json');
const pr = `https://github.com/${fixture.repo}/pull/${fixture.pr}`;
const branch = 'askaway/cloud-proof-throwaway';
const root = path.join(__dirname, 'build/cloud-state-' + process.pid);
fs.mkdirSync(root, { recursive: true });
let now, stored, snapshot, fail, calls = 0, posts = 0;
const minute = 60000;
function fresh(ceilingMinutes = 50) {
    now = Date.parse(fixture.comments[0].at);
    return { v: 1, slug: '006-cloud-tasks', taskId: 'PROOF-1', attempt: 1,
        packetPath: 'packet.md', packetSha: fixture.base, pr, branch,
        commentId: fixture.comments[0].id, commentUrl: fixture.comments[0].url,
        model: 'PR default (not independently observed)', state: 'Queued', queuedAt: new Date(now).toISOString(), history: [],
        request: { root, slug: '006-cloud-tasks', pr, enabled: true, explicitRequest: true,
            task: { taskId: 'PROOF-1', tags: ['cloud'], stage: 'implement', details: '- [ ] PROOF-1', allowedPaths: ['proof.md'], verify: ['node proof.js'], expect: 'PASS', ceilingMinutes },
            story: { story: 'US1', independentTest: 'proof' } } };
}
const empty = () => ({ timeline: [], commits: [], comments: [], reactions: [], checkRuns: { check_runs: [] } });
const io = {
    async load() { return structuredClone(stored); },
    async save(_, runs) { stored = structuredClone(runs); fs.writeFileSync(path.join(root, 'runs.json'), JSON.stringify(stored)); },
    gh: { async json(args) {
        calls++; if (fail) throw new Error('fixture poll unavailable');
        const endpoint = args.at(-1);
        if (endpoint.endsWith('/pulls/' + fixture.pr)) return { state: 'open', head: { ref: branch, sha: snapshot.commits.at(-1)?.sha ?? fixture.base, repo: { full_name: fixture.repo, clone_url: 'fixture' } } };
        if (endpoint.includes('/timeline')) return [snapshot.timeline];
        if (endpoint.includes('/reactions')) return [snapshot.reactions];
        if (endpoint.includes('/check-runs')) return snapshot.checkRuns;
        if (endpoint.includes('/commits')) return [snapshot.commits];
        if (endpoint.includes('/comments')) return [snapshot.comments];
        return { permissions: { push: true } };
    }, async text(args) { if (args[0] === 'pr') { posts++; return pr + '#issuecomment-99'; } return ''; } },
    async git(args) { return args[0] === 'rev-parse' ? 'abcdef0123456789' : ''; },
    async write() {}, async temporary() { return root; }, async cleanup() {}, knownValues() { return []; }
};
const controller = new CloudSpecsController(io, () => now);
const poll = () => controller.poll(root, true, ['Copilot'], 3);
const view = async () => (await controller.refresh(root, { specs: [{ slug: '006-cloud-tasks', tasks: [{ id: 'PROOF-1' }], cycles: [] }] })).specs[0].tasks[0].cloud;
(async () => {
    stored = [fresh()]; snapshot = empty(); fail = false;
    now += 9 * minute; await poll(); assert.equal(stored[0].state, 'Queued');
    now += 3 * minute; await poll(); assert.equal(stored[0].state, 'No response');
    assert.match((await view()).events[0].outputPreview, /No acknowledgment after 10 minutes/);
    assert.equal(stored[0].endedAt, new Date(now).toISOString());
    assert.ok(stored[0].history.some(h => h.state === 'No response' && h.at === stored[0].endedAt));
    assert.equal(shouldPollCloud(true, stored), false);
    const before = calls; await poll(); assert.equal(calls, before); assert.equal(posts, 0);
    console.log('PASS no-ack exit with timestamped history and no automatic retry');

    for (const [configured, limit] of [[5, 5], [100, 59]]) {
        stored = [fresh(configured)]; snapshot = empty();
        snapshot.reactions = [{ user: { login: 'Copilot', type: 'Bot' }, content: 'eyes', created_at: new Date(now).toISOString() }];
        await poll(); assert.equal(stored[0].state, 'Working');
        now += limit * minute; await poll(); assert.equal(stored[0].state, 'Timed out');
        assert.ok(stored[0].history.some(h => h.state === 'Timed out' && h.at === new Date(now).toISOString()));
        assert.match((await view()).events[0].outputPreview, /duration ceiling/);
    }
    console.log('PASS configured timeout and 59-minute ceiling');

    stored = [fresh()]; snapshot = empty(); fail = true;
    const original = structuredClone(stored[0]);
    for (const delay of [6, 12, 15, 15]) {
        await poll();
        assert.equal(stored[0].state, original.state); assert.deepEqual(stored[0].history, original.history);
        assert.equal(stored[0].staleSince, original.queuedAt);
        assert.equal(await controller.pollDelay(root, 3), delay * minute);
        const count = calls; await poll(); assert.equal(calls, count);
        now += delay * minute;
    }
    assert.match((await view()).events[0].outputPreview, /Polling stale since/);
    fail = false; snapshot = empty();
    snapshot.reactions = [{ user: { login: 'Copilot', type: 'Bot' }, content: 'eyes', created_at: new Date(now).toISOString() }];
    await poll(); assert.equal(stored[0].state, 'Working'); assert.equal(stored[0].staleSince, undefined);
    assert.equal(stored[0].pollFailures, 0); assert.equal(await controller.pollDelay(root, 3), 3 * minute);
    assert.doesNotMatch((await view()).events[0].outputPreview, /Polling stale/);
    console.log('PASS stale state retained, exponential backoff capped at 15 minutes, recovery');

    stored = [fresh()];
    for (const recorded of fixture.polls.slice(0, 2)) {
        snapshot = { ...structuredClone(recorded), reactions: recorded.reactions[0] };
        now = Date.parse(recorded.at); stored[0].nextPollAt = undefined;
        await poll();
    }
    assert.equal(stored[0].state, 'Needs review'); assert.equal(stored[0].report.verifyOutput, '1');
    assert.ok(stored[0].history.every(h => Number.isFinite(Date.parse(h.at))));
    assert.ok(stored[0].commits.length); assert.equal(stored[0].acceptance, undefined); assert.equal(posts, 0);
    console.log('PASS recorded PR fixture replay without tick, guessed acceptance, or unrequested posts');

    const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
    const ctx = { specsShowDone: true, specsWorkExpanded: {}, Date,
        escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
        formatObservabilityCompact: value => String(value || 0), workerRefBadge: () => '', workerRefsFromPreview: () => [] };
    vm.createContext(ctx);
    vm.runInContext(webview.slice(webview.indexOf('var TRACE_HEAD'), webview.indexOf('function traceOpenIds')), ctx);
    vm.runInContext(webview.slice(webview.indexOf('function formatSpecInline(text)'), webview.indexOf('var SPEC_STAGE_COMMAND')), ctx);
    vm.runInContext(webview.slice(webview.indexOf('function workersEsc(value)'), webview.indexOf('// ── end Workers pure render')), ctx);
    const replayed = structuredClone(stored[0]);
    const later = structuredClone(replayed); later.taskId = 'PROOF-1b'; later.attempt = 2;
    later.queuedAt = new Date(Date.parse(replayed.queuedAt) + minute).toISOString();
    stored = [later, replayed];
    const workers = await controller.workers(root);
    assert.equal(workers[0].profile, 'PROOF-1'); assert.equal(workers[1].profile, 'PROOF-1b');
    for (const worker of workers) {
        const run = stored.find(r => r.taskId === worker.profile);
        const scan = await controller.refresh(root, { specs: [{ slug: run.slug, tasks: [{ id: run.taskId, text: 'Cloud task', done: false, tags: ['cloud'] }], cycles: [] }] });
        ctx.spec = scan.specs[0];
        const specHtml = vm.runInContext('renderSpecWork(spec)', ctx);
        const shared = ctx.traceRowsHtml(scan.specs[0].tasks[0].cloud.events);
        const workerHtml = ctx.renderWorkersHtml({ workers: [worker], generatedAt: now }, '', { [worker.workerId]: true }, false, {}, {});
        assert.ok(specHtml.includes(shared)); assert.ok(workerHtml.includes(shared));
        for (const html of [specHtml, workerHtml]) {
            assert.ok(html.includes(run.state)); assert.ok(html.includes(run.model)); assert.ok(html.includes(run.report.url));
            assert.ok(html.includes(run.commits[0].url)); assert.ok(html.includes('obs-tl-item')); assert.ok(html.includes('<summary'));
            assert.doesNotMatch(html, /\$|health-cost|Credits|price/);
        }
        assert.ok(workerHtml.includes('Trace') || workerHtml.includes('Hide'));
        assert.ok(!ctx.renderWorkersHtml({ workers: [worker], generatedAt: now }, '', {}, false, {}, {}).includes(shared));
        const eid = scan.specs[0].tasks[0].cloud.events[0].id;
        const opened = ctx.traceRowsHtml(scan.specs[0].tasks[0].cloud.events, { openIds: { [eid]: true } });
        assert.ok(ctx.renderWorkersHtml({ workers: [worker], generatedAt: now }, '', { [worker.workerId]: true }, false, { [eid]: true }, {}).includes(opened));
        assert.equal(worker.runs[0].elapsedMs, scan.specs[0].tasks[0].cloud.events[0].durMs);
    }
    const both = ctx.renderWorkersHtml({ workers, generatedAt: now }, '', {}, false, {}, {});
    assert.ok(both.indexOf('data-worker-id="' + workers[0].workerId) < both.indexOf('data-worker-id="' + workers[1].workerId));
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.ok(provider.includes('await this._cloudSpecs.workers(root)'));
    console.log('PASS Specs and Workers reuse shared traceRowsHtml: ordering, links, expand/collapse, duration, self-reported model, no price');

    stored = [fresh()]; stored[0].state = 'No response'; snapshot = empty();
    const request = structuredClone(stored[0].request);
    const refused = await queueTask({ ...request, explicitRequest: false }, io);
    assert.match(refused.refusal, /explicit reviewer request/); assert.equal(posts, 0);
    const retry = await controller.click(request);
    assert.equal(retry.refusal, undefined); assert.equal(retry.run.attempt, 2); assert.equal(posts, 1);
    assert.equal(stored[0].state, 'No response'); assert.equal(stored[1].state, 'Queued');
    console.log('PASS explicit retry creates attempt n+1 only');
})().catch(error => { console.error(error); process.exitCode = 1; });
