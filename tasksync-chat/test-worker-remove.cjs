// EV-WORKER-REMOVE: the Remove button on each Workers card takes that worker out of rotation (reviewer, 2026-10-16:
// "give me a delete option on each task so that i can remove that from rotation"). Caller view: the rendered card shows
// the button and its one-line inline confirm; the provider's removeWorker message cancels a running worker and removes it;
// the removed worker leaves `worker list`, is never reused by start, is refused by submit with REMOVED, stays removed after
// a reload (rehydrate), and its past cost stays in the turn/month totals.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-remove-build-'));
for (const name of ['agyRuntime', 'workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workerTools.js'));
const { projectWorkersState } = require(path.join(buildDir, 'workersState.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-remove-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'ws-')));
const ledgerDir = path.join(tmp, 'ledger');
const profile = parseWorkerProfile('---\nname: build\ndescription: "b"\ntier: mid\nmodel: github-copilot/gpt-5.6-luna\nthinking: medium\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [medium]\nedit: allow\nbash: allow\n---\nBody.\n');

// Fake OpenCode: a packet whose objective says HOLD runs until killed; any other finishes at once with one billed request.
const killed = [];
const spawner = (args) => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let onExit;
    const hold = String(args.at(-1)).includes('HOLD');
    const child = { pid: process.pid, stdout, stderr, on(event, cb) { if (event === 'exit') { onExit = cb; } },
        kill() { killed.push(String(args.at(-1)).slice(0, 40)); setImmediate(() => onExit?.(null, 'SIGTERM')); return true; } };
    if (!hold) {
        setImmediate(() => {
            stdout.write(JSON.stringify({ sessionID: 'ses-' + Math.random().toString(36).slice(2, 8), type: 'step_finish', part: { id: 's1', cost: 0.25, tokens: { input: 1000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } } }) + '\n');
            stdout.write(JSON.stringify({ type: 'text', part: { text: 'Result: PASS\nEvidence: ok\nNot done: none' } }) + '\n');
            onExit?.(0, null);
        });
    } else { setImmediate(() => stdout.write(JSON.stringify({ sessionID: 'ses-hold', type: 'text', part: { text: 'working' } }) + '\n')); }
    return child;
};
const newRuntime = () => new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner });
const toolOf = (rt) => {
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => rt, workspace);
    return async (action, args) => JSON.parse((await tools.get('worker').handler(tools.get('worker').config.inputSchema.parse({ action, ...args }))).content[0].text);
};
const packet = (objective) => ({ profile: 'build', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective, allowedFiles: ['f.txt'], acceptance: 'a', expected: 'e', command: 'true' });

// The Workers card, rendered from the real webview.js blocks.
const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const block = (from, to) => webview.slice(webview.indexOf(from), webview.indexOf(to));
const ctx = vm.createContext({ Date, document: { getElementById: () => null }, traceOpenIds: () => ({}), escapeHtml: (v) => String(v ?? '') });
vm.runInContext([block('// ── Usage banner', '// ── end Usage banner ──'), block('// ── Turn trace rows: pure render', '// ── end Turn trace rows ──'),
    block('// ── Workers tab: pure render', '// ── end Workers pure render ──')].join('\n'), ctx);
const cardsOf = (rt) => vm.runInContext('renderWorkersHtml', ctx)(projectWorkersState(rt, workspace), '', {}, false, {}, {});

// The provider's removeWorker handler, extracted from the real source.
const providerText = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const start = providerText.indexOf('    private _removeWorker(workerId: string): void {');
const method = providerText.slice(start, providerText.indexOf('\n    }', start) + 6).replace('private _removeWorker(workerId: string): void', '_removeWorker(workerId)');
const warnings = [];
let refreshes = 0;
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: workspace } }] }, window: { showWarningMessage: (m) => warnings.push(m) } };
const out = {};
vm.runInNewContext('out.Provider = class {' + method + '};', { out, vscode });
const provider = new out.Provider();
provider._refreshWorkersState = () => { refreshes++; };
assert.match(providerText, /case 'removeWorker':\s*this\._removeWorker\(message\.workerId\);/, 'the webview message reaches the handler');
assert.match(webview, /vscode\.postMessage\(\{ type: 'removeWorker', workerId: removeId \}\)/, 'the confirmed button posts removeWorker');

