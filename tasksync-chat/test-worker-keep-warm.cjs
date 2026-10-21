// EV-KEEP-WARM (spec 005 T018): while the main chat is active, an idle warm worker whose prompt cache expires within ~60s gets ONE
// minimal `POST /session/:id/message` ping; its step_finish usage is a ledger checkpoint tagged `ping: true` and counts in worker
// spend. Stops at 300K context or after 4 unused pings; never pings a busy, queued, retired or expired worker.
// Driven through the real runtime (fake spawner, fake session HTTP endpoint). Fixtures live under the repo. Run: node test-worker-keep-warm.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { transpileSrc } = require('./tools/transpile-src.cjs');

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-keep-warm-build-'));
transpileSrc(buildDir);
const { parseWorkerProfile } = require(path.join(buildDir, 'workers', 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'workers', 'openCodeRuntime.js'));
const { workersToPing, keepWarmTick, startKeepWarmTimer, KEEP_WARM_PROMPT } = require(path.join(buildDir, 'workers', 'keepWarm.js'));
const { projectWorkersState } = require(path.join(buildDir, 'workers', 'workersState.js'));
const browser = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }), document: { readyState: 'loading', addEventListener() {}, querySelectorAll: () => [], getElementById: () => null }, window: {}, console, setTimeout() {}, setInterval() {} };
require('node:vm').runInNewContext(fs.readFileSync(__dirname + '/media/webview.js', 'utf8').replace(/\}\(\)\);\s*$/, 'globalThis.render = renderWorkersHtml; globalThis.card = workerCardHtml; globalThis.summary = workersSummaryHtml; }());'), browser);

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-keep-warm-fixture-'));
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
assert.deepEqual(decide({ unusedPings: 2 }), ['w'], 'two unused pings: a third is allowed');
assert.deepEqual(decide({ unusedPings: 3 }), ['w'], 'three unused pings: a fourth is allowed');
assert.deepEqual(decide({ unusedPings: 4 }), [], 'stop after 4 consecutive unused pings');
assert.deepEqual(decide({}, 0), [], 'main chat never active: no ping');
assert.deepEqual(decide({}, now - 301_000), [], 'main chat idle for over 5 minutes: no ping');
assert.deepEqual(decide({ adapter: 'agy' }), [], 'agy adapter: never pinged');
assert.deepEqual(decide({ model: 'agy/gemini-4-argon-high' }), [], 'agy model: never pinged');

