// EV-BENCHMARK-SCOREBOARD: spec 008 T012-T014 (+ orchestrator profile). The scoreboard's Score is the live banner's
// efficiencyScore for the same input, totals reconcile with every recorded step (workers and failed retry included),
// the CLI flags unlike runs, and the Workers tab Benchmark section contains the exact usageBannerHtml(b) output.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sumUsage } = require('./evals/benchmark/usage.cjs');
const { benchmarkVersion, configuration, loadBenchmark } = require('./evals/benchmark/runner.cjs');
const { webviewFunctions, scoreboard } = require('./evals/benchmark/scoreboard.cjs');

const WORK = path.join(__dirname, 'build', 'benchmark-scoreboard-test');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const ui = webviewFunctions();

// Rows as the runner writes them, built from recorded events (main + 2 workers + a failed retry).
const eventsText = fs.readFileSync(path.join(__dirname, 'evals', 'benchmark', 'events', 'main-2-workers-retry.jsonl'), 'utf8');
const events = eventsText.trim().split('\n').map((l) => JSON.parse(l));
const usage = sumUsage(events);
const version = benchmarkVersion();
const tasks = (failed) => Array.from({ length: 23 }, (_, i) => ({ id: `t${i}`, level: 'batch', outcome: i < failed ? 'failed' : 'accepted', failedChecks: i < failed ? ['x'] : [] }));
const row = (over) => ({ suite: 'benchmark', runId: crypto.randomUUID(), benchmarkVersion: version, pricingBasis: 'opencode step_finish cost', configId: 'a'.repeat(64),
    configuration: { mainAgent: 'build', promptHash: 'p', harness: 'opencode', modelMix: { main: 'github-copilot/claude-sonnet-5.5', workers: { build: 'github-copilot/claude-sonnet-5.5' } } },
    startedAt: '2026-10-14T00:00:00Z', status: 'completed', stopReason: null, tasks: tasks(0), usage, ...over });
const single = row({});
const mixed = row({ configId: 'b'.repeat(64), tasks: tasks(1),
    configuration: { mainAgent: 'orchestrator', promptHash: 'q', harness: 'opencode', modelMix: { main: 'github-copilot/claude-sonnet-5.5', workers: { build: 'github-copilot/gpt-6.1-sol', explore: 'github-copilot/gpt-6-luna' } } } });
const older = row({ benchmarkVersion: 'f'.repeat(64) });
const noCost = row({ usage: { ...usage, dollars: null } });
const noInput = row({ usage: { ...usage, input: 0, cacheRead: 0, cacheWrite: 0 } });

// T012: same Score as the banner for the same input; totals reconcile with every recorded step.
const b = ui.benchmarkBanner(single);
const stepCost = events.filter((e) => e.type === 'step_finish').reduce((n, e) => n + e.part.cost, 0);
assert.strictEqual(b.dollars.toFixed(6), stepCost.toFixed(6), 'cost includes workers and the failed retry');
assert.strictEqual(b.requests, events.filter((e) => e.type === 'step_finish').length);
assert.deepStrictEqual([b.cacheInput, b.lastCached, b.turnOut, b.averagePrompt, b.workers.workers, b.workers.requests], [43500, 37000, 850, 15500, 2, 4]);
const expected = ui.efficiencyScore(b).value;
assert.ok(Number.isInteger(expected));
const [sSingle, sMixed, sOlder, sNoCost, sNoInput] = scoreboard([single, mixed, older, noCost, noInput], { referenceVersion: version, pricingBasis: 'opencode step_finish cost' });
assert.strictEqual(sSingle.score, String(expected), 'scoreboard Score equals efficiencyScore(b).value');
assert.strictEqual(sMixed.score, 'incomplete 22/23', 'score gated on full completion');
assert.deepStrictEqual([sNoCost.score, sNoInput.score], ['–', '–'], 'unavailable cost or input is never a number');
assert.deepStrictEqual([sSingle.comparable, sOlder.comparable], [true, false]);

// T013: CLI lines for single-model vs mixed-model rows; an older version row is flagged; zero provider requests.
const results = path.join(WORK, 'results.jsonl');
fs.writeFileSync(results, [single, mixed, older, noCost, { suite: 'workers', verdict: 'PASS' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
const cli = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'evals', 'run-evals.cjs'), '--suite', 'benchmark', '--scoreboard', '--results', results],
    { encoding: 'utf8', env: { ...process.env, PATH: path.dirname(process.execPath) } });
