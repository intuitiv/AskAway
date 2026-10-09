const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const ts = require('./node_modules/typescript');

// In-memory files keep the caller fixture deterministic, without timers or scratch directories.
const workspace = __dirname;
const turnStart = 10000;
const key = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const usage = (cost) => ({ input: 100, cacheRead: 50, cacheWrite: 0, output: 10, cost });
const record = (ts, workerId, runId, type, cost, extra = {}) => ({ ts, workspace, workerId, runId, type, model: 'worker-model',
    ...(cost === undefined ? {} : { usage: usage(cost) }), ...extra });
const ledger = [record(9000, 'w1', 'carry', 'start'), record(9500, 'w1', 'carry', 'checkpoint', 9),
    record(10000, 'w1', 'carry', 'checkpoint', .1), record(11000, 'w1', 'next', 'start'),
    record(12000, 'w1', 'next', 'checkpoint', .1), record(13000, 'w1', 'next', 'checkpoint', .1, { ping: true }),
    record(14000, 'w2', 'fork', 'start', undefined, { forkedFrom: 'w1' }), record(15000, 'w2', 'fork', 'checkpoint', .1),
    record(15500, 'w2', 'fork', 'after_tool', undefined, { tool: 'build', durMs: 100, toolTokens: { output: 30 } })];
const mainRequests = [1, 2].map((n) => ({ ts: 10000 + n, type: 'llm_request', attrs: { copilotUsageNanoAiu: 10e9, inputTokens: 200, outputTokens: 20 } }));
const main = { requestCount: 2, nanoAiu: 20e9, inputTokens: 400, outputTokens: 40, cachedTokens: 0 };
const files = new Map([
    [`/ledger/${key}.jsonl`, ledger.map(JSON.stringify).join('\n')],
    ['/ledger/other-cwd.jsonl', JSON.stringify(record(16000, 'foreign', 'foreign', 'checkpoint', 99, { workspace: '/other-cwd' }))],
    [`${workspace}/GitHub.copilot-chat/debug-logs/session/main.jsonl`, [{ ts: turnStart, type: 'user_message' }, ...mainRequests].map(JSON.stringify).join('\n')],
]);
const fakeFs = { ...fs, realpathSync: (p) => p,
    readFileSync: (p, ...args) => { if (files.has(p)) return files.get(p); if (String(p).startsWith('/ledger/')) throw new Error('ENOENT'); return fs.readFileSync(p, ...args); },
    promises: { readdir: async (p, opts) => opts ? [{ name: 'session', isDirectory: () => true }] : ['main.jsonl'],
        stat: async () => ({ mtimeMs: 1 }), readFile: async (p) => { assert.ok(files.has(p), p); return files.get(p); } } };
const registered = {};
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: workspace } }], getConfiguration: () => ({ get: () => 100 }) },
    lm: { registerTool: (name, tool) => { registered[name] = tool; return { dispose() {} }; } },
    LanguageModelToolResult: class { constructor(content) { this.content = content; } }, LanguageModelTextPart: class { constructor(value) { this.value = value; } } };
const modules = new Map();
let runtime;
let specTurn;
const host = { workerSpendSince: (root, since) => runtime.usageSince(root, since) };
function load(relative) {
    const filename = path.join(__dirname, 'src', relative + '.ts');
    if (modules.has(filename)) return modules.get(filename).exports;
    const mod = { exports: {} }; modules.set(filename, mod);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const req = (name) => {
        if (name === 'vscode') return vscode;
        if (name === 'fs') return fakeFs;
        if (name.endsWith('/workerHost')) return host;
        if (name.endsWith('/specCostLedger')) return { recordSpecTurn: (_file, turn) => { specTurn = turn; }, specCostLedgerFile: () => '/spec-ledger', readActiveSpecSlug: () => '001-fixture' };
        if (name.startsWith('.')) {
            const rel = path.relative(path.join(__dirname, 'src'), path.resolve(path.dirname(filename), name));
            if (relative.startsWith('workers/') || name.endsWith('/turnBudget')) return load(rel);
            return {};
        }
        return require(name);
    };
    vm.runInNewContext(code, { require: req, module: mod, exports: mod.exports, console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, URL }, { filename });
    return mod.exports;
}
const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime');
runtime = new OpenCodeWorkerRuntime([], { ledgerDir: '/ledger' });
const workers = runtime.usageSince(workspace, turnStart);
const plain = (value) => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'number' ? Number(v.toFixed(10)) : v));
assert.equal(workers.cachedTokens, 200);
assert.equal(workers.perModel['worker-model'].requests, 4);
const expected = { requests: 6, dollars: .6, workers: 2, workerIds: ['w1', 'w2'], workerRuns: 3, inputTokens: 1000, outputTokens: 80 };
const { AskAwayWebviewProvider } = load('webview/webviewProvider');
const provider = Object.create(AskAwayWebviewProvider.prototype);
Object.assign(provider, { _lastRequestMetrics: main, _turnRequests: mainRequests.map((r) => r.attrs), _newestRequestTs: 15000, _lastSubmitTs: turnStart });
const activity = provider.getTurnActivity();
for (const [field, value] of Object.entries(expected)) assert.deepEqual(plain(activity[field]), value, `Telegram activity ${field}`);
let workerMessage;
provider.setWorkersStateSource(() => ({ workers: [{ workerId: 'w1', expired: true }, { workerId: 'w2' }, { workerId: 'foreign', expired: true }] }));
provider._broadcast = (message) => { workerMessage = message; };
provider._refreshWorkersState();
assert.deepEqual(plain(workerMessage.data.turnWorkerIds), expected.workerIds);

