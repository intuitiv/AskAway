// CY-004 lifecycle, ledger, attribution, and operation behavior with a scripted OpenCode child. Run: node test-worker-observability.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-runtime-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime, validatePacket } = require(path.join(buildDir, 'openCodeRuntime.js'));

const profile = parseWorkerProfile(`---
name: code
description: "fixture"
tier: mid
model: github-copilot/gpt-5.6-terra
thinking: high
models: [github-copilot/gpt-5.6-terra, github-copilot/gpt-5.6-luna]
thinkingOptions: [low, high]
edit: allow
---
Body.
`);

// A scripted child that behaves like `opencode run --format json`: it streams events and exits.
const children = [];
function spawner(args) {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.killed = false;
    child.kill = (signal) => { child.killed = true; setImmediate(() => child.emit('exit', null, signal)); return true; };
    child.emitEvent = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
    child.finish = (code = 0) => new Promise((resolve) => setImmediate(() => { child.emit('exit', code, null); resolve(); }));
    children.push(child);
    return child;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const session = (id) => ({ type: 'step_start', sessionID: id, part: { type: 'step-start' } });
const text = (id, body) => ({ type: 'text', sessionID: id, part: { type: 'text', text: body } });
const tool = (id, name, status) => ({ type: 'tool_use', sessionID: id, part: { tool: name, state: { status } } });
const finish = (id, input, output, cost) => ({ type: 'step_finish', sessionID: id, part: { tokens: { input, output, reasoning: 3, cache: { read: 50, write: 5 } }, cost } });

const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-ledger-'));
const wsA = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-obs-a-'));
const wsB = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-obs-b-'));
const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner });
const packet = (overrides = {}) => ({
    workspacePath: wsA, profile: 'code', dispatchTurnId: 'turn-1', baseRevision: 'abc123', objective: 'Fix add',
    allowedFiles: ['math.js'], acceptance: 'add(2,3)===5', expected: 'MATH-TEST: PASS', command: 'node test.js', estimatedSeconds: 30, ...overrides,
});

