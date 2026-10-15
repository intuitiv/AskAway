// Benchmark scoreboard: one line per run with completion k/n next to the SAME Score as the live banner.
// The row -> banner conversion, the score gate and the Score itself are loaded from media/webview.js (research D2),
// so the CLI, the Workers tab and the banner cannot drift.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEBVIEW = path.join(__dirname, '..', '..', 'media', 'webview.js');
const EXPORTS = ['efficiencyScore', 'usageBannerHtml', 'benchmarkBanner', 'benchmarkCompletion', 'benchmarkScoreLabel', 'benchmarkComparable', 'workersBenchmarkHtml', 'renderWorkersHtml'];

let shared;
/** The webview's pure render functions, run in a stub DOM context exactly as the webview tests do. */
function webviewFunctions() {
    if (shared) { return shared; }
    const source = fs.readFileSync(WEBVIEW, 'utf8');
    const context = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
        document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '' }), getElementById: () => null, querySelectorAll: () => [] },
        window: {}, console: { ...console, log() {} }, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {}, Date };
    vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, `globalThis.shared = { ${EXPORTS.join(', ')} }; }());`), context);
    shared = context.shared;
    return shared;
}

function readRows(file) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    return text.split('\n').flatMap((line) => { try { const row = JSON.parse(line); return row && row.suite === 'benchmark' ? [row] : []; } catch { return []; } });
}

function modelMixLabel(configuration) {
    const mix = configuration?.modelMix || {};
    const workers = [...new Set(Object.values(mix.workers || {}))].filter((m) => m !== mix.main);
    return `${mix.main || '-'}${workers.length ? `+workers:${workers.join(',')}` : ''}`;
}

/** Derived scoreboard row (data-model "Scoreboard row"): never stored. */
function scoreboardRow(row, comparable = true) {
    const ui = webviewFunctions();
    const banner = ui.benchmarkBanner(row);
    const completion = ui.benchmarkCompletion(row);
    return { runId: row.runId, configId: row.configId, mainAgent: row.configuration?.mainAgent, modelMix: modelMixLabel(row.configuration), status: row.status,
        completion, banner, score: ui.benchmarkScoreLabel(row), comparable };
}

function scoreboardLine(s) {
    const b = s.banner;
    const cache = b.cacheInput > 0 ? `${Math.round(b.lastCached / b.cacheInput * 100)}%` : '–';
    return `SCOREBOARD ${s.mainAgent} config=${String(s.configId).slice(0, 12)} models=${s.modelMix} status=${s.status} completion=${s.completion.accepted}/${s.completion.total}` +
        ` score=${s.score} cost=$${b.dollars === null ? 'unavailable' : b.dollars.toFixed(4)} requests=${b.requests} input=${b.cacheInput} output=${b.turnOut}` +
        ` cache=${cache} mainContext=${b.averagePrompt}${s.comparable ? '' : ' not-comparable'}`;
}

/** Rows of the store, optionally filtered by version prefix, each flagged against the reference version and pricing basis. */
function scoreboard(rows, { version, referenceVersion, pricingBasis } = {}) {
    const ui = webviewFunctions();
    const selected = version ? rows.filter((r) => String(r.benchmarkVersion).startsWith(version)) : rows;
    const comparable = ui.benchmarkComparable(selected, referenceVersion || version, pricingBasis);
    return selected.map((row, i) => scoreboardRow(row, comparable[i]));
}

module.exports = { webviewFunctions, readRows, scoreboardRow, scoreboardLine, scoreboard, modelMixLabel };
