const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const host = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
const browser = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }), getElementById: id => id === 'obs-trace-groups' ? host : null, querySelectorAll: () => [] },
    window: {}, console, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {} };
vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { traceRowsHtml, traceGroupsHtml, handleExtensionMessage }; }());'), browser);
const request = (id, ts, dollars) => ({ kind: 'request', id, ts, model: 'fixture', dollars, inputTokens: 10, outputTokens: 2, cachedTokens: 5 });
const main = [request('MAIN-NEW', 30, 2), request('MAIN-OLD', 10, 1)];
main.forEach(event => { event.nanoAiu = event.dollars * 1e11; delete event.dollars; event.cacheHitPct = 50; event.kindTag = 'normal'; });
const groups = [
    { id: 'worker-a', label: 'build · worker-a', events: [request('WORKER-A', 20, 3)] },
    { id: 'worker-b', label: 'verify · worker-b', events: [request('WORKER-B', 40, 4)] },
    { id: 'validator', label: 'Validator', events: [request('VALIDATOR', 50, 5)] }
];
browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { turnEvents: main, traceGroups: groups } } });
for (const group of [{ id: 'main', label: 'Main agent', events: main }, groups[2]]) {
    assert.ok(host.innerHTML.includes(group.label));
    assert.ok(host.innerHTML.includes(browser.ui.traceRowsHtml(group.events.slice().sort((a, b) => a.ts - b.ts), {})), 'exact shared component output');
    assert.ok(host.innerHTML.includes('data-trace-group="' + group.id + '"'));
}
assert.ok(host.innerHTML.indexOf('MAIN-OLD') < host.innerHTML.indexOf('MAIN-NEW'), 'newest at bottom');
assert.doesNotMatch(host.innerHTML, /worker-a|worker-b|WORKER-A|WORKER-B/);
assert.ok(host.innerHTML.includes('$5.00'));
assert.match(host.innerHTML, /<details class="trace-group"/);
assert.match(browser.ui.traceGroupsHtml(main, groups, new Set(['validator'])), /data-trace-group="validator" open/);
const created = [];
browser.document.createElement = () => { const e = { innerHTML: '', appendChild() {} }; created.push(e); return e; };
const monthElement = { style: {} };
browser.document.getElementById = id => id === 'observability-tab-shell' ? { appendChild() {} } : id === 'obs-workspace-month' ? monthElement : id === 'obs-trace-groups' ? host : null;
vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { createObservabilityTab, handleExtensionMessage }; }());'), browser);
browser.ui.createObservabilityTab();
const markup = created.find(e => e.innerHTML.includes('obs-workspace-month')).innerHTML;
const ordered = ['obs-workspace-month', 'obs-turn-summary', 'obs-cache-age', 'obs-cache-ping-btn', 'obs-trace-groups'];
for (let i = 0; i < ordered.length; i++) {
    assert.ok(markup.includes(ordered[i]), ordered[i] + ' must render');
    if (i) assert.ok(markup.indexOf(ordered[i - 1]) < markup.indexOf(ordered[i]), 'month → summary → cache → Ping → groups');
}
assert.doesNotMatch(markup, />\s*Trace\s*</);
assert.doesNotMatch(markup, /RTK:|Gradle:|observability-rtk-line" id="observability-rtk/);
browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { monthCredits: { label: 'October', totalDollars: 102.03, workerDollars: 73.32, cloudDollars: 1.20 } } } });
assert.equal(monthElement.textContent, 'October · this workspace: $102.03 ($73.32 workers · $1.20 cloud est.)');
browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { monthCredits: { label: 'October', totalDollars: 100, workerDollars: 70, cloudDollars: 0 } } } });
assert.equal(monthElement.textContent, 'October · this workspace: $100.00 ($70.00 workers)');
const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
assert.match(provider, /data-tab="observability"[^>]*>Trace<\/button>/);
assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false);
// Exercise the provider boundary with real ledger-to-trace conversion and validator record shapes.
const workerModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/workersState.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: workerModule.exports, module: workerModule, require: () => ({}) });
const mod = { exports: {} };
const facts = [{ type: 'checkpoint', ts: 20, workerId: 'a', runId: 'run-a', track: 'build', model: 'fixture', usage: { input: 10, cacheRead: 5, cacheWrite: 0, output: 2, cost: 3 } },
    { type: 'checkpoint', ts: 5, workerId: 'old', runId: 'old', model: 'fixture', usage: {} }];
vm.runInNewContext(ts.transpileModule(provider, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, require: id => id === 'vscode' ? {} : id === 'fs' ? { promises: { readdir: async () => ['_no-spec'] } }
        : id.endsWith('/workerHost') ? { sharedWorkerRuntime: () => ({ facts: () => facts }) }
        : id.endsWith('/workersState') ? workerModule.exports
        : id.endsWith('/validator/records') ? { ValidatorRecords: class { responses() { return [{ id: 'v', ts: 25, observedId: 'main', usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 5 }, answer: 'yes' }]; } } }
        : id.startsWith('.') ? {} : require(id), Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval
});
(async () => {
    const instance = Object.create(mod.exports.AskAwayWebviewProvider.prototype); instance._lastSubmitTs = 10;
    const projected = await instance._turnTraceGroups('/fixture');
    assert.equal(projected.length, 1); assert.equal(projected[0].label, 'Validator');
    assert.equal(projected[0].events[0].dollars, 5);
    assert.equal(projected[0].events.find(event => event.kind === 'tool').tool, 'answer');
    browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { traceGroups: projected } } });
    assert.match(host.innerHTML, /class="obs-tool-name">answer<\/span>/);
    assert.ok(require('./package.json').scripts['pretest:workers'].includes('test-trace-tab-unification.cjs'));
    console.log('PASS EV-TRACE-TAB-UNIFICATION Main agent/Validator only; summary/cache/Ping above groups; no inner Trace/RTK/Gradle headings; monthly cloud estimate; CRLF');
})().catch(error => { console.error(error); process.exitCode = 1; });