assert.strictEqual(cli.status, 0, cli.stderr);
const lines = cli.stdout.trim().split('\n');
assert.strictEqual(lines[0], `SCOREBOARD build config=aaaaaaaaaaaa models=github-copilot/claude-sonnet-5.5 status=completed completion=23/23 score=${expected} cost=$0.5000 requests=6 input=43500 output=850 cache=85% mainContext=15500`);
assert.strictEqual(lines[1], 'SCOREBOARD orchestrator config=bbbbbbbbbbbb models=github-copilot/claude-sonnet-5.5+workers:github-copilot/gpt-6.1-sol,github-copilot/gpt-6-luna status=completed completion=22/23 score=incomplete 22/23 cost=$0.5000 requests=6 input=43500 output=850 cache=85% mainContext=15500');
assert.match(lines[2], / not-comparable$/);
assert.match(lines[3], /score=– cost=\$unavailable /);
assert.strictEqual(lines[4], `SCOREBOARD runs=4 comparable=3 version=${version.slice(0, 12)} results=${results}`);

// T014: the Workers tab Benchmark section renders each row with the exact shared banner output plus completion.
const html = ui.renderWorkersHtml({ workers: [], server: { state: 'ATTACHED', endpoint: 'x' }, benchmark: [single, mixed, older] }, '', {}, {}, {});
for (const r of [single, mixed, older]) { assert.ok(html.includes(ui.usageBannerHtml(ui.benchmarkBanner(r))), 'exact usageBannerHtml(b) output'); }
assert.ok(html.includes('data-eid="benchmark"') && html.includes('23/23 accepted') && html.includes('22/23 accepted'));
assert.ok(html.includes('benchmark-row benchmark-incomplete') && html.includes('>incomplete 22/23<') && html.includes('>not comparable<'));
assert.strictEqual(ui.renderWorkersHtml({ workers: [], server: {} }, '', {}, {}, {}).includes('workers-benchmark'), false, 'no section without rows');
assert.strictEqual(childProcess.spawnSync(process.execPath, ['--check', path.join(__dirname, 'media', 'webview.js')]).status, 0, 'node --check media/webview.js');
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
assert.ok(provider.includes('benchmark: this._benchmarkRows()') && !/[^\r]\n/.test(provider), 'provider sends rows and keeps CRLF');

// Orchestrator profile: checked in, synced into an `aa-orchestrator` OpenCode agent, and the benchmark config points at it.
const profiles = path.join(WORK, 'profiles');
const opencode = path.join(WORK, 'opencode');
const sync = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'tools', 'sync-worker-profiles.cjs')],
    { encoding: 'utf8', env: { ...process.env, ASKAWAY_WORKER_PROFILES: profiles, OPENCODE_CONFIG_DIR: opencode, ASKAWAY_AUTHORING_SKILLS: path.join(WORK, 'no-skills') } });
assert.strictEqual(sync.status, 0, sync.stderr);
assert.match(sync.stdout, /aa-orchestrator/);
const agent = fs.readFileSync(path.join(opencode, 'agents', 'aa-orchestrator.md'), 'utf8');
assert.ok(agent.includes('mode: primary') && agent.includes('model: github-copilot/claude-sonnet-5.5') && agent.includes('"askaway_worker": allow') && agent.includes('# Orchestrator'));
const profileFile = path.join(__dirname, 'worker-profiles', 'orchestrator.md');
const orch = configuration('orchestrator', loadBenchmark().manifest);
assert.deepStrictEqual([orch.agent, orch.configuration.modelMix.main, orch.configuration.promptHash],
    ['aa-orchestrator', 'github-copilot/claude-sonnet-5.5', crypto.createHash('sha256').update(fs.readFileSync(profileFile)).digest('hex')]);

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`EV-BENCHMARK-SCOREBOARD: PASS score=${expected} (=efficiencyScore) gated=incomplete 22/23 unavailable=– cli=4 rows flagged=1 ui=usageBannerHtml agent=aa-orchestrator`);
