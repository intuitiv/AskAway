#!/usr/bin/env node
// Simulate command-collapsing options on real main-agent bursts (parser reused from command-patterns.cjs).
// Usage: node tools/command-options.cjs <main.jsonl>...
const path = require('node:path');

const GIT_READ = /^git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame|remote|stash\s+list)\b/;
const READ_RE = /^(rg|grep|ls|cat|find|head|tail)\b/;
const bare = (c) => String(c).trim().replace(/^rtk\s+/, '');

function classify(commands) {
    const cs = commands.map(bare);
    if (cs.some((c) => /\bgit\s+commit\b/.test(c))) { return 'git-commit'; }
    if (cs.every((c) => GIT_READ.test(c))) { return 'git-read'; }
    if (cs.every((c) => READ_RE.test(c))) { return 'read'; }
    if (cs.every((c) => /^(npm|node|npx|cp|opencode|\.\/|bash|sh)\b/.test(c))) { return 'scripts/run'; }
    return 'mixed';
}

// Hand-judged verdicts for mixed bursts, keyed `<log file>#<burst index within that file>`.
// true = fixed sequence, no later command depends on an earlier command's output.
const INDEPENDENT = {
    'cae7c694.jsonl#0': true, // git diff --stat ; git diff -- service/
    'cae7c694.jsonl#3': false, // ledger row numbers chosen from the tail output
    'e35d8a0f.jsonl#0': true, // run check script ; grep its log ; grep its log
    'e35d8a0f.jsonl#3': true, // start e2e ; timing ; diff ; check ; grep log (fixed pipeline)
    'dd2564a6.jsonl#0': false, // second command is a retry of the first
    'dd2564a6.jsonl#1': false, // pid 8694 comes from earlier output
    'dd2564a6.jsonl#2': true, // curl before.prom ; grep it
    'dd2564a6.jsonl#3': false, // retries/variants of promdiff after failures
    'dd2564a6.jsonl#4': false, // exploratory log digging, each probe reacts to the last
    'dd2564a6.jsonl#5': false, // narrowing grep search
    'dd2564a6.jsonl#7': false, // jar/pid investigation follows findings
    'dd2564a6.jsonl#8': true, // same probe script, two fixed args
    'dd2564a6.jsonl#10': false, // test file path comes from git log/grep output
    'dd2564a6.jsonl#13': false, // grep pattern refined after seeing output
    'dd2564a6.jsonl#15': true, // grep results ; curl after ; restart mesh
    'cbac1c6c.jsonl#2': false, // diff paths chosen from --stat
    'cbac1c6c.jsonl#5': false, // path comes from ls -t output
    'cbac1c6c.jsonl#6': true, // test ; gen manifest ; test ; echo exit
    'cbac1c6c.jsonl#7': false, // file names come from ls
};

const WORKER_GIT = 0.004;
const WORKER_EXPLORE = 0.01;
const OPTIONS = {
    A: { name: 'status quo', covers: () => false, saved: () => 0, worker: 0 },
    B: { name: 'checkpoint (git-commit -> 1 call)', covers: (b) => b.cls === 'git-commit', saved: (b) => b.requestsBetween, worker: 0 },
    C: { name: 'batch runner (read, git-read -> 1 call)', covers: (b) => b.cls === 'read' || b.cls === 'git-read', saved: (b) => b.requestsBetween, worker: 0 },
    D: { name: 'Luna git worker (2 main reqs)', covers: (b) => (b.cls === 'git-commit' || b.cls === 'git-read') && b.requestsBetween > 2, saved: (b) => b.requestsBetween - 2, worker: WORKER_GIT },
    E: { name: 'Luna explore worker, read (2 main reqs)', covers: (b) => b.cls === 'read' && b.requestsBetween > 2, saved: (b) => b.requestsBetween - 2, worker: WORKER_EXPLORE },
    F: { name: 'B + C', covers: (b) => ['git-commit', 'read', 'git-read'].includes(b.cls), saved: (b) => b.requestsBetween, worker: 0 },
    G: { name: 'F + all mixed (upper bound)', covers: (b) => b.cls !== 'scripts/run', saved: (b) => b.requestsBetween, worker: 0 },
    H: { name: 'F + independent mixed only', covers: (b) => ['git-commit', 'read', 'git-read'].includes(b.cls) || (b.cls === 'mixed' && INDEPENDENT[`${b.file}#${b.idx}`] === true), saved: (b) => b.requestsBetween, worker: 0 },
};

