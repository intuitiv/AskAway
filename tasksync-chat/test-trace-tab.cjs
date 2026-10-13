const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/media/webview.js', 'utf8');
let openRow = false;
const node = attributes => ({ getAttribute: name => attributes[name] });
const host = { innerHTML: '', addEventListener() {}, querySelectorAll(selector) {
    if (selector === 'details[open][data-eid]') return openRow ? [node({ 'data-eid': 't:record-1234567890:answer' })] : [];
    return [];
} };
const month = { innerHTML: '', style: {} };
const browser = {
    acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }), getElementById: id => id === 'obs-trace-groups' ? host : id === 'obs-workspace-month' ? month : null, querySelectorAll: () => [] },
    window: {}, console, setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {}
};
vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { handleExtensionMessage, traceRowsHtml }; }());'), browser);
const tool = { kind: 'tool', id: 'record-1234567890:answer', ts: 20, tool: 'answer', outputPreview: 'Ready', inputTokens: 0, outputTokens: 1 };
const metrics = { monthCredits: { label: 'October', totalDollars: 102, workerDollars: 70, cloudDollars: 1, allTimeDollars: 120 }, turnEvents: [tool], traceGroups: [{ id: 'validator', label: 'Validator', events: [{ ...tool, tool: 'validator-only' }] }] };
const update = () => browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics } });
update();
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
console.log('PASS EV-TRACE-TAB main agent only, no collapsible group, shared rows; dollars-only theme red; stable row expansion survives inserted data update');