(async () => {
    // 2) Wiring through the real runtime against a fake OpenCode session endpoint.
    const requests = [];
    let failNext = false;
    const reply = () => JSON.stringify({ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }, { type: 'step-finish', id: 'prt_ping', cost: 0.0001, tokens: { input: 5, output: 2, reasoning: 0, cache: { read: 1000, write: 0 } } }] });
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
            if (failNext) { res.statusCode = 500; res.end('boom'); return; }
            res.setHeader('content-type', 'application/json');
            res.end(reply());
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    let clock = 1_000_000;
    const children = [];
    // The agy verify loop (test-agy-runtime.cjs) would end the run after the clock moves; keep-warm needs exit-time completion.
    const makeRuntime = () => new OpenCodeWorkerRuntime([profile], { ledgerDir, now: () => clock, attachUrl: url, agyVerifyLoop: false, spawner: (args) => {
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
    const finishAgyRun = async (child) => {
        await emit(child, { event: 'step_update', step_update: { conversation_id: 'conv_agy_1', step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'Result: PASS\nEvidence: agy-ok\nKnowledge: agy-k', usage: { input_tokens: 400, output_tokens: 20, thinking_tokens: 0, cache_read_tokens: 1600 } } });
        await emit(child, { event: 'result', result: { conversation_id: 'conv_agy_1', status: 'SUCCESS', response: 'Result: PASS\nEvidence: agy-ok\nKnowledge: agy-k' } });
        child.emit('exit', 0, null);
        await tick();
    };

    const started = runtime.start(packet);
    await finishRun(children[0]);
    const workerId = started.workerId;
    const agyStarted = runtime.start({ ...packet, runtime: 'agy', model: 'agy/gemini-4-argon-high' });
    clock += 5_000;
    await finishAgyRun(children[1]);
    clock -= 5_000;
    const agyWorkerId = agyStarted.workerId;
    assert.deepEqual(runtime.keepWarmWorkers(workspace).map((w) => w.workerId), [workerId], 'only OpenCode workers are candidates for keep-warm pings');
    const pings = () => requests.filter((request) => request.method === 'POST');
    const mainActive = () => clock - 5_000;

    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'cache is fresh (300s left): no ping yet');
    clock += 250_000; // cache expires in 50s
    assert.deepEqual(await keepWarmTick(runtime, workspace, 0), [], 'main chat not active: no ping');
    assert.deepEqual(await keepWarmTick(runtime, workspace, clock - 301_000), [], 'main chat idle past 5 minutes: no ping');
    assert.equal(pings().length, 0);

    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'ping #1 (only OpenCode worker, never agy)');
    const projected = projectWorkersState(runtime, workspace, () => clock);
    const ocProjected = projected.workers.find((w) => w.workerId === workerId);
    const agyProjected = projected.workers.find((w) => w.workerId === agyWorkerId);
    assert.equal(ocProjected.lastPingAt, clock);
    assert.equal(ocProjected.banner.lastActivityAt, clock);
    assert.equal(ocProjected.cacheExpiresAt - clock, 300000);
    assert.deepEqual([agyProjected.adapter, agyProjected.cacheExpiresAt, agyProjected.lastPingAt, agyProjected.expired, agyProjected.banner.dollars],
        ['agy', 0, 0, false, null], 'agy worker has no cache TTL or ping state and keeps cost unreported');
    // R-TEAM-41: a finished agy task (no cache warmth) is not listed in Team; its card (the shared one) is checked directly.
    const card = browser.summary(projected, projected.workers);
    projected.members.forEach((member) => { member.turnCost = 0.1; }); // Team shows a member only with Turn spend (R-TEAM-52)
    const ocCard = browser.render(projected, workerId, {});
    const agyCard = browser.card(agyProjected, true, projected.generatedAt, {}, {});
    assert.doesNotMatch(browser.render(projected, agyWorkerId, { [agyWorkerId]: true }), /class="worker-card"/, 'finished agy task is hidden');
    assert.match(ocCard, /pinged 0m ago/);
    assert.match(ocCard, /warm for 5m0s/);
    assert.match(ocCard, /Age: 0:00 warm/);
    assert.doesNotMatch(ocCard, /4:10/);
    assert.doesNotMatch(agyCard, /Age:|warm for|pinged|within 5 min|cache is cold after 5:00/, 'agy card hides cache-age, warm countdown, and ping UI');
    assert.match(agyCard, /1 req &middot; <strong class="health-cost">\$0\.00<\/strong> &middot; 2K last in \/ 20 turn out &middot; 80% cache/, 'agy card preserves usage and cache-token telemetry with reviewer-decided free display cost');
    assert.match(agyCard, /worker-state-completed">COMPLETED<\/span>[\s\S]*?agy-k[\s\S]*? · turn turn-1 · 5s/, 'agy card preserves status, knowledge, and actual task execution age');
    assert.match(card, /<strong>2<\/strong> tasks this turn &middot; 0 running &middot; 0 queued &middot; 1 warm/, 'summary counts only OpenCode as warm');
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
    assert.equal(spend.requests, 3, 'worker spend counts the OpenCode step, the agy step, and the OpenCode ping');
    assert.equal(spend.unreportedCostRequests, 1, 'agy request cost remains unreported');
    assert.ok(Math.abs(spend.dollars - 0.0011) < 1e-9, 'ping cost is part of worker spend');

    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'the ping restarted the cache clock: nothing to do for another ~4 min');
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'ping #2 (first one was unused, one more allowed)');
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'ping #3 (two were unused, one more allowed)');
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'ping #4 (three were unused, one more allowed)');
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'stop after 4 consecutive unused pings: no fifth');
    assert.equal(pings().length, 4, 'exactly four pings sent to the session endpoint; no fifth');

    // A real run resets the count; the worker is still reusable because the pings kept it warm.
    const submitted = runtime.submit(workerId, packet);
    assert.equal(submitted.workerId, workerId, 'the kept-warm worker is reused');
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'a busy worker is never pinged');
    await finishRun(children.at(-1));
    clock += 250_000;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [workerId], 'after a real run, pinging resumes');

    // A failed ping is not recorded and does not extend the cache clock.
    clock += 250_000;
    failNext = true;
    assert.deepEqual(await keepWarmTick(runtime, workspace, mainActive()), [], 'HTTP 500: nothing pinged');
    failNext = false;
    assert.equal(pingFacts().length, 5, 'the failed ping left no ledger fact (four pings, then one after the real run)');

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
    assert.match(setting.description, /after 4 unused pings/);
    assert.match(pkg.scripts['test:workers'], /test-worker-keep-warm\.cjs/);
    console.log('EV-KEEP-WARM: PASS pings=4 no fifth ping');
})().catch((error) => { console.error(error); process.exit(1); });
