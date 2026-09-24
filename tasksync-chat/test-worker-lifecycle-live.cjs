// T029: piecewise LIVE lifecycle tests against real OpenCode workers. Spends provider credits (Luna, cents).
//   node test-worker-lifecycle-live.cjs --live
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

if (!process.argv.includes('--live')) {
    console.log('EV-029 LifecyclePiecewise: SKIP reason=pass --live to spend provider credits');
    process.exit(0);
}
const which = childProcess.spawnSync('/bin/sh', ['-c', 'command -v opencode'], { encoding: 'utf8' });
if (which.status !== 0) {
    console.log('EV-029 LifecyclePiecewise: SKIP reason=opencode not installed');
    process.exit(0);
}

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-live-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { loadWorkerProfiles } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));

fs.mkdirSync('/tmp/aa-evals', { recursive: true });
const workspace = fs.mkdtempSync('/tmp/aa-evals/lifecycle-');
fs.writeFileSync(path.join(workspace, 'marker.txt'), 'LIFECYCLE-MARKER-42\n');
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-live-ledger-'));
const runtime = new OpenCodeWorkerRuntime(loadWorkerProfiles(path.join(os.homedir(), '.askaway', 'worker-profiles')), { ledgerDir });

const packet = (objective, overrides = {}) => ({
    workspacePath: workspace, profile: 'verify', dispatchTurnId: 'live-turn-1', baseRevision: 'fixture',
    objective, allowedFiles: [], acceptance: 'marker.txt contains LIFECYCLE-MARKER-42', expected: 'LIFECYCLE-MARKER-42',
    command: 'cat marker.txt', estimatedSeconds: 30, ...overrides,
});
const results = [];
const pass = (op, detail) => { results.push(op); console.log(`EV-029 ${op}: PASS ${detail}`); };
let totalCost = 0;