function loadBursts(files) {
    // command-patterns.cjs runs main() on load and has no exports: feed it --json and capture stdout.
    const realLog = console.log;
    const realArgv = process.argv;
    let captured = '';
    process.argv = [realArgv[0], realArgv[1], '--json', ...files];
    console.log = (s) => { captured += s; };
    try { require('./command-patterns.cjs'); } finally { console.log = realLog; process.argv = realArgv; }
    const report = JSON.parse(captured);
    return report.files.flatMap((f) => f.bursts.map((b, i) => ({ ...b, file: path.basename(f.file), idx: i, cls: classify(b.commands) })));
}

function main(args) {
    const list = args.includes('--list-mixed');
    const files = args.filter((a) => a !== '--list-mixed');
    if (files.length === 0) { console.error('usage: command-options.cjs [--list-mixed] <main.jsonl>...'); process.exit(2); }
    const bursts = loadBursts(files);
    if (list) {
        for (const b of bursts.filter((x) => x.cls === 'mixed')) {
            console.log(`${b.file}#${b.idx} [${INDEPENDENT[`${b.file}#${b.idx}`] === undefined ? '?' : INDEPENDENT[`${b.file}#${b.idx}`] ? 'independent' : 'dependent'}] reqs=${b.requestsBetween}`);
            for (const c of b.commands) { console.log(`    ${c.replace(/\s+/g, ' ').slice(0, 200)}`); }
        }
        return;
    }
    const classes = {};
    for (const b of bursts) {
        const c = classes[b.cls] || (classes[b.cls] = { count: 0, commands: 0, requests: 0, aiu: 0 });
        c.count++; c.commands += b.length; c.requests += b.requestsBetween; c.aiu += b.aiuBetween;
    }
    const pad = (s, n) => String(s).padEnd(n);
    const row = (cells, widths) => cells.map((s, i) => pad(s, widths[i])).join('');
    console.log(`bursts: ${bursts.length} from ${files.length} logs`);
    const cw = [14, 13, 13, 14, 13];
    console.log(row(['class', 'bursts', 'commands', 'reqs between', 'AIU between'], cw));
    for (const [k, c] of Object.entries(classes).sort()) {
        console.log(row([k, c.count, c.commands, c.requests, c.aiu.toFixed(2)], cw));
    }
    console.log('');
    const ow = [5, 42, 9, 12, 11, 10, 8];
    console.log(row(['opt', 'name', 'covered', 'reqs saved', 'AIU saved', 'worker $', 'net $'], ow));
    for (const [key, o] of Object.entries(OPTIONS)) {
        let covered = 0, reqs = 0, aiu = 0;
        for (const b of bursts) {
            if (!o.covers(b)) { continue; }
            const saved = o.saved(b);
            covered++; reqs += saved;
            aiu += b.requestsBetween ? (b.aiuBetween / b.requestsBetween) * saved : 0;
        }
        const worker = covered * o.worker;
        console.log(row([key, o.name, covered, reqs, aiu.toFixed(2), worker.toFixed(3), (aiu / 100 - worker).toFixed(3)], ow));
    }
    console.log('(AIU/100 = $; saved reqs priced at each burst\'s avg AIU per in-between request; worker options only applied where they save >0 requests)');
}

main(process.argv.slice(2));
