// T018 (CY-006) reload recovery, as a new extension host sees it after VS Code reloads. Run: node test-async-subagent-runner-e2e.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-reload-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { projectWorkersState } = require(path.join(buildDir, 'workersState.js'));

const profile = (name) => parseWorkerProfile(`---\nname: ${name}\ndescription: "f"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\n---\nBody.\n`);
const profiles = [profile('code'), profile('verify')];
const children = [];
const spawner = (args) => {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = () => true;
    child.emitEvent = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
    children.push(child);
    return child;
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const url = 'http://127.0.0.1:4096';
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-reload-ledger-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-reload-ws-')));
const packet = (profileName, objective) => ({ workspacePath: workspace, profile: profileName, dispatchTurnId: 'turn-9', baseRevision: 'HEAD',
    objective, allowedFiles: [], acceptance: 'a', expected: 'e', command: 'c' });
const finish = (id, input, cost) => ({ type: 'step_finish', sessionID: id, part: { tokens: { input, output: 10, reasoning: 0, cache: { read: 400, write: 0 } }, cost } });

(async () => {
    // --- Before reload: host 1 ---
    const before = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner, attachUrl: url });
    const done = before.start(packet('code', 'first'));
    children[0].emitEvent({ type: 'step_start', sessionID: 'ses_X', part: {} });
    children[0].emitEvent(finish('ses_X', 800, 0.003));
    children[0].emitEvent({ type: 'text', sessionID: 'ses_X', part: { type: 'text', text: 'Result: PASS\nEvidence: done' } });
    await tick();
    children[0].emit('exit', 0, null);
    const interrupted = before.submit(done.workerId, packet('code', 'second'));
    children[1].emitEvent({ type: 'step_start', sessionID: 'ses_X', part: {} });
    children[1].emitEvent(finish('ses_X', 200, 0.001));
    const noSession = before.start(packet('verify', 'never got a session'));
    children[2].emitEvent({ type: 'tool_use', part: { tool: 'read', state: { status: 'running' } } });
    await tick();
    // VS Code reloads here: host 1 disappears mid-run; only the ledger survives.

    // --- After reload with the shared server live: host 2 ---
    const after = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner, attachUrl: url });
    const recovered = after.rehydrate(workspace, true);
    assert.deepEqual(recovered.reconnected, [done.workerId], 'exactly one worker reconnects');
    assert.deepEqual(recovered.orphaned, [{ workerId: noSession.workerId, reason: 'no OpenCode session was recorded before reload' }]);

    const state = projectWorkersState(after, workspace);
    const x = state.workers.find((w) => w.workerId === done.workerId);
    assert.deepEqual([x.state, x.sessionId, x.sessionOpenAction], ['FAILED', 'ses_X', `opencode attach ${url} --session ses_X`], 'exact session link kept');
    assert.deepEqual(x.runs.map((r) => [r.runId, r.state]), [[done.runId, 'COMPLETED'], [interrupted.runId, 'FAILED']]);
    assert.equal(x.runs[1].reason, 'interrupted by reload; worker_resume continues its session');
    assert.deepEqual([x.runs[0].usage.cost, x.runs[1].usage.cost, x.usage.cost], [0.003, 0.001, 0.004], 'measured cost survives the reload');
    const y = state.workers.find((w) => w.workerId === noSession.workerId);
    assert.deepEqual([y.state, y.blocker], ['ORPHANED', 'orphaned: no OpenCode session was recorded before reload']);

    // Resume continues the same session; an orphaned worker needs a fresh submission.
    const spawned = children.length;
    assert.equal(after.resume(interrupted.runId).state, 'STARTING');
    const resumeArgs = children[spawned].args;
    assert.equal(resumeArgs[resumeArgs.indexOf('--session') + 1], 'ses_X');
    assert.equal(after.resume(noSession.runId).status, 'FRESH_SUBMISSION_REQUIRED');
    assert.equal(after.rehydrate(workspace, true).reconnected.length, 1, 'rehydrating twice restores nothing twice');
    assert.equal(projectWorkersState(after, workspace).workers.length, 2);

    // --- After reload with the shared server down: every worker is orphaned with a reason ---
    const down = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner });
    const lost = down.rehydrate(workspace, false);
    assert.deepEqual(lost.reconnected, []);
    assert.equal(lost.orphaned.length, 2);
    assert.ok(lost.orphaned.every((o) => o.reason === 'shared OpenCode server not reachable after reload'));
    // The server comes back: server-orphaned workers with a session reconnect; the session-less one stays orphaned.
    const back = down.rehydrate(workspace, true);
    assert.deepEqual([back.reconnected, back.orphaned.map((o) => o.workerId)], [[done.workerId], [noSession.workerId]]);

    console.log('EV-018 ReloadRecovery: PASS reconnected=1 orphaned=1 orphanReason=nonempty sessionLinkKept=true resumeSameSession=true serverDown=allOrphaned serverBack=reconnect');

    // Seen live in the commentary demo: a verify run exited 0 with no report and was treated as done.
    const silentHost = new OpenCodeWorkerRuntime(profiles, { ledgerDir: fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-silent-')), spawner });
    const silent = silentHost.start(packet('verify', 'silent run'));
    const child = children[children.length - 1];
    child.emitEvent({ type: 'step_start', sessionID: 'ses_Q', part: {} });
    child.emitEvent({ type: 'tool_use', sessionID: 'ses_Q', part: { tool: 'bash', state: { status: 'completed' } } });
    await tick();
    child.emit('exit', 0, null);
    const outcome = await silentHost.wait(silent.runId, 1);
    assert.deepEqual([outcome.status, outcome.reason], ['FAILED', 'worker ended without a report (no Result/Evidence text)']);
    assert.equal(silentHost.resume(silent.runId).state, 'STARTING', 'the same session can be asked to finish its report');
    console.log('EV-037 SilentRunIsNotSuccess: PASS exit0NoReport=FAILED reason=explicit resumable=true');
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