(async () => {
    // Unavailable selection: refused before any process is spawned.
    const refused = runtime.start(packet('Run the verification command.', { model: 'github-copilot/claude-opus-5.5' }));
    assert.equal(refused.status, 'SELECTION_UNAVAILABLE');
    assert.equal(runtime.router.dispatches, 0);
    pass('refuseUnavailable', 'dispatches=0');

    // start: a non-terminal handle returns before any provider response.
    const t0 = Date.now();
    const run1 = runtime.start(packet('Run the verification command and report the observed line.'));
    assert.equal(run1.state, 'STARTING');
    assert.ok(Date.now() - t0 < 1000, 'start returns immediately');
    pass('start', `state=STARTING returnedInMs=${Date.now() - t0}`);

    // wait with a short bound first: STILL_RUNNING is a normal result.
    const early = await runtime.wait(run1.runId, 1);
    assert.equal(early.status, 'STILL_RUNNING');
    pass('waitStillRunning', `state=${early.state}`);

    // status reflects live progress.
    const mid = runtime.status(run1.runId);
    assert.ok(['STARTING', 'RUNNING'].includes(mid.state));
    pass('status', `state=${mid.state}`);

    // wait to completion with real evidence and real usage.
    const done = await runtime.wait(run1.runId, 180);
    assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
    assert.ok(done.evidence.join('\n').includes('LIFECYCLE-MARKER-42'), done.evidence.join('\n'));
    const s1 = runtime.status(run1.runId);
    assert.ok(s1.sessionId.startsWith('ses_') && s1.usage.input > 0 && s1.usage.output > 0 && s1.usage.cost > 0, JSON.stringify(s1.usage));
    totalCost += s1.usage.cost;
    pass('waitCompleted', `session=${s1.sessionId} in=${s1.usage.input} out=${s1.usage.output} cost=$${s1.usage.cost.toFixed(4)}`);

    // logs: ordered facts, no text.
    const facts = runtime.logs(run1.runId);
    assert.equal(facts[0].type, 'start');
    assert.equal(facts[facts.length - 1].type, 'stop');
    assert.ok(facts.some((f) => f.type === 'checkpoint' && f.usage.cost > 0));
    assert.doesNotMatch(JSON.stringify(facts), /LIFECYCLE-MARKER-42/, 'facts never contain transcript text');
    pass('logs', `facts=${facts.length} types=${[...new Set(facts.map((f) => f.type))].join(',')}`);

    // submit to the warm worker: same OpenCode session, fresh run counters, history visible.
    const run2 = runtime.submit(run1.workerId, packet('Run the verification command again and report the observed line.', { dispatchTurnId: 'live-turn-2' }));
    assert.equal(run2.workerId, run1.workerId);
    assert.equal(run2.usage.cost, 0, 'new run starts at zero cost');
    // queue: a third packet waits behind it and is cancelled before it ever starts.
    const run3 = runtime.submit(run1.workerId, packet('This should never run.', { dispatchTurnId: 'live-turn-2' }));
    assert.equal(run3.queuePosition, 1);
    assert.equal(runtime.cancel(run3.runId).status, 'CANCELLATION_REQUESTED');
    assert.equal(runtime.status(run3.runId).state, 'CANCELLED');
    pass('queueCancelBeforeStart', `queuePosition=1 state=CANCELLED`);
    const done2 = await runtime.wait(run2.runId, 180);
    assert.equal(done2.status, 'COMPLETED', JSON.stringify(done2));
    const s2 = runtime.status(run2.runId);
    assert.equal(s2.sessionId, s1.sessionId, 'submit reused the same OpenCode session');
    assert.ok(s2.usage.cacheRead > 0 || s2.usage.input > s1.usage.input, 'the reused session carries prior context');
    totalCost += s2.usage.cost;
    pass('submitReuse', `sameSession=true run2In=${s2.usage.input} cacheRead=${s2.usage.cacheRead} cost=$${s2.usage.cost.toFixed(4)}`);

    // Attribution: each run lands on its own dispatching turn.
    const turns = runtime.usageByTurn(workspace);
    assert.ok(turns['live-turn-1'].cost > 0 && turns['live-turn-2'].cost > 0);
    assert.equal(turns['live-turn-1'].runs, 1);
    pass('attribution', `turn1=$${turns['live-turn-1'].cost.toFixed(4)} turn2=$${turns['live-turn-2'].cost.toFixed(4)}`);

    // cancel a running worker: its process is stopped and the run ends CANCELLED.
    const run4 = runtime.start(packet('Count slowly from 1 to 400, one number per line, then run the verification command.', { dispatchTurnId: 'live-turn-3' }));
    await new Promise((resolve) => setTimeout(resolve, 4000));
    assert.equal(runtime.cancel(run4.runId).status, 'CANCELLATION_REQUESTED');
    const cancelled = await runtime.wait(run4.runId, 30);
    assert.equal(cancelled.status, 'CANCELLED', JSON.stringify(cancelled));
    pass('cancelRunning', `state=CANCELLED`);

    // resume: a cancelled run continues in its own session, or explicitly requires a fresh submission.
    const resumed = runtime.resume(run4.runId);
    if (resumed.status === 'FRESH_SUBMISSION_REQUIRED') {
        assert.match(resumed.reason, /session/);
        pass('resume', `FRESH_SUBMISSION_REQUIRED reason=${resumed.reason}`);
    } else {
        const done4 = await runtime.wait(run4.runId, 180);
        assert.equal(done4.status, 'COMPLETED', JSON.stringify(done4));
        totalCost += runtime.status(run4.runId).usage.cost;
        pass('resume', `sameSession=${runtime.status(run4.runId).sessionId !== ''} state=COMPLETED`);
    }

    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log(`EV-029 LifecyclePiecewise: PASS operations=${results.length} [${results.join(',')}] liveCost=$${totalCost.toFixed(4)} workspace=${workspace}`);
    process.exit(0);
})().catch((error) => { console.error(`EV-029 LifecyclePiecewise: FAIL ${error.message}`); process.exit(1); });
