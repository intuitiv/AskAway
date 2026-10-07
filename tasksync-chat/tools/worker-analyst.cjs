#!/usr/bin/env node
// On-request worker analyst: copies ledgers and writes a report for review; never applies findings.
// Ledger facts: start | checkpoint{usage per step} | stop{state} | error{state,reason} | message_update | archive | fork.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, '.askaway', 'analyst');
const IDLE_MS = 5 * 60e3, REUSE_MS = 30 * 60e3, REUSE_CTX = 200e3;
const BUCKETS = [['<30K', 30e3], ['30-100K', 100e3], ['100-200K', 200e3], ['200-300K', 300e3], ['>300K', Infinity]];

const parseLines = (lines) => (typeof lines === 'string' ? lines.split('\n') : lines).flatMap((line) => {
    try { const r = JSON.parse(line); return r && r.workerId ? [r] : []; } catch { return []; }
}).sort((a, b) => a.ts - b.ts);

/** Folds records into runs {runId, workerId, profile, model, start, end, state, steps[], cost, report}. */
function buildRuns(records) {
    const runs = new Map();
    for (const r of records) {
        if (!r.runId) { continue; }
        let run = runs.get(r.runId);
        if (!run) { run = { runId: r.runId, workerId: r.workerId, profile: r.profile || '?', model: r.model || '?', start: r.ts, end: r.ts, state: null, steps: [], cost: 0, msg: false }; runs.set(r.runId, run); }
        run.end = Math.max(run.end, r.ts);
        if (r.type === 'checkpoint' && r.usage) {
            const u = r.usage;
            run.steps.push({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...u, ctx: (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) });
            run.cost += u.cost || 0;
        } else if (r.type === 'stop') { run.state = r.state || 'COMPLETED'; }
        else if (r.type === 'error') { run.state = r.state || 'FAILED'; }
        else if (r.type === 'message_update') { run.msg = true; }
    }
    return [...runs.values()];
}

function buildWorkers(records, runs, lastTs = records.at(-1)?.ts || 0) {
    const archived = new Set(records.filter((r) => r.type === 'archive').map((r) => r.workerId));
    const workers = new Map();
    for (const run of runs) {
        const w = workers.get(run.workerId) || { id: run.workerId, profile: run.profile, model: run.model, runs: [], first: run.start };
        w.runs.push(run); workers.set(run.workerId, w);
    }
    for (const w of workers.values()) {
        w.runs.sort((a, b) => a.start - b.start);
        const last = w.runs[w.runs.length - 1];
        w.last = last.end;
        w.ctx = w.runs.flatMap((r) => r.steps).pop()?.ctx || 0;
        w.active = !last.state;
        w.ended = archived.has(w.id) ? 'archived'
            : last.state === 'FAILED' || last.state === 'CANCELLED' ? 'retired'
            : !w.active && lastTs - w.last >= IDLE_MS ? 'expired idle >5min' : 'still live';
    }
    return [...workers.values()];
}

/** Fresh starts where a same profile+model worker was idle, <200K, and used within 30 min. */
function missedReuse(workers) {
    let count = 0, dollars = 0;
    for (const w of workers) {
        const run = w.runs[0], first = run.steps[0];
        const idle = workers.some((o) => o !== w && o.profile === w.profile && o.model === w.model && o.first < w.first
            && o.runs.every((r) => r.end <= w.first && r.state) && o.runs.some((r) => r.end <= w.first)
            && (ctxBefore(o, w.first)) < REUSE_CTX && w.first - lastEndBefore(o, w.first) <= REUSE_MS);
        if (!idle) { continue; }
        count++;
        if (first) {
            const total = first.input + first.cacheRead + first.cacheWrite + first.output;
            dollars += total ? first.cost * first.cacheWrite / total : 0;
        }
    }
    return { count, dollars };
}
const ranBefore = (o, ts) => o.runs.filter((r) => r.end <= ts);
const lastEndBefore = (o, ts) => Math.max(...ranBefore(o, ts).map((r) => r.end));
const ctxBefore = (o, ts) => ranBefore(o, ts).flatMap((r) => r.steps).pop()?.ctx || 0;

