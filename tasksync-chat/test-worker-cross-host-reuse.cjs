// A worker another extension host wrote to the shared ledger is reused by this host's start/submit while warm. Run: node test-worker-cross-host-reuse.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-cross-host-test-build');
const ledgerDir = path.join(__dirname, '.worker-cross-host-test-ledger');
for (const dir of [buildDir, ledgerDir]) { fs.rmSync(dir, { recursive: true, force: true }); }
fs.mkdirSync(buildDir);
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workerTools.js'));

const MODEL = 'github-copilot/gpt-5.6-luna';
const profile = parseWorkerProfile(`---\nname: verify\ndescription: "v"\ntier: light\nmodel: ${MODEL}\nthinking: low\nmodels: [${MODEL}]\nthinkingOptions: [low, high]\nedit: deny\n---\nBody.\n`);
const workspace = fs.mkdtempSync(path.join(__dirname, '.worker-cross-host-ws-'));
const packet = { profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function host(clock) {
    const children = [];
    const spawner = (args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new PassThrough();
        child.kill = () => true;
        children.push(child);
        return child;
    };
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner, now: () => clock.t });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
    const call = async (action, args) => {
        const tool = tools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
    const finish = async (child, session) => {
        child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: session, part: { tokens: { input: 100, output: 5 }, cost: 0.001 } })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: session, part: { type: 'text', text: 'Result: PASS\nEvidence: ok' } })}\n`);
        await tick();
        child.emit('exit', 0, null);
        await tick();
    };
    return { children, call, finish };
}

(async () => {
    const clock = { t: 1_000_000 };
    // Host B is activated before host A does anything: it cannot know A's workers except through the ledger.
    const b = host(clock);
    assert.equal((await b.call('list', {})).length, 0);
    const a = host(clock);
    const created = await a.call('start', packet);
    await a.finish(a.children[0], 'ses_A');

    // Within the TTL, same profile/model/thinking: B reuses A's worker and its session.
    clock.t += 120_000;
    const reused = await b.call('start', packet);
    assert.equal(reused.workerId, created.workerId, 'host B reuses the idle warm worker host A created');
    assert.equal(b.children.length, 1);
    const args = b.children[0].args;
    assert.equal(args[args.indexOf('--session') + 1], 'ses_A', 'the run resumes the warm session');
    await b.finish(b.children[0], 'ses_A');

    // Host A sees B's reuse: the clock restarted at B's run, so a start 200s later (320s after A's own run) still reuses.
    clock.t += 200_000;
    const again = await a.call('start', packet);
    assert.equal(again.workerId, created.workerId, 'host A sees the activity host B wrote');
    await a.finish(a.children[1], 'ses_A');

    // A sibling still running in another host is never taken.
    clock.t += 1000;
    const running = await b.call('start', packet);
    assert.equal(running.workerId, created.workerId);
    b.children[1].stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'ses_A', part: { type: 'text', text: 'working' } })}\n`);
    await tick();
    const parallel = await a.call('start', packet);
    assert.notEqual(parallel.workerId, created.workerId, 'a worker executing in another host is not reused');
    await b.finish(b.children[1], 'ses_A');
    await a.finish(a.children[2], 'ses_P');

    // Past the TTL a small-context sibling is still reused (policy 2026-10-07), at its own thinking.
    clock.t += 301_000;
    const siblings = [created.workerId, parallel.workerId];
    const cold = await b.call('start', packet);
    assert.ok(siblings.includes(cold.workerId), 'an expired small-context sibling is reused');
    const other = await b.call('start', { ...packet, thinking: 'high' });
    assert.ok(siblings.includes(other.workerId) && other.workerId !== cold.workerId, 'another thinking reuses the other sibling');
    assert.equal(other.thinking, 'low');
    assert.equal(other.thinkingNote, "thinking: low (worker's)");
    await b.finish(b.children[b.children.length - 2], 'ses_A');
    await b.finish(b.children[b.children.length - 1], 'ses_A');

    // Idle for more than 3 hours: never scheduled, a fresh worker is created.
    clock.t += 3 * 3600_000 + 1000;
    const old = await b.call('start', packet);
    assert.ok(!siblings.includes(old.workerId) && ![cold.workerId, other.workerId].includes(old.workerId), 'workers idle over 3 h are not scheduled');

    for (const dir of [buildDir, ledgerDir, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('PASS EV-WORKER-CROSS-HOST-REUSE withinTtl=reused expiredSmall=reused over3h=new busySibling=skipped');
})().catch((error) => { console.error(error); process.exit(1); });