// Execute the complete webview in a browser VM; dispatch through its actual message handler.
function browser(source, extra = {}) {
    const summary = { innerHTML: '', classList: { toggle() {} } };
    const element = () => ({ innerHTML: '', textContent: '', children: [], appendChild(child) { this.children.push(child); }, addEventListener() {}, querySelectorAll: () => [], classList: { toggle() {} } });
    const elements = Object.fromEntries(['obs-turn-summary', 'obs-turn-event-tbody', 'observability-tab-shell'].map(id => [id, element()]));
    const context = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
        document: { readyState: 'loading', addEventListener() {}, createElement: element, getElementById: (id) => id === 'common-turn-summary' ? summary : elements[id] || null, querySelectorAll: () => [] },
        window: {}, console: { ...console, log() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, Date };
    source = source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { createObservabilityTab, handleExtensionMessage, chatBannerHtml, turnTotalsLead, metrics: () => observabilityMetrics }; }());');
    vm.runInNewContext(source, context);
    context.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { lastRequest: main, workers, turnRequests: mainRequests.map((r) => r.attrs), turnStartedAt: turnStart, ...extra } } });
    return { ui: context.ui, summary, elements };
}
const source = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const { ui, summary, elements } = browser(source);
ui.createObservabilityTab();
const renderedTab = (node) => node.innerHTML + node.children.map(renderedTab).join('');
const tab = renderedTab(elements['observability-tab-shell']);
assert.doesNotMatch(tab, /This month|Per-model|Tool calls|Debug Details|Memories|obs-all-|obs-month-|observability-model-tbody|obs-turn-tool-tbody/);
assert.match(tab, /obs-turn-event-tbody/);
assert.equal((elements['obs-turn-event-tbody'].innerHTML.match(/<tr\b/g) || []).length, 2, 'both request rows still render');
assert.match(elements['obs-turn-event-tbody'].innerHTML, /<td>200<\/td><td>20<\/td>/);
console.log('PASS EV-METRICS-UI-REMOVAL retired sections absent; turn trace renders');
const normalized = ui.metrics();
assert.deepEqual(plain(normalized.workers), plain(workers), 'the provider metrics message retains every ledger field');
const banner = ui.chatBannerHtml(normalized, 16000).replace(/<[^>]+>/g, '').replaceAll('&middot;', '·');
assert.match(banner, /^Turn 0:06 · Score 0 · 6 reqs · \$0\.60 \(2 workers · 4 reqs · \$0\.40\)/);
assert.match(banner, /80 turn out · 20% cache/);
assert.match(summary.innerHTML, /Main agent own context length/);
assert.match(elements['obs-turn-summary'].innerHTML, /1K in \/ 80 out · 20% cache hit/);
assert.ok(summary.innerHTML.includes('(2 workers'), 'real banner update uses the normalised worker count');
const lead = ui.turnTotalsLead(normalized.lastRequest, normalized.workers);
assert.equal(lead.total, expected.requests); assert.equal(plain(lead.usd), expected.dollars);
assert.equal(lead.text, '6 requests (main 2 · workers 4)');

