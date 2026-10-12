const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const fixture = path.join(__dirname, 'build', 'month-credits-' + process.pid);
fs.mkdirSync(fixture, { recursive: true });
const now = new Date(), start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const row = (ts, aiu) => JSON.stringify({ ts, type: 'llm_request', attrs: { copilotUsageNanoAiu: aiu * 1e9 } });
function log(workspace, session, lines, name = 'main.jsonl') {
    const dir = path.join(fixture, 'workspaceStorage', workspace, 'GitHub.copilot-chat', 'debug-logs', session);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
}
log('current', 'a', [row(start, 1000), '{malformed', row(start - 60000, 999), row(start + 1000, 1000)]);
log('current', 'b', [row(start + 2000, 2000)]);
log('other', 'a', [row(start, 999)]);
const source = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const mod = { exports: {} };
const workspace = path.join(fixture, 'project');
const home = path.join(fixture, 'home');
const worktree = path.join(fixture, 'worktree');
const writeRows = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n'); };
fs.mkdirSync(workspace, { recursive: true });
const key = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
writeRows(path.join(home, '.askaway/worker-ledger', key + '.jsonl'), [
    { type: 'checkpoint', workspace, ts: start, sessionId: 'worker', callId: 'call-1', usage: { cost: 20 } },
    { type: 'checkpoint', workspace: '/other', ts: start, usage: { cost: 200 } },
    { type: 'checkpoint', workspace, ts: start - 60000, usage: { cost: 99 } },
    { type: 'checkpoint', workspace, ts: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1), usage: { cost: 99 } }
]);
writeRows(path.join(workspace, '.askaway/specs/_no-spec/validator/responses.jsonl'), [
    { id: 'v1', ts: start, usage: { cost: 5 } },
    { id: 'v2', ts: start, sessionId: 'worker', callId: 'call-1', usage: { cost: 20 } },
    { id: 'v3', ts: start - 60000, usage: { cost: 99 } }
]);
const costs = { exports: {} };
const cursor = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/observability/logCursor.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: cursor, exports: cursor.exports, require, Buffer
});
let gitCalls = 0;
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/services/workspaceCost.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: costs, exports: costs.exports, require: id => id.endsWith('/logCursor') ? cursor.exports : id === 'os' ? { homedir: () => home } : id === 'child_process' ? { execFile(command, args, options, callback) { gitCalls++; assert.equal(command, 'git'); assert.deepEqual(Array.from(args), ['-C', workspace, 'worktree', 'list', '--porcelain']); callback(null, { stdout: `worktree ${workspace}\n\nworktree ${worktree}\n` }); } } : require(id)
});
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, require: id => id === 'vscode' ? { workspace: { workspaceFolders: [{ uri: { fsPath: workspace } }] } } : id.endsWith('/workspaceCost') ? costs.exports : id.endsWith('/logCursor') ? cursor.exports : id.startsWith('.') ? {} : require(id), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval
});
(async () => {
    const provider = Object.create(mod.exports.AskAwayWebviewProvider.prototype);
    const state = new Map();
    provider._context = { storageUri: { fsPath: path.join(fixture, 'workspaceStorage/current/askaway') }, workspaceState: {
        get: (key, fallback) => state.has(key) ? JSON.parse(state.get(key)) : fallback,
        update: async (key, value) => state.set(key, JSON.stringify(value))
    } };
    const credits = await provider._computeWorkspaceMonth();
    assert.equal(credits.aiu, 4000); assert.equal(credits.workerDollars, 20); assert.equal(credits.validatorDollars, 5); assert.equal(credits.totalDollars, 65);
    assert.deepEqual(await provider._computeWorkspaceMonth(), credits, 'recomputing never double counts');
    const elements = { 'obs-workspace-month': { textContent: '', style: {} }, 'common-turn-summary': { innerHTML: '', classList: { toggle() {} } } };
    const created = [];
    const browser = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
        document: { readyState: 'loading', addEventListener() {}, createElement: () => { const e = { innerHTML: '', textContent: '', appendChild() {} }; created.push(e); return e; }, getElementById: id => id === 'observability-tab-shell' ? { innerHTML: '', appendChild() {} } : elements[id] || null, querySelectorAll: () => [] },
        window: {}, console: { ...console, log() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, Date };
    const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
    vm.runInNewContext(webview.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { createObservabilityTab, handleExtensionMessage }; }());'), browser);
    browser.ui.createObservabilityTab();
    assert.ok(created.some(e => e.innerHTML.startsWith('<div class="observability-rtk-line" id="obs-workspace-month">')), 'month line is first in Metrics');
    browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { monthCredits: credits } } });
    assert.equal(elements['obs-workspace-month'].textContent, credits.label + ' · this workspace: $65.00 ($20.00 workers)');
    assert.equal(elements['obs-workspace-month'].style.color, 'var(--vscode-errorForeground)');
    assert.doesNotMatch(elements['common-turn-summary'].innerHTML, /this workspace|65\.00|20\.00/);
    writeRows(path.join(home, '.askaway/evals/results.jsonl'), [
        { workspacePath: workspace, ts: new Date(start).toISOString(), usage: { cost: 2 } },
        { workspacePath: '/other', ts: start, usage: { cost: 100 } },
        { workspacePath: workspace, ts: start - 60000, usage: { cost: 100 } },
        { workspacePath: workspace, ts: start, sessionId: 'worker', callId: 'call-1', usage: { cost: 20 } }
    ]);
    assert.equal((await provider._computeWorkspaceMonth()).totalDollars, 67);
    log('current', 'b', [row(start + 2000, 1000)], 'runSubagent-child.jsonl');
    const worktreeKey = worktree.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    writeRows(path.join(home, '.askaway/worker-ledger', worktreeKey + '.jsonl'), [
        { type: 'checkpoint', workspace: worktree, ts: start, sessionId: 'tree', callId: 'tree-call', usage: { cost: 10 } },
        { type: 'checkpoint', workspace: worktree, ts: start, sessionId: 'tree', callId: 'tree-call', usage: { cost: 10 } }
    ]);
    const withChildren = await provider._computeWorkspaceMonth();
    assert.equal(withChildren.totalDollars, 87, 'child and worktree each add $10');
    assert.equal(withChildren.workerDollars, 30);
    assert.equal(withChildren.allTimeDollars, 493.99, 'all-time includes previous and next UTC months and both $10 sources');
    assert.equal(Object.values(withChildren.months).reduce((sum, dollars) => sum + dollars, 0), withChildren.allTimeDollars);
    assert.equal(withChildren.months[now.toISOString().slice(0, 7)], withChildren.totalDollars);
    fs.appendFileSync(path.join(workspace, '.askaway/specs/_no-spec/validator/responses.jsonl'), JSON.stringify(
        { id: 'v4', ts: start, sessionId: 'worker', callId: 'call-2', usage: { cost: 3 } }) + '\n');
    assert.equal((await provider._computeWorkspaceMonth()).totalDollars, 90, 'a different request in the same session is not dropped');
    const workerFile = path.join(home, '.askaway/worker-ledger', key + '.jsonl');
    fs.appendFileSync(workerFile, [
        { type: 'checkpoint', workspace, ts: start + 3000, runId: 'shared-run', sessionId: 'shared', messageId: 'shared-message', usage: { cost: 4 } },
        null,
        { type: 'checkpoint', workspace, ts: start + 4000, runId: 'real-validator-run', workerId: 'validator-worker', sessionId: 'validator-session', usage: { cost: 6 } },
        { type: 'start', track: 'validator', workspace, ts: start + 3500, runId: 'real-validator-run', workerId: 'validator-worker', sessionId: 'validator-session' }
    ].map(JSON.stringify).join('\n') + '\n');
    fs.appendFileSync(path.join(workspace, '.askaway/specs/_no-spec/validator/responses.jsonl'), [
        null,
        { id: 'different-response-id', ts: start + 3000, sessionId: 'shared', messageId: 'shared-message', usage: { cost: 4 } },
        { id: 'run-response', ts: start + 3000, runId: 'shared-run', usage: { cost: 4 } },
        { id: 'real-response', ts: start + 3400, workerId: 'validator-worker', sessionId: 'validator-session', usage: { cost: 6 } }
    ].map(JSON.stringify).join('\n') + '\n');
    fs.appendFileSync(path.join(home, '.askaway/evals/results.jsonl'), [
        { ts: start, usage: { cost: 1000 } }, null,
        { workspacePath: workspace, ts: start + 5000, id: 'owned-eval', usage: { cost: 1 } }
    ].map(JSON.stringify).join('\n') + '\n');
    const reviewed = await provider._computeWorkspaceMonth();
    assert.equal(reviewed.totalDollars, 101, 'ownerless excluded; shared message/run and real validator shapes counted once; null skipped');
    assert.equal(gitCalls, 1, 'worktree discovery cached and asynchronous');
    const oldLog = path.join(fixture, 'workspaceStorage/current/GitHub.copilot-chat/debug-logs/a/main.jsonl');
    fs.renameSync(oldLog, oldLog + '.removed');
    const reloaded = Object.create(mod.exports.AskAwayWebviewProvider.prototype);
    reloaded._context = provider._context;
    const retained = await reloaded._computeWorkspaceMonth();
    assert.equal(retained.allTimeDollars, reviewed.allTimeDollars, 'old log removal and provider reload preserve durable all-time');
    assert.equal(retained.totalDollars, reviewed.totalDollars);
    assert.equal(Object.values(retained.months).reduce((sum, value) => sum + value, 0), retained.allTimeDollars);
    const bytes = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'));
    assert.equal(bytes.toString().replace(/\r\n/g, '').includes('\n'), false, 'provider retains CRLF');
    console.log('PASS EV-MONTH-CREDITS-WORKSPACE ownerless excluded; cross-ledger request dedup; null skipped; durable history survives log removal/reload; child/worktree included; sum(months)==all-time; red UTC CRLF; cached async git');
})().catch(error => { console.error(error); process.exitCode = 1; });
