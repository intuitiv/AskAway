const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workers-turn-'));
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState']) {
    fs.writeFileSync(path.join(temp, name + '.js'), compile('workers/' + name + '.ts'));
}
const { OpenCodeWorkerRuntime } = require(path.join(temp, 'openCodeRuntime.js'));
const { projectWorkersState } = require(path.join(temp, 'workersState.js'));
const workspace = fs.realpathSync(temp);
const key = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const facts = [];
const fact = (workerId, runId, ts, type, extra = {}) => facts.push({ workerId, runId: runId.replace('run-', 'run-turn-'), ts, type, workspace,
    profile: 'build', model: 'github-copilot/test', thinking: 'high', dispatchTurnId: 'turn', ...extra });
fact('old', 'old-run', 1, 'start');
fact('old', 'old-run', 2, 'stop', { state: 'COMPLETED' });
fact('cancelled', 'run-1', 101, 'start');
fact('cancelled', 'run-1', 102, 'error', { state: 'CANCELLED', exitCode: -1 });
fact('cancelled', 'run-2', 103, 'start');
fact('cancelled', 'run-2', 104, 'error', { state: 'CANCELLED', exitCode: -1 });
fact('failed', 'run-3', 105, 'start');
fact('failed', 'run-3', 106, 'checkpoint', { usage: { input: 100, cacheRead: 800, cacheWrite: 100, output: 10, reasoning: 0, steps: 1, cost: 0.02 } });
fact('failed', 'run-3', 107, 'error', { state: 'FAILED', exitCode: 2 });
// A queued cancellation did not run and must not inflate the count.
fact('queued', 'run-4', 108, 'error', { state: 'CANCELLED', reason: 'cancelled before start' });
fs.writeFileSync(path.join(temp, key + '.jsonl'), facts.map(JSON.stringify).join('\n') + '\n');
const runtime = new OpenCodeWorkerRuntime([], { ledgerDir: temp, now: () => 400000 });
runtime.rehydrate(workspace, false);
const host = { exports: {} };
vm.runInNewContext(compile('workers/workerHost.ts'), { exports: host.exports, process, require: (id) => {
    if (id === './openCodeRuntime') return { OpenCodeWorkerRuntime: class { constructor() { return runtime; } } };
    if (id === './workerProfiles') return { loadWorkerProfiles: () => [] };
    if (id === 'os' || id === 'path' || id === 'fs') return require(id);
    return {};
} });
host.exports.sharedWorkerRuntime();
const spend = host.exports.workerSpendSince(workspace, 100);
assert.deepEqual([spend.workers, spend.runs, spend.requests, spend.inputTokens, spend.outputTokens], [2, 3, 1, 1000, 10]);
assert.equal(host.exports.workerSpendSince(undefined, 100).workerIds.length, 0);
// Execute the provider's real push method so the tab and banner receive the same spend identity.
const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const start = provider.indexOf('    private _refreshWorkersState(): void {');
const end = provider.indexOf('\n    }', start) + 6;
const push = provider.slice(start, end).replace('private _refreshWorkersState(): void', '_refreshWorkersState()');
const bridge = {};
vm.runInNewContext('out.Provider = class { ' + push + ' };', {
    out: bridge, vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: workspace } }] } }
});
const p = new bridge.Provider();
p._workersStateSource = () => projectWorkersState(runtime, workspace, () => 400000);
p._workerSpend = () => spend;
p._benchmarkRows = () => [];
let state;
p._broadcast = (message) => { state = message.data; };
p._refreshWorkersState();
const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const block = (a, b) => webview.slice(webview.indexOf(a), webview.indexOf(b));
const ui = {};
vm.runInNewContext(block('// ── Usage banner', '// ── end Usage banner') +
    block('// ── Turn trace rows: pure render', '// ── end Turn trace rows') +
    block('// ── Workers tab: pure render', '// ── end Workers pure render') +
    'out.chat = chatBannerHtml; out.banner = usageBannerHtml; out.render = renderWorkersHtml;', { out: ui });
const metrics = { lastRequest: { requestCount: 2, inputTokens: 2000, cachedTokens: 1800, outputTokens: 20, nanoAiu: 1e9 }, workers: spend, turnStartedAt: 100, lastRequestTs: 107 };
const banner = ui.chat(metrics, 200);
assert.match(banner, /\(2 workers &middot; 1 req &middot; \$0.02\)/);
assert.equal(banner, ui.banner({ requests: 3, dollars: .03, mainContext: true, lastIn: 2000,
    lastCached: 2600, cacheInput: 3000, turnOut: 30, workers: { workers: 2, requests: 1, dollars: .02 },
    timer: 'Turn 0:00', averagePrompt: 0, cacheMisses: spend.cacheMisses }));
assert.match(banner, />Score 3<\/span> &middot; 3 reqs/);
const cards = ui.render(state, '', {}, false);
assert.equal((cards.match(/class="worker-card"/g) || []).length, spend.workers);
assert.match(cards, /data-worker-id="cancelled"/);
assert.match(cards, /data-worker-id="failed"/);
assert.match(cards, /worker-state-cancelled">CANCELLED|worker-state-orphaned">ORPHANED/);
assert.doesNotMatch(cards, /data-worker-id="old"|data-worker-id="queued"/);
assert.ok(state.workers.filter((w) => spend.workerIds.includes(w.workerId)).every((w) => w.expired));
assert.ok((ui.render(state, '', {}, true).match(/class="worker-card"/g) || []).length > spend.workers);
assert.match(ui.chat({ lastRequest: { inputTokens: 2000, outputTokens: 0 }, workers: { ...spend, outputTokens: 0 } }, 200), />Score 1<\/span> &middot;/);
assert.match(ui.chat({ lastRequest: { inputTokens: 4, outputTokens: 3 }, workers: { inputTokens: 4, outputTokens: 0 } }, 200), />Score –<\/span> &middot;/);
console.log('PASS EV-WORKERS-TURN-CONSISTENCY');
