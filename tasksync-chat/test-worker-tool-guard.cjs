// EV-WORKER-TOOL-GUARD (R-WTOOL-45, R-WTOOL-46): a worker may start only read-only children, at most 2 live, one level deep.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors'; export * from './src/workers/workerTools';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { configureAITalkDelivery, registerToolDefinitions, workerTool, roomFor } = mod.exports;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-guard-'));
    roomFor(root).registerAgent();
    configureAITalkDelivery(root);

    // A runtime double: every start is a live run until cancelled; no model is called.
    const runs = new Map(); let counter = 0;
    const runtime = {
        start(packet) { const n = ++counter; const run = { runId: `run-${n}`, workerId: `child-${n}`, state: 'RUNNING', profile: packet.profile }; runs.set(run.runId, run); return run; },
        status(runId) { return runs.get(runId); },
        cancel(runId) { const run = runs.get(runId); if (run) run.state = 'CANCELLED'; return { status: 'CANCELLATION_REQUESTED', runId }; },
        submitForking(workerId, packet) { const n = ++counter; const run = { runId: `run-${n}`, workerId, state: 'RUNNING', profile: packet.profile }; runs.set(run.runId, run); return run; },
        logs() { return []; },
        submitForking(workerId, packet) { const n = ++counter; const run = { runId: `run-${n}`, workerId, state: 'RUNNING', profile: packet.profile }; runs.set(run.runId, run); return run; },
    };
    let call; registerToolDefinitions((name, config, handler) => { call = handler; }, [workerTool(() => runtime, root)]);
    const packet = (profile) => ({ action: 'start', profile, dispatchTurnId: 't1', baseRevision: 'main', objective: 'look', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'rtk git status' });
    const as = async (recipient, args) => JSON.parse((await call(args, { _meta: { recipient, workspacePath: root } })).content[0].text);
    const asMain = async (args) => JSON.parse((await call(args)).content[0].text);

    const first = await as('parent', packet('explore'));
    assert.equal(first.runId, 'run-1', 'a read-only child is started');
    const refusedBuild = await as('parent', packet('build'));
    assert.equal(refusedBuild.status, 'REFUSED'); assert.match(refusedBuild.reason, /read-only/);
    assert.equal(counter, 1, 'a refused build child starts nothing');
    assert.equal((await as('parent', packet('verify'))).runId, 'run-2', 'a second live child is allowed');
    const third = await as('parent', packet('research'));
    assert.equal(third.status, 'REFUSED'); assert.match(third.reason, /at most 2/);
    assert.equal(counter, 2);
    console.log('PASS read-only child allowed; build child refused; third live child refused');

    assert.equal((await as('parent', { action: 'status', runId: 'run-1' })).runId, 'run-1', 'status of its own child stays allowed');
    assert.equal((await as('parent', { action: 'cancel', runId: 'run-2' })).status, 'CANCELLATION_REQUESTED', 'cancel of its own child stays allowed');
    assert.equal((await as('parent', packet('quality'))).runId, 'run-3', 'a cancelled child frees a slot');
    assert.equal((await as('parent', { action: 'status', runId: 'someone-elses' })).status, 'REFUSED', 'a run it did not start is refused');
    console.log('PASS own children: status and cancel allowed, slot freed by cancel, foreign run refused');

    const nested = await as('child-1', packet('explore'));
    assert.equal(nested.status, 'REFUSED'); assert.match(nested.reason, /nesting depth is 1/);
    assert.equal(counter, 3);
    console.log('PASS nested start refused');

    assert.equal((await asMain(packet('build'))).runId, 'run-4', 'the main agent may start any profile');
    assert.equal((await asMain(packet('build'))).runId, 'run-5');
    assert.equal((await asMain(packet('code'))).runId, 'run-6', 'the main agent has no child cap');
    console.log('PASS EV-WORKER-TOOL-GUARD main agent unchanged');

    // submit/fanout reach only the caller's own children; a foreign or its own worker is never adopted as a child.
    assert.equal((await as('parent', { ...packet('explore'), action: 'submit', workerId: 'child-4' })).status, 'REFUSED', 'submit to a foreign warm worker is refused');
    assert.equal((await as('parent', { ...packet('explore'), action: 'submit', workerId: 'parent' })).status, 'REFUSED', 'submit to itself is refused');
    const foreignFan = await as('parent', { action: 'fanout', workerId: 'child-4', packets: [packet('explore'), packet('explore')] });
    assert.equal(foreignFan.status, 'REFUSED'); assert.match(foreignFan.reason, /child workers it started itself/);
    assert.equal((await as('parent', { action: 'status', runId: 'run-4' })).status, 'REFUSED', 'a refused submit never made the foreign worker its child');
    const countBefore = counter;
    await as('parent', { action: 'cancel', runId: 'run-3' });
    const own = await as('parent', { ...packet('explore'), action: 'submit', workerId: 'child-1' });
    assert.equal(own.workerId, 'child-1', 'submit to its own child is allowed'); assert.equal(counter, countBefore + 1);
    console.log('PASS submit/fanout limited to own children; foreign and self refused');

    // An unidentified caller (a carrier no worker owns) is refused before any action, even read-only ones.
    const ghost = async (args) => JSON.parse((await call(args, { _meta: { 'antigravity.google/conversation_id': 'no-such-conversation' } })).content[0].text);
    for (const args of [packet('explore'), { action: 'list' }, { action: 'status', runId: 'run-1' }]) {
        const refusedGhost = await ghost(args);
        assert.equal(refusedGhost.status, 'REFUSED', JSON.stringify(args)); assert.match(refusedGhost.reason, /could not be tied to a known worker/);
    }
    console.log('PASS unidentified caller refused');

    // The same worker id in another workspace shares no children or caps with this one.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-guard-other-'));
    roomFor(other).registerAgent();
    const asOther = async (recipient, args) => JSON.parse((await call(args, { _meta: { recipient, workspacePath: other } })).content[0].text);
    assert.equal((await asOther('parent', { action: 'status', runId: 'run-1' })).status, 'REFUSED', 'a same-named worker in another workspace is not the parent');
    assert.equal((await asOther('child-1', packet('explore'))).status, undefined, 'and a worker id that is a child here is not a child there');
    console.log('PASS children keyed by workspace and caller');
})().catch(e => { console.error(e); process.exit(1); });
