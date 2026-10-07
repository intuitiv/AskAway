const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/media/webview.js', 'utf8');
const summary = { innerHTML: '', classList: { toggle() {} } };
const context = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
    document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }),
        getElementById: id => id === 'common-turn-summary' ? summary : null, querySelectorAll: () => [] },
    window: {}, console: { ...console, log() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, Date };
vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { handleExtensionMessage, efficiencyScore, usageBannerHtml, workerBannerHtml }; }());'), context);
const ui = context.ui;
const sample = (dollars, hit, averagePrompt, requests) => ({ dollars, lastCached: hit * 1e6, cacheInput: 1e6, averagePrompt, requests, turnOut: 1000 });
const first = sample(3.56, .95, 295000, 68);
const second = sample(.65, .99, 143000, 33);
assert.ok(Math.abs(ui.efficiencyScore(first).value - 8.5) < .1);
assert.ok(Math.abs(ui.efficiencyScore(second).value - 207) < 1);
for (const change of [{ requests: 34 }, { averagePrompt: 143000 }, { dollars: .65 }, { lastCached: 990000 }]) {
    assert.ok(ui.efficiencyScore({ ...first, ...change }).value > ui.efficiencyScore(first).value);
}
for (const b of [first, second]) {
    ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: {
        lastRequest: { requestCount: b.requests - 2, nanoAiu: (b.dollars - .1) * 100e9, inputTokens: 800000, cachedTokens: b.lastCached - 190000, outputTokens: 900 },
        workers: { requests: 2, dollars: .1, inputTokens: 200000, cachedTokens: 190000, outputTokens: 100 },
        turnRequests: [{ inputTokens: b.averagePrompt }],
    } } });
    const label = ui.efficiencyScore(b).value < 10 ? ui.efficiencyScore(b).value.toFixed(1) : String(Math.round(ui.efficiencyScore(b).value));
    assert.ok(summary.innerHTML.includes('Score ' + label), summary.innerHTML);
    for (const factor of ['CacheHit=', 'ContextFactor=', 'RequestFactor=', 'cache misses=', 'main context', 'EFFICIENCY_CONTEXT_BASE=64000']) assert.ok(summary.innerHTML.includes(factor));
}
assert.match(ui.usageBannerHtml({ ...first, dollars: 0 }), /Score –/);
assert.match(ui.usageBannerHtml({ ...first, cacheInput: 0 }), /Score –/);
const usage = { input: 100000, cacheRead: 900000, cacheWrite: 0 };
assert.match(ui.workerBannerHtml({ banner: { requests: 10, dollars: 1 }, runs: [{ usage }] }, 1000), /Score 576/);
console.log('PASS EV-EFFICIENCY-SCORE samples=8.5/207 monotonic=requests/context/cost/cache live=metrics shared=workers');
