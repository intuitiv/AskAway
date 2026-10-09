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
const request = { inputTokens: 64000, cachedTokens: 57600, outputTokens: 1000 };
function render(rows, workers = {}, cost) {
    const sum = key => rows.reduce((n, row) => n + row[key], 0);
    ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: {
        lastRequest: { requestCount: rows.length, inputTokens: sum('inputTokens'), cachedTokens: sum('cachedTokens'),
            outputTokens: sum('outputTokens'), nanoAiu: cost === undefined ? sum('inputTokens') / 1e6 * .30 * 100e9 : cost * 100e9 },
        workers, turnRequests: rows, turnStartedAt: Date.now() - 60000, lastRequestTs: Date.now()
    } } });
    return summary.innerHTML;
}
const score = html => Number(html.match(/>Score (\d+)<\/span>/)[1]);
const one = render([request]);
assert.equal(score(one), 90);
assert.equal(score(render([request, request])), score(one), 'doubling equal-efficiency requests preserves score');
assert.ok(Math.abs(score(render([request], { requests: 1, dollars: .0192, inputTokens: 64000, cachedTokens: 57600, outputTokens: 1000 })) - score(one)) <= 5, 'late equally efficient worker checkpoint is stable');
const child = { inputTokens: 1000000, cachedTokens: 900000, outputTokens: 1000, subagentId: 'child' };
assert.match(render([request, child]), /main context\) \(average prompt\)=64000|main context \(average prompt\)=64000/);
const many = [{ ...request, inputTokens: 640000, cachedTokens: 576000 }, ...Array.from({ length: 500 }, () => request)];
assert.match(render(many), /requests=501;/);
assert.ok(render(many).includes('main context (average prompt)=' + (32640000 / 501)), 'context includes the first request beyond 500');
for (const factor of ['CacheHit=', 'ContextFactor=', 'PriceFactor=', 'cost=$', 'cache misses=', 'input=', 'output=', 'requests=', 'main context']) assert.ok(one.includes(factor));
assert.match(render([request], {}, 0), />Score –<\/span>/);
assert.match(ui.usageBannerHtml({ cacheInput: 100 }), />Score –<\/span>/);
assert.match(ui.usageBannerHtml({ dollars: 1, cacheInput: 0 }), />Score –<\/span>/);
assert.match(one.replace(/<[^>]+>/g, ''), /^Turn 1:0\d &middot; Score 90 &middot; 1 req/);
const usage = { input: 6400, cacheRead: 57600, cacheWrite: 0, output: 1000 };
assert.match(ui.workerBannerHtml({ banner: { requests: 1, dollars: .0192, turnOut: 1000 }, runs: [{ usage }] }, 1000), />Score 90<\/span>/);
console.log('PASS EV-EFFICIENCY-SCORE doubling=stable checkpoint=stable mainOnly=true requests=501 missing=– timer+score=first shared=workers');
