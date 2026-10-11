const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const fixture = path.join(__dirname, 'build', 'month-credits-' + process.pid);
fs.mkdirSync(fixture, { recursive: true });
const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
const row = (ts, aiu) => JSON.stringify({ ts, type: 'llm_request', attrs: { copilotUsageNanoAiu: aiu * 1e9 } });
function log(workspace, session, lines, name = 'main.jsonl') {
    const dir = path.join(fixture, 'workspaceStorage', workspace, 'GitHub.copilot-chat', 'debug-logs', session);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), lines.join('\n'));
}
log('current', 'a', [row(start, 12.4), '{malformed', row(start - 1, 999), row(start + 1000, 10)]);
log('current', 'b', [row(start + 2000, 290)]);
log('current', 'b', [row(start + 2000, 999)], 'runSubagent-child.jsonl');
log('other', 'a', [row(start, 999)]);
const source = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const mod = { exports: {} };
const workspace = path.join(fixture, 'project');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, require: id => id === 'vscode' ? { workspace: { workspaceFolders: [{ uri: { fsPath: workspace } }] } } : id.endsWith('/workerHost') ? { workerSpendSince(root, since) { assert.equal(root, workspace); assert.equal(since, start); return { dollars: 4.1 }; } } : id.startsWith('.') ? {} : require(id), console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval
});
(async () => {
    const provider = Object.create(mod.exports.AskAwayWebviewProvider.prototype);
    provider._context = { storageUri: { fsPath: path.join(fixture, 'workspaceStorage/current/askaway') } };
    const credits = await provider._computeWorkspaceMonth();
    assert.equal(credits.aiu, 312.4); assert.equal(credits.workerDollars, 4.1);
    assert.deepEqual(await provider._computeWorkspaceMonth(), credits, 'recomputing never double counts');
    const elements = { 'obs-workspace-month': { textContent: '' }, 'common-turn-summary': { innerHTML: '', classList: { toggle() {} } } };
    const created = [];
    const browser = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
        document: { readyState: 'loading', addEventListener() {}, createElement: () => { const e = { innerHTML: '', textContent: '', appendChild() {} }; created.push(e); return e; }, getElementById: id => id === 'observability-tab-shell' ? { innerHTML: '', appendChild() {} } : elements[id] || null, querySelectorAll: () => [] },
        window: {}, console: { ...console, log() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, Date };
    const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
    vm.runInNewContext(webview.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { createObservabilityTab, handleExtensionMessage }; }());'), browser);
    browser.ui.createObservabilityTab();
    assert.ok(created.some(e => e.innerHTML.startsWith('<div class="observability-rtk-line" id="obs-workspace-month">')), 'month line is first in Metrics');
    browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { monthCredits: credits } } });
    assert.equal(elements['obs-workspace-month'].textContent, credits.label + ' · this workspace: 312.4 AIU chat · $4.10 workers');
    assert.doesNotMatch(elements['common-turn-summary'].innerHTML, /this workspace|312\.4|4\.10/);
    console.log('PASS EV-MONTH-CREDITS-WORKSPACE current=312.4AIU workers=$4.10 separate; other/last-month/child excluded; malformed skipped; Metrics top only');
})().catch(error => { console.error(error); process.exitCode = 1; });