function efficiency(runs, key) {
    const groups = {};
    for (const run of runs) { (groups[key ? run[key] : 'Overall'] ||= []).push(run); }
    return Object.entries(groups).map(([name, rs]) => {
        const s = rs.flatMap((r) => r.steps), sum = (f) => s.reduce((a, x) => a + f(x), 0);
        const cost = rs.reduce((a, r) => a + r.cost, 0), input = sum((x) => x.ctx);
        const done = rs.filter((r) => r.state === 'COMPLETED'), reported = done.filter((r) => r.msg);
        return { name, runs: rs.length, steps: s.length, cost, input, perDollar: cost ? s.length / cost : 0,
            tokPerDollar: cost ? (input + sum((x) => x.output)) / cost : 0, outPerDollar: cost ? sum((x) => x.output) / cost : 0,
            promptPerOutput: sum((x) => x.output) ? input / sum((x) => x.output) : 0,
            stepsPerDone: done.length ? s.length / done.length : 0,
            hit: input ? 100 * sum((x) => x.cacheRead) / input : 0,
            perDone: done.length ? cost / done.length : 0, perReport: reported.length ? cost / reported.length : 0 };
    }).sort((a, b) => b.cost - a.cost);
}

const $ = (n) => '$' + n.toFixed(2);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const histogram = (workers) => BUCKETS.map(([label, max], i) =>
    [label, workers.filter((w) => w.ctx < max && w.ctx >= (i ? BUCKETS[i - 1][1] : 0)).length]);

function keepWarm(records, workers) {
    const pinged = new Set(), hits = new Set(), pending = new Map();
    let pings = 0, cost = 0;
    for (const r of records) {
        const until = pending.get(r.workerId);
        if (until !== undefined && r.ts >= until) { pending.delete(r.workerId); }
        if (r.ping === true) {
            pings++; cost += r.usage?.cost || 0; pinged.add(r.workerId);
            pending.set(r.workerId, r.ts + IDLE_MS);
        } else if (r.type === 'start' && pending.has(r.workerId)) {
            hits.add(r.workerId); pending.delete(r.workerId);
        } else if (r.type === 'archive' || r.type === 'error' || (r.type === 'stop' && ['FAILED', 'CANCELLED'].includes(r.state))) {
            pending.delete(r.workerId);
        }
    }
    return { pings, cost, pinged: pinged.size, hits: hits.size,
        rate: pinged.size ? 100 * hits.size / pinged.size : 0,
        noPing: workers.filter((w) => w.ended === 'expired idle >5min' && !pinged.has(w.id)).length };
}

