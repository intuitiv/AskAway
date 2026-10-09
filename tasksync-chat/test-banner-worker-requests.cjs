// Total requests (main + worker steps) in the chat banner and the Observability "This turn" line, and the worker-card 100K context flag.
// Runs the real shared render blocks of media/webview.js. Run: node test-banner-worker-requests.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const slice = (from, to) => {
    const a = webview.indexOf(from);
    const b = webview.indexOf(to);
    assert.ok(a > 0 && b > a, `${from} block present`);
    return webview.slice(a, b);
};
const ui = {};
vm.runInNewContext(`${slice('// ── Usage banner', '// ── end Usage banner ──')}\n${slice('// ── Workers tab: pure render', '// ── end Workers pure render ──')}\n`
    + 'out.chat = chatBannerHtml; out.lead = turnTotalsLead; out.workerBanner = workerBannerHtml; out.banner = usageBannerHtml;', { out: ui });
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&middot;/g, '\u00b7').replace(/\s+/g, ' ').trim();

// 41 main requests ($2.29) + 6 workers with 38 steps ($1.74).
const metrics = { lastRequest: { requestCount: 41, nanoAiu: 229e9, inputTokens: 1000, cachedTokens: 900, outputTokens: 50 },
    workers: { workers: 6, runs: 8, requests: 38, dollars: 1.74 } };
const banner = text(ui.chat(metrics, Date.now()));
assert.ok(banner.startsWith('Score 0 \u00b7 79 reqs \u00b7 $4.03 (6 workers \u00b7 38 reqs \u00b7 $1.74) \u00b7'), banner);

// Zero workers: the banner is exactly what it was before.
const solo = text(ui.chat({ lastRequest: metrics.lastRequest, workers: { runs: 0, requests: 0, dollars: 0 } }, Date.now()));
assert.equal(solo, 'Score 0 \u00b7 41 reqs \u00b7 $2.29 \u00b7 1K last in / 50 turn out \u00b7 90% cache');
assert.doesNotMatch(solo, /worker/);

// Observability "This turn" lead: total, split, and total dollars.
const lead = ui.lead(metrics.lastRequest, metrics.workers);
assert.equal(lead.text, '79 requests (main 41 \u00b7 workers 38)');
assert.equal(Math.round(lead.usd * 100) / 100, 4.03);
assert.equal(ui.lead(metrics.lastRequest, { runs: 0, requests: 0, dollars: 0 }).text, '41 requests');
assert.match(webview, /turnSummary\.innerHTML = n\s*\? \(turnTotals\.text \+ ' \\u00b7 ' \+ aiu\(usd \* 100 \* 1e9\) \+ ' AIU '/, 'the This-turn line renders the shared lead and total credits');

// Worker card: context >= 100K is flagged with the warning colour and the tooltip; below it is plain.
const card = (lastIn) => ui.workerBanner({ banner: { requests: 3, dollars: 0.5, lastIn, lastCached: 0, turnOut: 10, lastActivityAt: 1000 } }, 2000);
const over = card(100000);
assert.match(over, /<span class="obs-cache-risk" title="over 100K: each step re-sends this context">100K<\/span> last in/);
assert.doesNotMatch(card(99999), /obs-cache-risk|over 100K/);
assert.doesNotMatch(ui.banner({ requests: 1, dollars: 0, lastIn: 500000 }), /obs-cache-risk/, 'the chat banner is never flagged');

console.log('PASS EV-BANNER-WORKER-REQUESTS total=main+workers split=shown zeroWorkers=unchanged workerContext100K=flagged');