(async () => {
    const runtime = newRuntime();
    provider._workerRemoveSource = (ws, id) => runtime.remove(ws, id);
    const call = toolOf(runtime);
    const running = await call('start', packet('HOLD until removed'));
    const done = await call('start', packet('Finish quickly'));
    assert.notEqual(running.workerId, done.workerId, 'a running worker is not reused by start');
    assert.equal((await call('wait', { runId: done.runId, timeoutSeconds: 10 })).status, 'COMPLETED');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const spendBefore = runtime.usageSince(workspace, 0);
    assert.equal(spendBefore.dollars, 0.25);

    // The card: a Remove button in the action row; one click shows the inline confirm, not a modal.
    const html = cardsOf(runtime);
    for (const id of [done.workerId, running.workerId]) {
        const card = html.slice(html.indexOf(`data-worker-id="${id}"`));
        assert.match(card, /<div class="worker-actions">[\s\S]*?data-worker-action="remove" data-worker-id="[^"]+"[^>]*>Remove<\/button>/, `${id} card has Remove`);
    }
    assert.doesNotMatch(html, /remove-confirm/);
    vm.runInContext(`workersRemoveConfirm[${JSON.stringify(done.workerId)}] = true`, ctx);
    const confirming = cardsOf(runtime);
    assert.match(confirming, /Remove this worker from rotation\?[\s\S]*data-worker-action="remove-confirm"[\s\S]*data-worker-action="remove-cancel"/);
    assert.equal((confirming.match(/data-worker-action="remove-confirm"/g) || []).length, 1, 'only the clicked card asks');
    vm.runInContext('workersRemoveConfirm = {}', ctx);

    // Confirmed: the provider message cancels the running worker and removes both.
    provider._removeWorker(running.workerId);
    provider._removeWorker(done.workerId);
    assert.equal(refreshes, 2, 'the Workers tab refreshes after each removal');
    assert.deepEqual(warnings, []);
    assert.ok(killed.some((objective) => objective.includes('HOLD')), 'a running worker is cancelled when removed');

    // Gone from cards and `worker list`; excluded from start auto-reuse; submit refuses with REMOVED.
    assert.doesNotMatch(cardsOf(runtime), new RegExp(`${done.workerId}|${running.workerId}`));
    assert.deepEqual((await call('list', {})).map((w) => w.workerId), []);
    const fresh = await call('start', packet('Finish quickly'));
    assert.notEqual(fresh.workerId, done.workerId, 'an idle removed worker is not reused');
    await call('wait', { runId: fresh.runId, timeoutSeconds: 10 });
    const refused = await call('submit', { ...packet('more'), workerId: done.workerId });
    assert.equal(refused.status, 'REMOVED', JSON.stringify(refused));
    assert.match(refused.reason, /removed from rotation/);
    assert.equal(runtime.remove(workspace, 'worker-nope').status, 'UNKNOWN_WORKER');

    // Past cost stays in the totals.
    const spendAfter = runtime.usageSince(workspace, 0);
    assert.equal(spendAfter.dollars, spendBefore.dollars + 0.25, 'removed workers keep their past cost; only the new run adds');
    assert.ok(spendAfter.workerIds.includes(done.workerId));

    // Still removed after a reload.
    const reloaded = newRuntime();
    reloaded.rehydrate(workspace, true);
    const reloadedCall = toolOf(reloaded);
    const ids = (await reloadedCall('list', {})).map((w) => w.workerId);
    assert.ok(!ids.includes(done.workerId) && !ids.includes(running.workerId), 'removed workers stay removed after rehydrate: ' + ids);
    assert.ok(ids.includes(fresh.workerId));
    assert.equal((await reloadedCall('submit', { ...packet('again'), workerId: done.workerId })).status, 'REMOVED');
    assert.equal(reloaded.usageSince(workspace, 0).dollars, spendAfter.dollars);
    const reused = await reloadedCall('start', packet('Finish quickly'));
    assert.notEqual(reused.workerId, done.workerId);

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log('PASS EV-WORKER-REMOVE card button+inline confirm; provider message cancels running and removes; list/start/submit exclusion (REMOVED); persists after rehydrate; cost totals unchanged');
    process.exit(0);
})().catch((error) => { console.error(error); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(buildDir, { recursive: true, force: true }); process.exit(1); });
