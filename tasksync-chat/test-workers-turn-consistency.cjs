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
// Mirror src/ so ../team/roster resolves.
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/agyRuntime', 'workers/workersState', 'team/roster']) {
    fs.mkdirSync(path.join(temp, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(temp, name + '.js'), compile(name + '.ts'));
}
const { OpenCodeWorkerRuntime } = require(path.join(temp, 'workers', 'openCodeRuntime.js'));
const { projectWorkersState } = require(path.join(temp, 'workers', 'workersState.js'));
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
const push = provider.slice(start, end);
const bridge = {};
// The method is TypeScript (typed helpers inside it): transpile the sliced class, never run TS as plain JS.
const providerClass = ts.transpileModule('out.Provider = class { ' + push + ' };', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(providerClass, {
    out: bridge, memberSelections: () => ({}), vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: workspace } }] } }
});
const p = new bridge.Provider();
p._workersStateSource = () => projectWorkersState(runtime, workspace, () => 400000, 100);
p._workerSpend = () => spend;
p._benchmarkRows = () => [];
p._mainAgentMember = () => ({ id: 'bhaskar', name: 'Bhaskar', role: 'Tech Lead', kind: 'main', active: false, profile: 'AskAway Build', pinned: false, initials: 'BH', avatarSrc: '',
    creativeStatus: '', agentFile: 'askaway-build.agent.md', model: '', thinking: '', adapter: 'copilot', taskIds: [], turnCost: 0, monthCost: 0 });
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
// Reviewer 2026-10-16 (R-TEAM-41), 2026-10-21: cold, retired and finished tasks of the turn are never listed (the Show completed toggle is gone).
assert.ok(state.workers.filter((w) => spend.workerIds.includes(w.workerId)).every((w) => w.expired));
const cards = ui.render(state, '', {});
assert.equal((cards.match(/class="worker-card"/g) || []).length, 0);
assert.match(cards, /<strong>0<\/strong> tasks this turn/);
assert.match(ui.chat({ lastRequest: { inputTokens: 2000, outputTokens: 0 }, workers: { ...spend, outputTokens: 0 } }, 200), />Score 1<\/span> &middot;/);
assert.match(ui.chat({ lastRequest: { inputTokens: 4, outputTokens: 3 }, workers: { inputTokens: 4, outputTokens: 0 } }, 200), />Score –<\/span> &middot;/);
console.log('PASS EV-WORKERS-TURN-CONSISTENCY');
