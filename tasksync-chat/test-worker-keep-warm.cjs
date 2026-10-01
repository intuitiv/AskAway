// EV-KEEP-WARM (spec 005 T018): while the main chat is active, an idle warm worker whose prompt cache expires within ~60s gets ONE
// minimal `POST /session/:id/message` ping; its step_finish usage is a ledger checkpoint tagged `ping: true` and counts in worker
// spend. Stops at 300K context or after 2 unused pings; never pings a busy, queued, retired or expired worker.
// Driven through the real runtime (fake spawner, fake session HTTP endpoint). Fixtures live under the repo. Run: node test-worker-keep-warm.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-keep-warm-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'keepWarm']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { workersToPing, keepWarmTick, startKeepWarmTimer, KEEP_WARM_PROMPT } = require(path.join(buildDir, 'keepWarm.js'));

const fixtureDir = path.join(__dirname, '.worker-keep-warm-test-fixture');
fs.rmSync(fixtureDir, { recursive: true, force: true });
const ledgerDir = path.join(fixtureDir, 'ledger');
const workspace = path.join(fixtureDir, 'ws');
fs.mkdirSync(workspace, { recursive: true });

const profile = parseWorkerProfile('---\nname: verify\ndescription: "v"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n');
const packet = { workspacePath: workspace, profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const emit = async (child, event) => { child.stdout.write(`${JSON.stringify(event)}\n`); await tick(); };

// 1) Pure decision logic.
const base = { workerId: 'w', state: 'IDLE', active: false, queued: 0, cacheExpiresAt: 1_050_000, nextInputTokens: 1000, unusedPings: 0 };
const now = 1_000_000;
const decide = (patch, mainActiveAt = now - 10_000) => workersToPing([{ ...base, ...patch }], now, mainActiveAt);
assert.deepEqual(decide({}), ['w'], 'idle, cache expiring in 50s, main chat active: ping');
assert.deepEqual(decide({ cacheExpiresAt: now + 61_000 }), [], 'more than ~60s left: not yet');
assert.deepEqual(decide({ cacheExpiresAt: now }), [], 'expired: never');
assert.deepEqual(decide({ cacheExpiresAt: 0 }), [], 'never reusable (running/retired): never');
assert.deepEqual(decide({ active: true, state: 'RUNNING' }), [], 'busy: never');
assert.deepEqual(decide({ queued: 1 }), [], 'queued: never');
assert.deepEqual(decide({ state: 'RETIRED' }), [], 'retired: never');
assert.deepEqual(decide({ state: 'ORPHANED' }), [], 'orphaned: never');
assert.deepEqual(decide({ pinging: true }), [], 'ping already in flight');
assert.deepEqual(decide({ nextInputTokens: 300_000 }), [], 'stop at 300K context');
assert.deepEqual(decide({ nextInputTokens: 299_999 }), ['w'], 'just under 300K still pings');
assert.deepEqual(decide({ unusedPings: 1 }), ['w'], 'one unused ping: one more allowed');
assert.deepEqual(decide({ unusedPings: 2 }), [], 'stop after 2 consecutive unused pings');
assert.deepEqual(decide({}, 0), [], 'main chat never active: no ping');
assert.deepEqual(decide({}, now - 301_000), [], 'main chat idle for over 5 minutes: no ping');

(async () => {
    // 2) Wiring through the real runtime against a fake OpenCode session endpoint.
    const requests = [];
    let failNext = false;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
            if (failNext) { res.statusCode = 500; res.end('boom'); return; }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }, { type: 'step-finish', id: 'prt_ping', cost: 0.0001, tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 1000, write: 0 } } }] }));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    let clock = 1_000_000;
    const children = [];
    const makeRuntime = () => new OpenCodeWorkerRuntime([profile], { ledgerDir, now: () => clock, attachUrl: url, spawner: (args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new PassThrough();
        child.kill = () => true;
        children.push(child);
        return child;
    } });
    const runtime = makeRuntime();
    const finishRun = async (child) => {
        await emit(child, { type: 'step_finish', sessionID: 'ses_W1', part: { id: 'prt_real', tokens: { input: 1000, output: 50 }, cost: 0.001 } });
        await emit(child, { type: 'text', sessionID: 'ses_W1', part: { type: 'text', text: 'Result: PASS\nEvidence: ok\nKnowledge: k' } });
        child.emit('exit', 0, null);
        await tick();
    };

    const started = runtime.start(packet);
    await finishRun(children[0]);
    const workerId = started.workerId;
    const pings = () => requests.filter((request) => request.method === 'POST');
    const mainActive = () => clock - 5_000;

    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'cache is fresh (300s left): no ping yet');
    clock += 250_000; // cache expires in 50s
    assert.deepEqual(await keepWarmTick(runtime, workspace, 0), [], 'main chat not active: no ping');
    assert.deepEqual(await keepWarmTick(runtime, workspace, clock - 301_000), [], 'main chat idle past 5 minutes: no ping');
    assert.equal(pings().length, 0);

    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'ping #1');
    assert.equal(pings().length, 1, 'exactly ONE message');
    assert.equal(pings()[0].url, '/session/ses_W1/message');
    assert.equal(pings()[0].body.agent, 'aa-verify', 'same agent');
    assert.deepEqual(pings()[0].body.model, { providerID: 'github-copilot', modelID: 'gpt-5.6-luna' }, 'same model');
    assert.equal(pings()[0].body.variant, 'low', 'same thinking variant');
    assert.deepEqual(pings()[0].body.parts, [{ type: 'text', text: KEEP_WARM_PROMPT }], 'one minimal one-line prompt');
    assert.match(KEEP_WARM_PROMPT, /^ping, reply ok$/);

    const pingFacts = () => runtime.facts(workspace).filter((record) => record.ping === true);
    assert.equal(pingFacts().length, 1, 'the ping is a ledger checkpoint tagged ping:true');
    assert.equal(pingFacts()[0].type, 'checkpoint');
    assert.deepEqual([pingFacts()[0].usage.cacheRead, pingFacts()[0].usage.cost], [1000, 0.0001], "the ping's step_finish usage is recorded");
    const spend = runtime.usageSince(workspace, 0);
    assert.equal(spend.requests, 2, 'worker spend counts the real step plus the ping');
    assert.ok(Math.abs(spend.dollars - 0.0011) < 1e-9, 'ping cost is part of worker spend');

    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'the ping restarted the cache clock: nothing to do for another ~4 min');
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'ping #2 (first one was unused, one more allowed)');
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'stop after 2 consecutive unused pings');
    assert.equal(pings().length, 2);

    // A real run resets the count; the worker is still reusable because the pings kept it warm.
    const submitted = runtime.submit(workerId, packet);
    assert.equal(submitted.workerId, workerId, 'the kept-warm worker is reused');
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'a busy worker is never pinged');
    await finishRun(children[1]);
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'after a real run, pinging resumes');

    // A failed ping is not recorded and does not extend the cache clock.
    clock += 250_000;
    failNext = true;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'HTTP 500: nothing pinged');
    failNext = false;
    assert.equal(pingFacts().length, 3, 'the failed ping left no ledger fact');

    // Restoring after a reload still sees the run as finished, not interrupted by the ping facts.
    const restored = makeRuntime();
    restored.rehydrate(workspace, true);
    assert.ok(restored.list(workspace).every((run) => run.state === 'COMPLETED'), 'ping checkpoints do not make a finished run look interrupted');

    // 3) Timer wiring and the setting: the worker's cache expires in 50s, the main chat is active.
    let enabled = false;
    const before = pings().length;
    const stop = startKeepWarmTimer(() => runtime, workspace, { enabled: () => enabled, mainActiveAt: (t) => t - 1000, intervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(pings().length, before, 'setting off: the timer never pings');
    enabled = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(pings().length, before + 1, 'setting on: the timer sends exactly one ping, then the refreshed clock holds it back');
    stop();

    server.close();
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });

    // 4) Setting is declared, default on, and the test is in the gate.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const setting = pkg.contributes.configuration.properties['askaway.workers.keepWarm'];
    assert.equal(setting.type, 'boolean');
    assert.equal(setting.default, true);
    assert.match(pkg.scripts['test:workers'], /test-worker-keep-warm\.cjs/);
    console.log('EV-KEEP-WARM: PASS');
})().catch((error) => { console.error(error); process.exit(1); });