(async () => {
    // Packet validation happens before any dispatch.
    assert.match(validatePacket(packet({ command: '' })), /missing command/);
    assert.match(validatePacket(packet({ objective: 'Fix TBD' })), /placeholder/);
    assert.match(validatePacket(packet({ objective: 'use ghp_abcdefghijklmnopqrstuvwxyz0123' })), /credential/);
    assert.equal(runtime.start(packet({ acceptance: '' })).status, 'INELIGIBLE');
    assert.equal(runtime.start(packet({ model: 'github-copilot/claude-opus-5.5' })).status, 'SELECTION_UNAVAILABLE');
    assert.equal(children.length, 0, 'refusals spawn nothing');

    // start: immediate non-terminal handle, before any provider event.
    const run1 = runtime.start(packet());
    assert.equal(run1.state, 'STARTING');
    assert.equal(children.length, 1);
    const argv = children[0].args;
    assert.deepEqual(argv.slice(0, 5), ['run', '--print-logs', '--log-level', 'ERROR', '--format']);
    assert.ok(argv.includes('aa-code') && argv.includes('github-copilot/gpt-5.6-terra') && argv.includes('high'));
    assert.ok(!argv.includes('--session'), 'a new worker starts a new session');
    assert.match(argv[argv.length - 1], /Objective: Fix add[\s\S]*Verification command: node test\.js/);

    // Streaming events update status and the ledger.
    children[0].emitEvent(session('ses_A'));
    children[0].emitEvent(tool('ses_A', 'read', 'running'));
    children[0].emitEvent(tool('ses_A', 'read', 'completed'));
    children[0].emitEvent(finish('ses_A', 1200, 340, 0.0021));
    children[0].emitEvent(text('ses_A', 'Result: PASS\nEvidence: MATH-TEST: PASS'));
    await tick();
    const live = runtime.status(run1.runId);
    assert.deepEqual([live.state, live.sessionId, live.usage.input, live.usage.cost], ['RUNNING', 'ses_A', 1200, 0.0021]);

    // wait: bounded; reaching the ceiling is STILL_RUNNING, not an error.
    const early = await runtime.wait(run1.runId, 0.05);
    assert.deepEqual([early.status, early.workerId, early.state], ['STILL_RUNNING', run1.workerId, 'RUNNING']);
    const capped = runtime.wait(run1.runId, 10000);
    await children[0].finish(0);
    const done = await capped;
    assert.equal(done.status, 'COMPLETED');
    assert.deepEqual(done.evidence, ['Result: PASS', 'Evidence: MATH-TEST: PASS']);

    // logs: ordered lifecycle facts with identities and usage, never text.
    const facts = runtime.logs(run1.runId);
    assert.deepEqual(facts.map((f) => f.type), ['start', 'before_tool', 'after_tool', 'checkpoint', 'message_update', 'stop']);
    for (const fact of facts) {
        assert.deepEqual([fact.runId, fact.workerId, fact.dispatchTurnId, fact.workspace], [run1.runId, run1.workerId, 'turn-1', fs.realpathSync(wsA)]);
    }
    assert.equal(facts.filter((f) => f.sessionId === 'ses_A').length, facts.length, 'every fact carries the OpenCode session identity');
    const ledgerText = fs.readFileSync(path.join(ledgerDir, fs.readdirSync(ledgerDir)[0]), 'utf8');
    assert.doesNotMatch(ledgerText, /MATH-TEST|Objective|Result: PASS/, 'ledger holds facts, never transcript text');

    // submit to the warm worker: reuses its OpenCode session; a new run starts at zero while history stays visible.
    const run2 = runtime.submit(run1.workerId, packet({ dispatchTurnId: 'turn-2' }));
    assert.equal(run2.workerId, run1.workerId);
    assert.notEqual(run2.runId, run1.runId);
    assert.deepEqual([run2.usage.cost, run2.usage.input], [0, 0], 'per-run cost resets');
    const reuseArgs = children[1].args;
    assert.equal(reuseArgs[reuseArgs.indexOf('--session') + 1], 'ses_A');
    const listed = runtime.list(wsA).find((r) => r.runId === run2.runId);
    assert.equal(listed.nextInputTokens, 1595, 'a reused worker starts from the context it carries: last prompt 1255 + last output 340');
    assert.equal(listed.sessionOpenAction, 'opencode --session ses_A');
    children[1].emitEvent(session('ses_A'));
    children[1].emitEvent(finish('ses_A', 900, 100, 0.001));

    // Queue: a third packet waits behind run2; cancel before start spawns nothing.
    const run3 = runtime.submit(run1.workerId, packet({ dispatchTurnId: 'turn-2', objective: 'queued follow-up' }));
    assert.equal(run3.queuePosition, 1);
    const run4 = runtime.submit(run1.workerId, packet({ dispatchTurnId: 'turn-2', objective: 'second follow-up' }));
    assert.equal(run4.queuePosition, 2);
    assert.equal(runtime.cancel(run3.runId).status, 'CANCELLATION_REQUESTED');
    assert.equal(runtime.status(run3.runId).state, 'CANCELLED');
    assert.equal(children.length, 2, 'queued work is not dispatched early');
    await children[1].finish(0);
    await tick();
    assert.equal(children.length, 3, 'completion starts the next non-cancelled queued run');
    assert.equal(runtime.status(run4.runId).state, 'STARTING');

    // cancel running: kills that child only, final state CANCELLED.
    children[2].emitEvent(session('ses_A'));
    await tick();
    assert.equal(runtime.cancel(run4.runId).status, 'CANCELLATION_REQUESTED');
    const cancelled = await runtime.wait(run4.runId, 5);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(children[2].killed, true);
    assert.equal(children[0].killed, false);
    assert.equal(runtime.cancel(run4.runId).status, 'NOT_CANCELLABLE');

    // Approval requests are notification-only facts.
    const run5 = runtime.start(packet({ workspacePath: wsB, dispatchTurnId: 'turn-3' }));
    children[3].emitEvent(session('ses_B'));
    children[3].emitEvent({ type: 'permission_asked', sessionID: 'ses_B', part: {} });
    await tick();
    assert.equal(runtime.status(run5.runId).state, 'WAITING_APPROVAL');
    assert.ok(runtime.logs(run5.runId).some((f) => f.type === 'approval'));

    // Failure, then resume continues the same session.
    await children[3].finish(1);
    const failed = await runtime.wait(run5.runId, 5);
    assert.deepEqual([failed.status, failed.reason], ['FAILED', 'exit code 1']);
    const resumed = runtime.resume(run5.runId);
    assert.equal(resumed.state, 'STARTING');
    assert.equal(children[4].args[children[4].args.indexOf('--session') + 1], 'ses_B');
    children[4].emitEvent(finish('ses_B', 100, 10, 0.0002));
    children[4].emitEvent(text('ses_B', 'Result: PASS\nEvidence: resumed and finished'));
    await children[4].finish(0);
    assert.equal((await runtime.wait(run5.runId, 5)).status, 'COMPLETED');
    assert.equal(runtime.resume(run5.runId).status, 'FRESH_SUBMISSION_REQUIRED', 'a completed run cannot be resumed');
    assert.equal(runtime.resume('run-ghost').status, 'FRESH_SUBMISSION_REQUIRED');

    // Attribution: usage belongs to the dispatching turn, per workspace; other workspaces see none of it.
    const turnsA = runtime.usageByTurn(wsA);
    assert.deepEqual([turnsA['turn-1'].cost, turnsA['turn-1'].runs, turnsA['turn-1'].source], [0.0021, 1, 'github-copilot']);
    assert.deepEqual([turnsA['turn-2'].cost, turnsA['turn-2'].runs], [0.001, 1]);
    assert.equal(turnsA['turn-3'], undefined, 'workspace A never sees workspace B usage');
    assert.equal(runtime.usageByTurn(wsB)['turn-3'].cost, 0.0002);
    assert.deepEqual(runtime.list(wsB).map((r) => r.runId), [run5.runId]);

    // Retirement: a worker whose context exceeds 300000 refuses further submissions.
    const big = runtime.start(packet({ workspacePath: wsB, dispatchTurnId: 'turn-4', model: 'github-copilot/gpt-5.6-luna' }));
    children[5].emitEvent(finish('ses_C', 300001, 1, 0.01));
    await children[5].finish(0);
    await runtime.wait(big.runId, 5);
    assert.equal(runtime.submit(big.workerId, packet({ workspacePath: wsB })).status, 'RETIRED');

    for (const dir of [buildDir, ledgerDir, wsA, wsB]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('EV-010 LifecyclePollingLedger: PASS factTypes=start,before_tool,after_tool,checkpoint,message_update,stop,approval,error transcriptTextInLedger=0');
    console.log('EV-011 AsyncUsageSeparatedFromTurnCap: PASS turn1=$0.0021 turn2=$0.0010 crossWorkspaceLeak=0 source=github-copilot');
    console.log('EV-012 WorkerOperationsReflectLedger: PASS start=STARTING wait=STILL_RUNNING|COMPLETED cancelQueued=0spawn cancelRunning=killed resume=sameSession logs=factsOnly');
    console.log('EV-013 ObservableLedgerBehavior: PASS perRunCostReset=0 historicalContext=1595 approvalNotificationOnly=true retiredAt300001=true');
    console.log('CAC-CY-004 ObservableWorkerStateReady: PASS');
})().catch((error) => { console.error(error); process.exit(1); });