// The base regression proof executes the old normaliser, without touching the working tree.
for (const revision of ['0802113', '6265d59']) {
    const old = cp.execFileSync('rtk', ['git', 'show', `${revision}:tasksync-chat/media/webview.js`], { encoding: 'utf8', maxBuffer: 2e6 });
    const oldUi = browser(old).ui;
    assert.notDeepEqual(plain(oldUi.metrics().workers), plain(workers), `${revision} loses the identity/token contract`);
    assert.doesNotMatch(oldUi.chatBannerHtml(oldUi.metrics(), 16000), /\(2 workers/);
    console.log(`BASE ${revision} FAIL: metrics normaliser drops workers/workerIds/inputTokens/outputTokens`);
}

// Use the actual LM registration/invocation block, with its real debug-log reader and budget functions.
const tools = fs.readFileSync(path.join(__dirname, 'src/tools.ts'), 'utf8');
const begin = tools.indexOf('async function currentTurnBudget');
const end = tools.indexOf('export interface Input');
const registration = tools.slice(tools.indexOf('let turnBudgetTool:'), tools.indexOf('if (turnBudgetTool)'));
const budgetContext = { vscode, fs: fakeFs, path, context: { storageUri: { fsPath: `${workspace}/extension-storage` } },
    workerSpendSince: host.workerSpendSince, computeTurnBudget: load('workers/turnBudget').turnBudget, turnTotals: load('workers/turnBudget').turnTotals, logToolCall() {} };
vm.runInNewContext(ts.transpileModule(tools.slice(begin, end) + registration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, budgetContext);
(async () => {
    const reply = JSON.parse((await registered.turn_budget.invoke({}, {})).content[0].value);
    assert.equal(reply.requestCount, expected.requests);
    for (const field of ['dollars', 'workers', 'workerIds', 'inputTokens', 'outputTokens', 'workerRuns']) assert.deepEqual(plain(reply[field]), expected[field], `turn_budget ${field}`);
    assert.equal(reply.spentAiu, 60);
    const telegram = load('commentary/telegramLive');
    const line = telegram.usageLine(activity);
    assert.match(line, /6 requests · 2 workers · <b>\$0\.60<\/b>/);
    assert.match(telegram.statusFooter(16000, turnStart, activity), /6 requests · 2 workers/);
    assert.match(line, /80 turn out/, 'Telegram periodic and final usage includes worker output');
    provider._broadcastObservabilityMetrics = async () => {};
    const snapshot = await provider.getTurnMetricsSnapshot();
    assert.equal(snapshot.turnOutputTokens, 80);
    assert.equal(snapshot.turnNanoAiu, 60e9);
    assert.equal(snapshot.latestInputTokens, 200, 'only the explicitly labelled last in remains main context');
    const handoff = load('services/handoffNotifier').telegramHandoffUpdate({ handoff: 'done', details: '' }, snapshot);
    assert.match(handoff, /200 last in · 80 turn out · \$0\.60 turn/);
    provider._recordSpecTurnCost();
    assert.equal(specTurn.requests, 6);
    assert.equal(specTurn.nanoAiu, 60e9);
    assert.equal(specTurn.inputTokens, 1000);
    assert.equal(specTurn.outputTokens, 80);
    let finalHeader;
    const relay = new telegram.TelegramLiveCommentary(() => ({ isConfigured: () => true,
        finishLive: async (_id, head) => { finalHeader = head; return true; } }), 'fixture', { activity: () => provider.getTurnActivity() });
    relay.messageId = 1;
    await relay.finish('done', 'fixture');
    assert.match(finalHeader, /6 requests · 2 workers · <b>\$0\.60<\/b>/);
    assert.match(finalHeader, /80 turn out/);
    // January 1970 fixture: month includes the earlier $9 checkpoint, unlike the turn.
    Object.assign(provider, { _overallLastComputedAt: 0, _OVERALL_RECOMPUTE_MS: 10000,
        _monthFileCache: new Map([['fixture', { months: new Map([['1970-01', { ...main, cacheMisses: 0, compactionCount: 0, compactionNanoAiu: 0, perModel: new Map([['main-model', main]]) }]]) }]]) });
    provider._loadMonthFileCache = async () => {};
    provider._findAllCopilotDebugLogFiles = async () => [];
    provider._saveMonthFileCache = async () => {};
    const month = await provider._computeOverallMonth('1970-01');
    assert.equal(month.totals.requestCount, 7);
    assert.equal(month.totals.nanoAiu, 960e9);
    assert.equal(month.totals.inputTokens, 1150);
    assert.equal(month.totals.outputTokens, 90);
    assert.equal(month.totals.cachedTokens, 250);
    assert.equal(month.perModel.find(row => row.model === 'worker-model').nanoAiu, 940e9);
    const tool = { tool: 'build', calls: 1, outputTokens: 20, avgMs: 200, minMs: 200, maxMs: 200, errors: 0, cacheRisk: false };
    const toolMain = { totalCalls: 1, totalOutputTokens: 20, byTool: [tool], turn: { totalCalls: 1, totalOutputTokens: 20, byTool: [tool] } };
    const tools = provider._withWorkerTools(toolMain);
    assert.equal(tools.turn.totalOutputTokens, 50);
    // Current-month tool fixture retains the same worker records, moved to this month's boundary.
    const currentStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    files.set(`/ledger/${key}.jsonl`, ledger.map(row => JSON.stringify({ ...row, ts: currentStart + row.ts })).join('\n'));
    const currentTools = provider._withWorkerTools(toolMain);
    assert.equal(currentTools.totalOutputTokens, 50);
    files.set(`/ledger/${key}.jsonl`, ledger.map(JSON.stringify).join('\n'));
    console.log('PASS EV-TURN-MONTH-CACHE-TOOLS turn=6/60AIU/1000in/80out/20%cache month=7/960AIU/1150in/90out/22%cache tools=50out');
    console.log('PASS EV-TURN-TOTALS-SNAPSHOT-SPEC-FINAL requests=6 AIU=60 input=1000 output=80');
    for (const consumer of ['banner', 'Observability', 'turn_budget', 'Telegram', 'Workers filter']) console.log(`${consumer}: requests=6 dollars=0.60 AIU=60 workers=2 ids=w1,w2 input=1000 output=80`);
    console.log('PASS EV-TURN-TOTALS-RECONCILE');
})().catch((error) => { console.error(error); process.exitCode = 1; });
