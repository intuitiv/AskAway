const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('./node_modules/typescript');
const source = fs.readFileSync(__dirname + '/media/webview.js', 'utf8');
let openRow = false;
const node = attributes => ({ getAttribute: name => attributes[name] });
const host = { innerHTML: '', addEventListener() {}, querySelectorAll(selector) {
    if (selector === 'details[open][data-eid]') return openRow ? [node({ 'data-eid': 't:record-1234567890:answer' })] : [];
    return [];
} };
const month = { innerHTML: '', style: {} };
const categories = { innerHTML: '' };
const browser = {
    acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }), getElementById: id => id === 'obs-trace-groups' ? host : id === 'obs-workspace-month' ? month : id === 'obs-cost-categories' ? categories : null, querySelectorAll: () => [] },
    window: {}, console, setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {}
};
vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { handleExtensionMessage, traceRowsHtml, renderWorkersHtml }; }());'), browser);
const costModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/src/services/workspaceCost.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: costModule.exports, require: id => id.includes('logCursor') ? {} : require(id) });
const start = Date.UTC(2026, 9, 1), end = Date.UTC(2026, 10, 1);
const costRows = costModule.exports.monthlyCostCategories([
    { ts: start, dollars: 2, source: 'copilot' },
    { ts: start, dollars: 3, source: 'worker', profile: 'explore', category: 'Validator' },
    { ts: start, dollars: 4, source: 'worker', profile: 'build' },
    { ts: start + 1, dollars: 1, source: 'worker', profile: 'build' },
    { ts: start, dollars: 6, source: 'worker', profile: 'explore' },
    { ts: start, dollars: 7, source: 'cloud' }, { ts: start, dollars: 8, source: 'eval' },
    { ts: end, dollars: 99, source: 'worker', profile: 'review' },
    { ts: start - 1, dollars: 99, source: 'copilot' }
], start, end);
assert.equal(JSON.stringify(costRows), JSON.stringify([
    { category: 'Main', dollars: 2, requests: 1 }, { category: 'Validator', dollars: 3, requests: 1 },
    { category: 'Build', dollars: 5, requests: 2 }, { category: 'Explore', dollars: 6, requests: 1 },
    { category: 'Cloud estimate', dollars: 7 }, { category: 'Evals', dollars: 8, requests: 1 }
]));
for (const tracks of [false, true]) for (const identity of [{ kind: 'validator', profile: 'explore' }, { profile: 'validator' }, { profile: 'explore', track: 'validator' }]) {
    const workers = [{ workerId: 'new-build', profile: 'build', track: tracks ? 'a' : '' }, { workerId: 'old-proxy', track: tracks ? 'z' : '', ...identity }, { workerId: 'named-Validator', profile: 'verify', track: '' }].map(w => ({ ...w, state: 'RUNNING', runs: [] }));
    const html = browser.ui.renderWorkersHtml({ workers, generatedAt: start }, '', {}, false);
    assert.equal([...html.matchAll(/class="worker-card" data-worker-id="([^"]+)"/g)][0][1], 'old-proxy');
}
const tool = { kind: 'tool', id: 'record-1234567890:answer', ts: 20, tool: 'answer', outputPreview: 'Ready', inputTokens: 0, outputTokens: 1 };
const metrics = { monthCredits: { label: 'October', totalDollars: 102, workerDollars: 70, cloudDollars: 1, allTimeDollars: 120 }, turnEvents: [tool], traceGroups: [{ id: 'validator', label: 'Validator', events: [{ ...tool, tool: 'validator-only' }] }] };
metrics.monthCredits.categories = costRows;
const update = () => browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics } });
update();
assert.match(categories.innerHTML, /<th>Category<\/th><th>Cost \(\$\)<\/th><th>Requests<\/th>/);
for (const row of costRows) assert.ok(categories.innerHTML.includes('<td>' + row.category + '</td><td><span class="obs-month-amount">$' + row.dollars.toFixed(2) + '</span>'));
assert.ok(source.indexOf('id="obs-cost-categories"') > source.indexOf('id="obs-turn-summary"'));
assert.deepEqual([...month.innerHTML.matchAll(/<span class="obs-month-amount">([^<]+)<\/span>/g)].map(match => match[1]), ['$102.00', '$70.00', '$1.00']);
assert.equal(month.innerHTML.replace(/<[^>]+>/g, ''), 'October · this workspace: $102.00 ($70.00 workers · $1.00 cloud est.)');
assert.equal(month.style.color, '');
assert.match(fs.readFileSync(__dirname + '/media/main.css', 'utf8'), /\.obs-month-amount\s*\{ color: var\(--vscode-errorForeground\); \}/);
assert.match(host.innerHTML, /class="obs-tool-name">answer<\/span>/);
assert.doesNotMatch(host.innerHTML, />record-1234567890:answer<\/span>/);
assert.match(browser.ui.traceRowsHtml([{ ...tool, tool: 'mcp__askaway__askaway_memory' }]), /class="obs-tool-name">askaway_memory<\/span>/);
assert.doesNotMatch(host.innerHTML, /Validator|validator-only|data-trace-group|<summary>/);
assert.ok(host.innerHTML.includes(browser.ui.traceRowsHtml([tool])), 'Trace uses the shared Workers trace rows');
openRow = true;
metrics.turnEvents.unshift({ ...tool, id: 'earlier', ts: 10, tool: 'memory' });
update();
assert.doesNotMatch(host.innerHTML, /data-trace-group/);
assert.match(host.innerHTML, /data-eid="t:record-1234567890:answer" open/);
openRow = false; update();
assert.doesNotMatch(host.innerHTML, /data-eid="t:record-1234567890:answer" open/);
console.log('PASS EV-TRACE-TAB Validator pinned; monthly category aggregation/table; dollars-only red; shared rows and stable expansion');
