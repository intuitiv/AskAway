// Warm-then-fan-out and the 8-worker parallel cap, driven through the `worker` tool with a fake spawner and fake fork. Run: node test-worker-fanout.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-fanout-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
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
const profile = parseWorkerProfile(`---\nname: verify\ndescription: "v"\ntier: light\nmodel: ${MODEL}\nthinking: low\nmodels: [${MODEL}, github-copilot/other]\nthinkingOptions: [low, high]\nedit: deny\n---\nBody.\n`);
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-fanout-ledger-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-fanout-ws-'));
const packet = { profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
    const children = [];
    const forked = [];
    const spawner = (args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new PassThrough();
        child.kill = () => true;
        children.push(child);
        return child;
    };
    const forkSession = async (id) => { forked.push(id); return { sessionId: `${id}-fork${forked.length}` }; };
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner, forkSession });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
    const call = async (action, args) => {
        const tool = tools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
    const finish = async (child, session, input = 100) => {
        child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: session, part: { tokens: { input, output: 5 }, cost: 0.001 } })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: session, part: { type: 'text', text: 'Result: PASS\nEvidence: ok' } })}\n`);
        await tick();
        child.emit('exit', 0, null);
        await tick();
    };
    // A warm worker: finished its run, so it is idle and its session holds the shared context.
    const warm = async () => {
        const started = await call('start', packet);
        await finish(children[children.length - 1], 'ses_WARM');
        return started.workerId;
    };
    return { children, forked, runtime, call, finish, warm };
}

(async () => {
    // Fan-out of 3: three new workers, each on its own fork of the warm session, same model and thinking.
    const a = harness();
    const warmId = await a.warm();
    const base = a.children.length;
    const result = await a.call('fanout', { workerId: warmId, packets: [1, 2, 3].map((n) => ({ ...packet, objective: `Part ${n}`, model: MODEL })) });
    assert.equal(result.status, 'FANNED_OUT', JSON.stringify(result));
    assert.equal(result.runs.length, 3);
    assert.deepEqual(a.forked, ['ses_WARM', 'ses_WARM', 'ses_WARM'], 'one fork of the warm session per packet');
    assert.equal(new Set(result.runs.map((r) => r.workerId)).size, 3, 'each fork is its own worker');
    assert.ok(result.runs.every((r) => r.workerId !== warmId && r.forkedFrom === warmId && r.model === MODEL && r.thinking === 'low'));
    const spawned = a.children.slice(base);
    assert.equal(spawned.length, 3, 'all three run in parallel');
    spawned.forEach((child, i) => {
        assert.equal(child.args[child.args.indexOf('--session') + 1], `ses_WARM-fork${i + 1}`, 'each run resumes its own forked session');
        assert.equal(child.args[child.args.indexOf('--model') + 1], MODEL);
    });
    await Promise.all(spawned.map((child, i) => a.finish(child, `ses_WARM-fork${i + 1}`)));
    const listed = await a.call('list', {});
    assert.equal(listed.filter((w) => result.runs.some((r) => r.workerId === w.workerId)).length, 3, 'forks stay listed as reusable workers');
    const reused = await a.call('submit', { workerId: result.runs[0].workerId, ...packet });
    assert.equal(reused.workerId, result.runs[0].workerId, 'a fork accepts later submits like any worker');

    // Mismatched model or thinking: refused whole, nothing forked.
    const b = harness();
    const bWarm = await b.warm();
    const wrongModel = await b.call('fanout', { workerId: bWarm, packets: [{ ...packet }, { ...packet, model: 'github-copilot/other' }] });
    assert.equal(wrongModel.status, 'MODEL_MISMATCH');
    assert.match(wrongModel.reason, /packet 2: model github-copilot\/other != /);
    const wrongThinking = await b.call('fanout', { workerId: bWarm, packets: [{ ...packet, thinking: 'high' }, { ...packet }] });
    assert.equal(wrongThinking.status, 'MODEL_MISMATCH');
    assert.equal(b.forked.length, 0, 'no fork on a refused fan-out');
    assert.equal(b.children.length, 1, 'no run started on a refused fan-out');
    assert.equal((await b.call('fanout', { workerId: bWarm, packets: [packet] }).catch((e) => ({ status: 'THROWN', e }))).status, 'THROWN', 'fewer than 2 packets rejected by the schema');
    assert.equal((await b.call('fanout', { workerId: 'worker-ghost', packets: [packet, packet] })).status, 'INELIGIBLE', 'unknown warm worker refused');

    // Cap: the 9th running worker is refused for start.
    const c = harness();
    for (let i = 0; i < 8; i++) { assert.equal((await c.call('start', packet)).state, 'STARTING', `worker ${i + 1} starts`); }
    const ninth = await c.call('start', packet);
    assert.deepEqual([ninth.status, ninth.running, ninth.max], ['PARALLEL_CAP', 8, 8]);
    assert.equal(c.children.length, 8, 'the 9th worker never spawned');
    await c.finish(c.children[0], 'ses_C0');
    assert.equal((await c.call('start', packet)).state, 'STARTING', 'a slot freed by a finished worker is usable again');

    // Cap: fanout over the cap is refused whole; at the cap it succeeds.
    const d = harness();
    const dWarm = await d.warm();
    for (let i = 0; i < 6; i++) { await d.call('start', { ...packet, model: 'github-copilot/other' }); }
    const over = await d.call('fanout', { workerId: dWarm, packets: [packet, packet, packet] });
    assert.deepEqual([over.status, over.running, over.max], ['PARALLEL_CAP', 6, 8]);
    assert.equal(d.forked.length, 0, 'refused whole: nothing forked');
    assert.equal(d.children.length, 7, 'refused whole: nothing started');
    const fits = await d.call('fanout', { workerId: dWarm, packets: [packet, packet] });
    assert.equal(fits.status, 'FANNED_OUT');
    assert.equal(d.children.length, 9);
    assert.equal((await d.call('start', packet)).status, 'PARALLEL_CAP', 'eight running: start refused');

    // Cap: a submit that would fork a busy worker past the cap is refused too.
    const e = harness();
    const busy = await e.call('start', { ...packet, estimatedSeconds: 600 });
    e.children[0].stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'ses_BUSY', part: { tokens: { input: 10, output: 1 }, cost: 0 } })}\n`);
    await tick();
    for (let i = 0; i < 7; i++) { await e.call('start', { ...packet, model: 'github-copilot/other' }); }
    const capped = await e.call('submit', { workerId: busy.workerId, ...packet });
    assert.equal(capped.status, 'PARALLEL_CAP', 'a fork past the cap is refused');
    assert.equal(e.forked.length, 0, 'no fork happened past the cap');

    for (const dir of [buildDir, ledgerDir, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('PASS EV-WORKER-FANOUT fanout3=3forks sameModel=true mismatchRefused=true startCap=8 fanoutOverCapRefusedWhole=true');
})().catch((error) => { console.error(error); process.exit(1); });