function section(runs, workers, records) {
    const out = [];
    const ends = {}; workers.forEach((w) => { ends[w.ended] = (ends[w.ended] || 0) + 1; });
    out.push('#### 1. Worker end-of-life', `Workers: ${workers.length}; ended: ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
        table(['context at end', 'workers'], histogram(workers)));
    const multi = workers.filter((w) => w.runs.length > 1).sort((a, b) => b.runs.length - a.runs.length).slice(0, 5);
    if (multi.length) {
        out.push('Most-reused workers:', table(['workerId', 'runs', 'last ctx', 'ended'], multi.map((w) => [w.id, w.runs.length, Math.round(w.ctx), w.ended])));
    }
    const m = missedReuse(workers);
    out.push('#### 2. Missed reuse', `Fresh starts with a reusable idle sibling (same profile+model, <200K, within 30 min): **${m.count}** of ${workers.length}; est. avoidable first-step cache-write cost ${$(m.dollars)}`);
    for (const key of ['model', 'profile']) {
        out.push(`#### 3. Efficiency by ${key}`, table([key, 'runs', 'steps', '$', 'req/$', 'tok/$', 'out tok/$', 'cache hit %', '$/completed', '$/reported'],
            efficiency(runs, key).map((e) => [e.name, e.runs, e.steps, $(e.cost), e.perDollar.toFixed(0), e.tokPerDollar.toFixed(0), e.outPerDollar.toFixed(0), e.hit.toFixed(1), $(e.perDone), $(e.perReport)])));
    }
    const top = [...runs].sort((a, b) => b.cost - a.cost).slice(0, 5);
    out.push('#### 4. Top 5 most expensive runs', table(['runId', 'worker', 'profile', 'model', '$', 'steps', 'peak ctx'],
        top.map((r) => [r.runId, r.workerId, r.profile, r.model, $(r.cost), r.steps.length, Math.max(0, ...r.steps.map((s) => s.ctx))])));
    const p = keepWarm(records, workers);
    out.push('#### 5. Keep-warm pings', `Pings: ${p.pings}; spent: ${$(p.cost)}; pinged workers: ${p.pinged}; hits: ${p.hits}; HIT RATE: ${p.rate.toFixed(1)}% (${p.hits}/${p.pinged}); expired with no ping: ${p.noPing}`,
        'A hit is a later real run start before the ping-refreshed five-minute cache expires. Expiry is evaluated at the latest ledger timestamp.');
    out.push('#### 6. Harness ratios', 'All checkpoints, including pings: prompt tokens = input + cacheRead + cacheWrite; steps per completed run = all steps / completed runs; cache-hit % = cacheRead / prompt tokens. Zero denominators report 0.');
    for (const key of ['model', 'profile', null]) {
        out.push(table([key || 'overall', 'prompt tokens/output token', 'steps/completed run', 'cache-hit %'],
            efficiency(runs, key).map((e) => [e.name, e.promptPerOutput.toFixed(2), e.stepsPerDone.toFixed(2), e.hit.toFixed(1)])));
    }
    return out.join('\n\n');
}

function analyse(lines) {
    const records = parseLines(lines), runs = buildRuns(records), workers = buildWorkers(records, runs);
    return section(runs, workers, records);
}

function main(args) {
    let from = path.join(os.homedir(), '.askaway', 'worker-ledger'), copy = true;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--no-copy') { copy = false; }
        else if (args[i] === '--from' && args[i + 1] && !args[i + 1].startsWith('--')) { from = args[++i]; }
        else { throw new Error('Usage: worker-analyst.cjs [--from <dir>] [--no-copy]'); }
    }
    const dir = path.join(DIR, 'ledgers');
    fs.mkdirSync(dir, { recursive: true });
    if (copy) {
        for (const f of fs.readdirSync(from).filter((f) => f.endsWith('.jsonl')).sort()) {
            const source = path.resolve(from, f), target = path.join(dir, f);
            if (source !== target) { fs.copyFileSync(source, target); }
        }
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    const ledgers = files.map((f) => ({ name: f, records: parseLines(fs.readFileSync(path.join(dir, f), 'utf8')) }));
    const all = ledgers.flatMap((l) => l.records).sort((a, b) => a.ts - b.ts);
    const lastTs = all.at(-1)?.ts || 0;
    const runs = buildRuns(all), workers = buildWorkers(all, runs, lastTs);
    const md = ['# Worker cost analysis', `Ledgers: ${files.length}`, 'Findings are for review only; no changes are applied.', '## Overall', section(runs, workers, all)];
    for (const l of ledgers) {
        const rs = buildRuns(l.records);
        md.push(`## ${l.name}`, section(rs, buildWorkers(l.records, rs, lastTs), l.records));
    }
    fs.writeFileSync(path.join(DIR, 'report.md'), md.join('\n\n') + '\n');
    console.log(`OVERALL: ${workers.length} workers, ${runs.length} runs, ${$(runs.reduce((a, r) => a + r.cost, 0))}\nreport: ${path.join(DIR, 'report.md')}`);
}

module.exports = { analyse };
if (require.main === module) { main(process.argv.slice(2)); }
