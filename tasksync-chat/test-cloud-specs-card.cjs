const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/cloud/cloudSpecs.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const m = { exports: {} }; vm.runInNewContext(output, { module: m, exports: m.exports, require, structuredClone, console, setTimeout });
const { attachCloudRuns, shouldPollCloud, CloudSpecsController } = m.exports;
const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const ctx = { specsShowDone: true, specsWorkExpanded: {}, writes: [], Date,
    escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    formatObservabilityCompact: value => String(value || 0), workerRefBadge: () => '', workerRefsFromPreview: () => [],
    vscode: { postMessage(message) { ctx.writes.push(message); } } };
vm.createContext(ctx);
const traceStart = webview.indexOf('var TRACE_HEAD');
const traceEnd = webview.indexOf('function traceOpenIds', traceStart);
assert.ok(traceEnd > traceStart); vm.runInContext(webview.slice(traceStart, traceEnd), ctx);
vm.runInContext(webview.slice(webview.indexOf('function formatSpecInline(text)'), webview.indexOf('var SPEC_STAGE_COMMAND')), ctx);
vm.runInContext(webview.slice(webview.indexOf('function onSpecsListClick(e)'), webview.indexOf('function prefillChat(text)')), ctx);
const task = { id: 'T010', text: 'Cloud task', tags: ['cloud'], done: false, phase: 'US2' };
const spec = { slug: '006-cloud-tasks', tasks: [task], cycles: [] };
const run = { slug: spec.slug, taskId: task.id, state: 'Queued', model: 'self-reported: fixture model', queuedAt: '2026-10-07T11:40:00Z',
    startedAt: '2026-10-07T11:41:00Z', endedAt: '2026-10-07T11:42:00Z', request: { task: { verify: ['node test.cjs'] } },
    report: { commands: ['node test.cjs'], verifyOutput: 'PASS', url: 'https://github.com/o/r/pull/1#issuecomment-2' }, decisionNeeded: 'Which API?' };
for (const state of ['Held', 'Queued', 'Working', 'Pushed', 'Checks passed', 'Checks failed', 'Checks waiting for approval', 'Needs review']) {
    run.state = state; const data = attachCloudRuns({ specs: [spec] }, [run]); ctx.spec = data.specs[0];
    const html = vm.runInContext('renderSpecWork(spec)', ctx);
    const shared = ctx.traceRowsHtml(data.specs[0].tasks[0].cloud.events);
    assert.ok(html.includes(shared)); assert.ok(html.includes(state)); assert.ok(html.includes('self-reported: fixture model'));
    assert.ok(html.includes('Which API?')); assert.ok(html.includes('60.00s')); assert.ok(html.includes('issuecomment-2'));
    assert.ok(!/Credits|price|merge|codicon-check"/.test(html)); assert.equal(data.specs[0].tasks[0].done, false);
    ctx.spec = { ...data.specs[0], cycles: [{ id: 'CY-001', state: 'ready', total: 1, done: 0, tasks: [{ ...data.specs[0].tasks[0], specSlug: spec.slug }] }] };
    assert.ok(vm.runInContext('renderSpecWork(spec)', ctx).includes(shared));
}
assert.equal(ctx.writes.length, 0);
const attrs = { 'data-act': 'queue-cloud', 'data-spec-slug': spec.slug, 'data-ref': task.id };
ctx.event = { target: { closest(selector) { return { getAttribute(name) { return attrs[name]; } }; } }, preventDefault() {}, stopPropagation() {} };
vm.runInContext('onSpecsListClick(event)', ctx); assert.equal(ctx.writes.length, 1); assert.equal(ctx.writes[0].type, 'queueCloudTask');
assert.equal(shouldPollCloud(false, [run]), false); assert.equal(shouldPollCloud(true, [run]), false);
assert.equal(shouldPollCloud(true, [{ ...run, state: 'Queued' }]), true);
(async () => {
    let loads = 0; const controller = new CloudSpecsController({ async load() { loads++; return []; }, gh: { async json() { throw new Error('no GitHub calls without active run'); } } });
    await controller.refresh('/fixture', { specs: [spec] }); await controller.poll('/fixture', false, ['Copilot']); await controller.poll('/fixture', true, ['Copilot']);
    assert.equal(loads, 3); assert.equal(ctx.writes.length, 1);
    let stored = [], posted = 0;
    const io = { async load() { return structuredClone(stored); }, async save(root, runs) { stored = structuredClone(runs); },
        gh: { async text(args) { if (args[0] === 'pr') { posted++; return 'https://github.com/o/r/pull/1#issuecomment-2'; } return ''; },
            async json(args) { return args[1].includes('/pulls/') ? { state: 'open', head: { ref: 'active', sha: '123456789abcdef', repo: { full_name: 'o/r', clone_url: 'https://github.com/o/r.git' } } } : { permissions: { push: true } }; } },
        async git(args) { return args[0] === 'rev-parse' ? 'abcdef0123456789' : ''; }, async write() {}, async temporary() { return '/fixture/tmp'; }, async cleanup() {}, knownValues() { return []; } };
    const clicked = new CloudSpecsController(io);
    const request = { root: '/fixture', slug: spec.slug, pr: 'https://github.com/o/r/pull/1', enabled: true,
        task: { taskId: task.id, stage: 'implement', details: '- [ ] T010', tags: ['cloud'], allowedPaths: ['a.ts'], verify: ['node test.cjs'], expect: 'PASS', ceilingMinutes: 45 }, story: { story: 'US2', independentTest: 'queue' } };
    await clicked.refresh('/fixture', { specs: [spec] }); assert.equal(posted, 0);
    assert.equal((await clicked.click(request)).run.state, 'Queued'); assert.equal(posted, 1);
    assert.ok((await clicked.click(request)).refusal); assert.equal(posted, 1);
    assert.equal((await clicked.click({ ...request, task: { ...request.task, taskId: 'T011' } })).run.state, 'Held'); assert.equal(posted, 1);
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.ok(provider.includes("case 'queueCloudTask':")); assert.ok(provider.includes('this._cloudSpecs.click('));
    const cloudBlock = provider.slice(provider.indexOf('    private _cloudSpecs'), provider.indexOf('    private _specsWatcher'));
    assert.ok(!/(?<!\r)\n/.test(cloudBlock), 'new provider code preserves CRLF');
    // Full queue fixtures prove one write, duplicate refusal, second request Held and release.
    require('./test-cloud-queue.cjs');
    console.log('test-cloud-specs-card: PASS shared task/trace reuse, click boundary, statuses/report, gated polling, no tick/price/merge');
})().catch(error => { console.error(error); process.exitCode = 1; });
