// Worker reuse policy (reviewer, 2026-10-07): thinking is not part of the reuse key, pings stop after 3, an expired worker under
// 100K is reused (warm preferred), a worker idle over 3 hours is never scheduled but stays readable. Run: node test-worker-reuse-policy.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-reuse-policy-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
for (const name of ['workerProfiles', 'workerRouter', 'keepWarm', 'openCodeRuntime', 'workersState', 'workerTools']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workerTools.js'));
const { WORKER_MAX_IDLE_MS, EXPIRED_REUSE_MAX_CONTEXT_TOKENS } = require(path.join(buildDir, 'workerRouter.js'));
const { KEEP_WARM_MAX_UNUSED_PINGS, workersToPing } = require(path.join(buildDir, 'keepWarm.js'));

const MODEL = 'github-copilot/gpt-5.6-luna';
const profile = parseWorkerProfile(`---\nname: verify\ndescription: "v"\ntier: light\nmodel: ${MODEL}\nthinking: low\nmodels: [${MODEL}]\nthinkingOptions: [low, high]\nedit: deny\n---\nBody.\n`);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-policy-ws-'));
const packet = { profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const HOUR = 3600_000;

function harness() {
    const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-policy-ledger-'));
    const clock = { t: 1_000_000 };
    const children = [];
    const spawner = (args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new PassThrough();
        child.kill = () => true;
        children.push(child);
        return child;
    };
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner, forkSession: async (id) => ({ sessionId: `${id}-fork` }), now: () => clock.t });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
    const call = async (action, args) => {
        const tool = tools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
    // Runs the child to completion; `input` is the prompt size of its one step, which becomes the worker's context.
    const finish = async (child, session, input = 100) => {
        child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: session, part: { tokens: { input, output: 5 }, cost: 0.001 } })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: session, part: { type: 'text', text: 'Result: PASS\nEvidence: ok' } })}\n`);
        await tick();
        child.emit('exit', 0, null);
        await tick();
    };
    const startAndFinish = async (session, input, args = {}) => {
        const run = await call('start', { ...packet, ...args });
        await finish(children[children.length - 1], session, input);
        return run;
    };
    return { clock, children, call, finish, startAndFinish, runtime, cleanup: () => fs.rmSync(ledgerDir, { recursive: true, force: true }) };
}
const variant = (child) => child.args[child.args.indexOf('--variant') + 1];

(async () => {
    assert.equal(WORKER_MAX_IDLE_MS, 3 * HOUR);
    assert.equal(EXPIRED_REUSE_MAX_CONTEXT_TOKENS, 100_000);
    assert.equal(KEEP_WARM_MAX_UNUSED_PINGS, 3);

    // (a) Thinking is not part of the reuse key: the idle worker is reused at ITS thinking and the reply says so.
    const a = harness();
    const first = await a.startAndFinish('ses_A');
    a.clock.t += 1000;
    const reused = await a.call('start', { ...packet, thinking: 'high' });
    assert.equal(reused.workerId, first.workerId, 'a different requested thinking reuses the idle worker');
    assert.equal(reused.thinking, 'low');
    assert.equal(reused.thinkingNote, "thinking: low (worker's)");
    assert.equal(variant(a.children[1]), 'low', 'the run keeps the worker\'s own thinking, so its session and cache are unchanged');
    assert.equal(a.children[1].args[a.children[1].args.indexOf('--session') + 1], 'ses_A');
    // A NEW worker (none idle) still takes the packet's thinking.
    const fresh = await a.call('start', { ...packet, thinking: 'high' });
    assert.notEqual(fresh.workerId, first.workerId);
    assert.equal(fresh.thinking, 'high');
    assert.equal(fresh.thinkingNote, undefined);
    assert.equal(variant(a.children[2]), 'high');
    a.cleanup();

    // (b) Keep-warm stops after 3 unused pings.
    const worker = { workerId: 'w', state: 'IDLE', active: false, queued: 0, cacheExpiresAt: 1_050_000, nextInputTokens: 1000, unusedPings: 0 };
    const ping = (unusedPings) => workersToPing([{ ...worker, unusedPings }], 1_000_000, 990_000);
    assert.deepEqual([ping(0), ping(1), ping(2)], [['w'], ['w'], ['w']], 'three pings in an idle period');
    assert.deepEqual(ping(3), [], 'no fourth ping');

    // (c) After the cache expired, start still reuses a worker under 100K, preferring a warm one.
    const d = harness();
    const w1 = await d.startAndFinish('ses_1');
    d.clock.t += 301_000;
    const expired = await d.call('start', packet);
    assert.equal(expired.workerId, w1.workerId, 'cache expired, context 105 < 100K: still reused');
    assert.equal(d.children[1].args[d.children[1].args.indexOf('--session') + 1], 'ses_1', 'with its session');
    d.cleanup();

    const e = harness();
    const oldWorker = await e.startAndFinish('ses_E1');
    e.clock.t += 100_000;
    const busy = await e.call('start', packet); // reuses oldWorker (warm) and keeps it running
    assert.equal(busy.workerId, oldWorker.workerId);
    const second = await e.call('start', packet); // oldWorker is busy: a second worker
    assert.notEqual(second.workerId, oldWorker.workerId);
    await e.finish(e.children[1], 'ses_E1');
    e.clock.t += 250_000;
    await e.finish(e.children[2], 'ses_E2');
    e.clock.t += 100_000; // oldWorker idle 350s (expired), second idle 100s (warm)
    const pick = await e.call('start', packet);
    assert.equal(pick.workerId, second.workerId, 'a warm worker is preferred over an expired one');
    e.cleanup();

    // ... but only under 100K: a big expired worker is never reused.
    const f = harness();
    const big = await f.startAndFinish('ses_BIG', EXPIRED_REUSE_MAX_CONTEXT_TOKENS);
    f.clock.t += 301_000;
    const notBig = await f.call('start', packet);
    assert.notEqual(notBig.workerId, big.workerId, 'context 100005: expired worker not reused');
    f.cleanup();
    const g = harness();
    const edge = await g.startAndFinish('ses_EDGE', EXPIRED_REUSE_MAX_CONTEXT_TOKENS - 6);
    g.clock.t += 301_000;
    assert.equal((await g.call('start', packet)).workerId, edge.workerId, 'context 99999: reused');
    g.cleanup();

    // (d) Idle for more than 3 hours: never scheduled; status, logs and the run record are still readable.
    const h = harness();
    const aged = await h.startAndFinish('ses_AGED');
    h.clock.t += 3 * HOUR - 1000;
    const stillOk = await h.call('start', packet);
    assert.equal(stillOk.workerId, aged.workerId, 'just under 3 h: reusable');
    await h.finish(h.children[1], 'ses_AGED');
    h.clock.t += 3 * HOUR + 1000;
    const spawned = h.children.length;
    const fresh3h = await h.call('start', packet);
    assert.notEqual(fresh3h.workerId, aged.workerId, 'start never picks a worker idle over 3 h');
    const refused = await h.call('submit', { workerId: aged.workerId, ...packet });
    assert.equal(refused.status, 'WORKER_TOO_OLD');
    assert.match(refused.reason, /idle more than 3 hours/);
    const fan = await h.call('fanout', { workerId: aged.workerId, packets: [packet, packet] });
    assert.equal(fan.status, 'WORKER_TOO_OLD');
    assert.equal(h.children.length, spawned + 1, 'refusals spawned nothing (only the fresh start did)');
    assert.equal((await h.call('status', { runId: aged.runId })).state, 'COMPLETED', 'status still reads it');
    assert.ok((await h.call('logs', { runId: aged.runId })).length > 0, 'logs still read it');
    h.cleanup();

    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    console.log('PASS EV-WORKER-REUSE-POLICY thinking=notInKey+workersOwn pings=3 expired<100K=reused warmFirst=true over3h=WORKER_TOO_OLD+readable');
})().catch((error) => { console.error(error); process.exit(1); });
