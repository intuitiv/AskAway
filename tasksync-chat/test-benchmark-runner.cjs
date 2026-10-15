// EV-BENCHMARK-RUNNER: spec 008 T001, T005-T010. Drives the benchmark CLI and runner from outside with a fake
// OpenCode spawner: zero provider requests, results go to a fixture store under build/, never ~/.askaway.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sumUsage } = require('./evals/benchmark/usage.cjs');
const { runBenchmark, filesUnder } = require('./evals/benchmark/runner.cjs');

const BENCH = path.join(__dirname, 'evals', 'benchmark');
const WORK = path.join(__dirname, 'build', 'benchmark-runner-test');
const RESULTS = path.join(WORK, 'results.jsonl');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const realStore = path.join(os.homedir(), '.askaway', 'evals', 'results.jsonl');
const realStoreSize = fs.existsSync(realStore) ? fs.statSync(realStore).size : -1;

(async () => {
    // T001: dry listing through the CLI, with a PATH whose `opencode` would leave a marker if anything spawned it.
    const bin = path.join(WORK, 'bin');
    const marker = path.join(WORK, 'opencode-called');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'opencode'), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    const dry = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'evals', 'run-evals.cjs'), '--suite', 'benchmark'],
        { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}` } });
    assert.strictEqual(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^BENCHMARK harness-benchmark version=[0-9a-f]{12} levels=simple,medium,complex,batch tasks=23 configs=orchestrator,build cap=\$2\/config total=\$5 /m);
    assert.ok(!fs.existsSync(marker), 'dry run spawned nothing');
    const bad = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'evals', 'run-evals.cjs'), '--suite', 'benchmark', '--level', 'huge'], { encoding: 'utf8' });
    assert.notStrictEqual(bad.status, 0, 'invalid level is an error');

    // T005: whole-harness usage from recorded events (main + 2 workers + a failed retry).
    const events = fs.readFileSync(path.join(BENCH, 'events', 'main-2-workers-retry.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const usage = sumUsage(events);
    assert.deepStrictEqual({ ...usage, dollars: Number(usage.dollars.toFixed(6)), workers: { ...usage.workers, dollars: Number(usage.workers.dollars.toFixed(6)) } }, {
        requests: 6, toolCalls: 4, input: 5000, output: 850, reasoning: 70, cacheRead: 37000, cacheWrite: 1500, dollars: 0.5,
        mainAveragePrompt: 15500, workers: { workers: 2, requests: 4, dollars: 0.2 } });
    const noCost = sumUsage([...events, { type: 'step_finish', sessionID: 'ses_worker_b', part: { tokens: { input: 10 } } }]);
    assert.strictEqual(noCost.dollars, null, 'missing cost is unavailable, never 0');
    assert.strictEqual(noCost.workers.dollars, null);

    // Fake OpenCode: records what it received and the start tree; a script decides edits and events per call.
    const calls = [];
    const treeOf = (dir) => crypto.createHash('sha256').update(filesUnder(dir).filter((f) => !f.startsWith('.git')).map((f) => `${f}\0${fs.readFileSync(path.join(dir, f))}`).join('\0')).digest('hex');
    const step = (cost, sessionID = 'ses_main') => ({ type: 'step_finish', sessionID, part: { cost, tokens: { input: 100, output: 10, cache: { read: 900 } } } });
    function fakeSpawner(script) {
        return (opts) => {
            const call = { ...opts, tree: treeOf(opts.dir), hasHidden: fs.existsSync(path.join(opts.dir, 'hidden')) || fs.existsSync(path.join(opts.dir, 'solutions')), killed: false, consumed: 0 };
            calls.push(call);
            const list = script(opts, calls.length);
            return {
                events: (async function* gen() { for (const e of list) { if (call.killed) { return; } call.consumed++; yield e; } })(),
                kill() { call.killed = true; },
            };
        };
    }
    const cfg = (mainAgent, model = 'fake/sonnet') => ({ mainAgent, agent: `aa-${mainAgent}`, promptHash: `hash-${mainAgent}`, harness: 'opencode', model, workers: { build: 'fake/worker' } });

    // T006-T008: two configurations, identical start trees, nothing carried over, hidden checks decide acceptance.
    const visibleOnlyHack = 'module.exports = { percent: (part, total) => (part === 1 && total === 4 ? 25 : part / total) };\n';
    const first = await runBenchmark({ configs: [cfg('build'), cfg('orchestrator')], levels: ['simple'], workRoot: path.join(WORK, 'work'), resultsFile: RESULTS, log: () => {},
        modelAvailable: () => true,
        spawner: fakeSpawner((opts, n) => {
            if (n === 1) { fs.writeFileSync(path.join(opts.dir, 'src', 'math.js'), visibleOnlyHack); fs.writeFileSync(path.join(opts.dir, 'NOTE.txt'), 'run 1'); }
            return [step(0.01), { type: 'text', sessionID: 'ses_main', part: { text: 'All visible tests pass.\nResult: PASS' } }];
        }) });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].tree, calls[1].tree, 'both configurations start from byte-identical trees');
    assert.ok(!fs.existsSync(path.join(calls[1].dir, 'NOTE.txt')) && calls[0].dir !== calls[1].dir, 'run 1 edits are absent in run 2');
    assert.ok(calls.every((c) => !c.hasHidden), 'agent workspace never holds hidden checks');
    assert.ok(fs.existsSync(path.join(calls[0].dir, '..')) && !fs.existsSync(calls[0].dir), 'run workspace removed after grading');
    assert.deepStrictEqual([calls[0].agent, calls[0].model, calls[1].agent], ['aa-build', 'fake/sonnet', 'aa-orchestrator']);
    assert.match(calls[0].prompt, /percent\(part, total\) in src\/math\.js/);
    const [buildRow, orchRow] = first.rows;
    assert.notStrictEqual(buildRow.configId, orchRow.configId);
    assert.deepStrictEqual(buildRow.configuration, { mainAgent: 'build', promptHash: 'hash-build', harness: 'opencode', modelMix: { main: 'fake/sonnet', workers: { build: 'fake/worker' } } });
    assert.deepStrictEqual(buildRow.tasks.map((t) => [t.id, t.outcome]), [['simple-1', 'failed']], 'agent "Result: PASS" is ignored');
    assert.ok(buildRow.tasks[0].failedChecks.includes('percent(1,3) is 33'), 'failing hidden check named');
    assert.strictEqual(orchRow.tasks[0].outcome, 'failed', 'untouched seeded bug is failed');

    // T009: crossing $2 kills the run, keeps the spend, never accepts missing tasks; caps cannot be raised by callers.
    calls.length = 0;
    const lines = [];
    const capped = await runBenchmark({ configs: [cfg('build')], workRoot: path.join(WORK, 'work'), resultsFile: RESULTS, log: (l) => lines.push(l), capUsd: 100, totalCapUsd: 100,
        modelAvailable: () => true, spawner: fakeSpawner(() => [step(0.8), step(0.8, 'ses_worker'), step(0.8), step(0.8), step(0.8)]) });
    const cappedRow = capped.rows[0];
    assert.strictEqual(calls.length, 1, 'no further level spawned after the cap');
    assert.ok(calls[0].killed && calls[0].consumed === 3, `killed after the step that crossed $2 (consumed ${calls[0].consumed})`);
    assert.deepStrictEqual([cappedRow.status, cappedRow.stopReason, Number(cappedRow.usage.dollars.toFixed(2))], ['interrupted', 'spend cap $2', 2.4]);
    assert.strictEqual(cappedRow.tasks.length, 23);
    assert.ok(cappedRow.tasks.every((t) => t.outcome === 'interrupted'), 'missing tasks are not accepted');
    assert.match(lines[0], /^BENCHMARK [0-9a-f]{12} config=[0-9a-f]{12} status=interrupted accepted=0\/23 cost=\$2\.4000 score=incomplete 0\/23$/);

    // T009: the $5 total cap across configurations, and an unavailable model is skipped without spawning.
    calls.length = 0;
    const total = await runBenchmark({ configs: [cfg('build', 'fake/missing'), cfg('build'), cfg('orchestrator'), cfg('build', 'fake/other'), cfg('orchestrator', 'fake/other')],
        levels: ['simple'], workRoot: path.join(WORK, 'work'), resultsFile: RESULTS, log: () => {},
        modelAvailable: (m) => m !== 'fake/missing', spawner: fakeSpawner(() => [step(1), step(1), step(1)]) });
    assert.deepStrictEqual(total.rows.map((r) => [r.status, r.stopReason]), [
        ['skipped', 'model unavailable'], ['interrupted', 'spend cap $2'], ['interrupted', 'spend cap $2'], ['interrupted', 'total spend cap $5'], ['skipped', 'total spend cap $5']]);
    assert.strictEqual(calls.length, 3, 'skipped configurations never spawn');
    assert.strictEqual(total.spent, 5, 'stopped at $5 total');
    assert.deepStrictEqual(total.rows[0].tasks.map((t) => t.outcome), ['skipped']);

    // T010: repeats add rows with distinct runId and the same configId and benchmarkVersion; no prompt or transcript text.
    const repeat = await runBenchmark({ configs: [cfg('build')], levels: ['simple'], repeat: 2, workRoot: path.join(WORK, 'work'), resultsFile: RESULTS, log: () => {},
        modelAvailable: () => true, spawner: fakeSpawner(() => [step(0.01), { type: 'text', sessionID: 'ses_main', part: { text: 'TRANSCRIPT-SENTINEL Result: PASS' } }]) });
    const [r1, r2] = repeat.rows;
    assert.notStrictEqual(r1.runId, r2.runId);
    assert.deepStrictEqual([r1.configId, r1.benchmarkVersion], [r2.configId, r2.benchmarkVersion]);
    const stored = fs.readFileSync(RESULTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(stored.length, 2 + 1 + 5 + 2, 'every run appended one row');
    assert.ok(stored.every((row) => row.suite === 'benchmark' && row.pricingBasis === 'opencode step_finish cost'));
    assert.deepStrictEqual(Object.keys(stored[0]), ['suite', 'runId', 'benchmarkVersion', 'pricingBasis', 'configId', 'configuration', 'startedAt', 'status', 'stopReason', 'tasks', 'usage']);
    const text = fs.readFileSync(RESULTS, 'utf8');
    assert.ok(!text.includes('TRANSCRIPT-SENTINEL') && !text.includes('Result: PASS') && !text.includes('src/math.js must'), 'rows hold no prompt or transcript text');
    assert.strictEqual(fs.existsSync(realStore) ? fs.statSync(realStore).size : -1, realStoreSize, 'real results store untouched');

    fs.rmSync(WORK, { recursive: true, force: true });
    console.log('EV-BENCHMARK-RUNNER: PASS dry-listing usage isolation identity hidden-grading caps($2/config,$5/total) rows');
})().catch((error) => { console.error(error); process.exit(1); });
