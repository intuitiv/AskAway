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
    assert.equal(x.runs[1].reason, 'interrupted by reload; action resume continues its session');
    assert.deepEqual([x.runs[0].usage.cost, x.runs[1].usage.cost, x.usage.cost], [0.003, 0.001, 0.004], 'measured cost survives the reload');
    const y = state.workers.find((w) => w.workerId === noSession.workerId);
    assert.deepEqual([y.state, y.blocker], ['ORPHANED', 'orphaned: no OpenCode session was recorded before reload']);
    assert.equal(y.expired, true, 'an orphaned worker cannot be reused, so the tab hides it unless Show completed is on');
    assert.equal(state.workers.find((w) => w.workerId === done.workerId).expired, false, 'the reconnected warm worker stays visible');

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

    await endToEndFlow();
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });

// T021 (CY-006): the orchestrator's whole flow through the eight worker tools, with OpenCode faked at the process boundary.
async function endToEndFlow() {
    const toolsDir = path.join(__dirname, '.e2e-flow-build');
    fs.rmSync(toolsDir, { recursive: true, force: true });
    fs.mkdirSync(toolsDir);
    for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
        fs.writeFileSync(path.join(toolsDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
    }
    const W = (name) => require(path.join(toolsDir, `${name}.js`));
    const { registerWorkerTools, WORKER_TOOL_NAMES, WORKER_ACTIONS } = W('workerTools');
    const { projectWorkersState: project, sessionOpenCommand } = W('workersState');
    const Runtime = W('openCodeRuntime').OpenCodeWorkerRuntime;
    const parse = W('workerProfiles').parseWorkerProfile;
    const code = parse('---\nname: code\ndescription: "c"\ntier: mid\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna, github-copilot/gpt-5.6-terra]\nthinkingOptions: [low, high]\n---\nBody.\n');
    const verify = parse('---\nname: verify\ndescription: "v"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n');

    let clock = 5_000_000;
    const now = () => clock;
    const spawned = [];
    const fakeOpenCode = (args) => { const c = spawner(args); spawned.push(c); return c; };
    const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-flow-ledger-'));
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-flow-ws-')));
    const host = (runtime) => {
        const tools = new Map();
        registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, ws);
        return { tools, call: async (name, args) => JSON.parse((await tools.get('worker').handler(tools.get('worker').config.inputSchema.parse({ action: name.slice('worker_'.length), ...args }))).content[0].text) };
    };
    const runtime = new Runtime([code, verify], { ledgerDir: ledger, spawner: fakeOpenCode, now, attachUrl: url });
    const { tools, call } = host(runtime);
    const pkt = (profileName, objective, extra = {}) => ({ profile: profileName, dispatchTurnId: 'turn-flow', baseRevision: 'HEAD', objective,
        allowedFiles: ['slug.js'], acceptance: 'slug("A B")==="a-b"', expected: 'SLUG: PASS', command: 'node slug.test.js', ...extra });
    const step = async (child, sid, { input = 1000, cached = 0, cost = 0.001, tool, text } = {}) => {
        child.emitEvent({ type: 'step_start', sessionID: sid, part: {} });
        if (tool) { child.emitEvent({ type: 'tool_use', sessionID: sid, part: { id: `prt_${tool}`, callID: `call_${tool}`, tool, state: { status: 'completed', input: { file: 'slug.js' }, output: 'ok', time: { start: 1, end: 41 } } } }); }
        child.emitEvent({ type: 'step_finish', sessionID: sid, part: { id: `prt_step${spawned.length}`, tokens: { input, output: 20, reasoning: 0, cache: { read: cached, write: 0 } }, cost } });
        if (text) { child.emitEvent({ type: 'text', sessionID: sid, part: { type: 'text', text } }); }
        await tick();
    };
    const exit = async (child, codeValue = 0) => { child.emit('exit', codeValue, null); await tick(); };

    // 1. One `worker` tool whose actions are exactly the eight operations; no worker ask/respond (Spec 003).
    assert.deepEqual([...tools.keys()], ['worker']);
    assert.deepEqual(WORKER_ACTIONS.map((a) => `worker_${a}`), [...WORKER_TOOL_NAMES]);
    assert.ok(!WORKER_ACTIONS.some((n) => /ask|respond/.test(n)));

    // 2. Per-mode selection: only the mode's declared models and thinking, refused explicitly otherwise.
    const badModel = await call('worker_start', pkt('code', 'x', { model: 'github-copilot/gpt-6-sol' }));
    assert.equal(badModel.status, 'SELECTION_UNAVAILABLE');
    assert.ok(badModel.reason);
    assert.equal((await call('worker_start', pkt('verify', 'x', { thinking: 'high' }))).status, 'SELECTION_UNAVAILABLE', 'verify has no high thinking');
    assert.equal(spawned.length, 0, 'refusals never spawn OpenCode');

    // 3. Parallel tracks start immediately and return handles; the parent keeps working.
    const a = await call('worker_start', pkt('code', 'implement slug', { track: 'A' }));
    const b = await call('worker_start', pkt('verify', 'review slug tests', { track: 'B' }));
    assert.deepEqual([a.state, b.state], ['STARTING', 'STARTING']);
    assert.notEqual(a.workerId, b.workerId);
    assert.deepEqual(spawned[0].args.slice(spawned[0].args.indexOf('--agent'), spawned[0].args.indexOf('--agent') + 6), ['--agent', 'aa-code', '--model', 'github-copilot/gpt-5.6-luna', '--variant', 'low']);
    assert.ok(spawned.every((c) => c.args.includes('--attach') && c.args[c.args.indexOf('--attach') + 1] === url), 'every worker attaches to the one shared server');

    // 4. Parent progress without blocking: status and a bounded wait.
    await step(spawned[0], 'ses_A', { input: 2000, tool: 'edit' });
    const progress = await call('worker_status', { runId: a.runId });
    assert.deepEqual([progress.state, progress.usage.steps, progress.usage.cost], ['RUNNING', 1, 0.001]);
    assert.equal((await call('worker_wait', { runId: a.runId, timeoutSeconds: 0 })).status, 'STILL_RUNNING');

    // 5. Serial queue on one worker; cancel before start; the queued run reuses the same session (cache boundary kept).
    const a2 = await call('worker_submit', { workerId: a.workerId, ...pkt('code', 'add unicode case', { track: 'A' }) });
    const a3 = await call('worker_submit', { workerId: a.workerId, ...pkt('code', 'dropped', { track: 'A' }) });
    assert.deepEqual([a2.queuePosition, a3.queuePosition], [1, 2]);
    assert.equal((await call('worker_cancel', { runId: a3.runId })).status, 'CANCELLATION_REQUESTED');
    await step(spawned[0], 'ses_A', { input: 100, cached: 2000, text: 'Result: PASS\nEvidence: SLUG: PASS\nKnowledge: knows slug.js and its test' });
    await exit(spawned[0]);
    assert.equal((await call('worker_wait', { runId: a.runId, timeoutSeconds: 1 })).status, 'COMPLETED');
    const a2Child = spawned[2];
    assert.equal(a2Child.args[a2Child.args.indexOf('--session') + 1], 'ses_A', 'the queued packet continues the warm session');
    assert.equal((await call('worker_status', { runId: a3.runId })).state, 'CANCELLED');

    // 6. Cache boundary: a different thinking variant is a different worker, never the warm one.
    const hi = await call('worker_start', pkt('code', 'hard case', { thinking: 'high', track: 'A' }));
    assert.notEqual(hi.workerId, a.workerId);
    assert.ok(!spawned[spawned.length - 1].args.includes('--session'), 'no session crosses a model/thinking boundary');

    // 7. Verify track fails; resume continues its own session.
    await step(spawned[1], 'ses_B', { input: 800 });
    await exit(spawned[1], 3);
    assert.deepEqual([(await call('worker_status', { runId: b.runId })).state], ['FAILED']);
    const resumed = await call('worker_resume', { runId: b.runId });
    assert.equal(resumed.state, 'STARTING');
    assert.equal(spawned[spawned.length - 1].args[spawned[spawned.length - 1].args.indexOf('--session') + 1], 'ses_B');
    await step(spawned[spawned.length - 1], 'ses_B', { input: 50, cached: 800, text: 'Result: PASS\nEvidence: 4 tests' });
    await exit(spawned[spawned.length - 1]);

    // 8. Ledger, trace, and the operator's view.
    const facts = await call('worker_logs', { runId: a.runId, limit: 50 });
    assert.deepEqual([...new Set(facts.map((f) => f.type))].sort(), ['after_tool', 'checkpoint', 'message_update', 'start', 'stop']);
    assert.doesNotMatch(fs.readFileSync(path.join(ledger, fs.readdirSync(ledger)[0]), 'utf8'), /SLUG: PASS|implement slug|slug\.js/, 'the ledger holds facts, not text');
    const view = project(runtime, ws, now);
    const workerA = view.workers.find((w) => w.workerId === a.workerId);
    const openCmd = `opencode attach ${url} --session ses_A`;
    assert.deepEqual([workerA.track, workerA.knowledge, workerA.sessionOpenAction], ['A', 'knows slug.js and its test', openCmd], 'the viewer attaches to the same shared server');
    assert.equal(sessionOpenCommand(view, 'ses_A'), openCmd, 'the tab opens exactly this session');
    assert.deepEqual(workerA.runs[0].events.map((e) => [e.kind, e.tool || e.model]), [['request', 'gpt-5.6-luna'], ['tool', 'edit'], ['request', 'gpt-5.6-luna']]);
    const turnCost = runtime.usageByTurn(ws)['turn-flow'];
    assert.deepEqual([+turnCost.cost.toFixed(6), turnCost.steps], [0.004, 4], 'every step of every run is billed to the dispatching turn');

    // 9. Reload: a new host reconnects the worker from the ledger and can keep using it.
    const reloaded = new Runtime([code, verify], { ledgerDir: ledger, spawner: fakeOpenCode, now, attachUrl: url });
    const after = reloaded.rehydrate(ws, true);
    assert.ok(after.reconnected.includes(a.workerId));
    const reHost = host(reloaded);
    assert.ok((await reHost.call('worker_list', {})).some((w) => w.workerId === a.workerId), 'the warm worker is offered for reuse after reload');

    // 10. Retirement: once its cache is cold the worker retires on the next submit and a fresh start is required.
    clock += 301_000;
    const cold = await reHost.call('worker_submit', { workerId: a.workerId, ...pkt('code', 'too late') });
    assert.deepEqual([cold.status, cold.reason], ['RETIRED', 'cache expired; start a fresh worker (action start)']);

    // 11. Protected prune: running work is kept, finished non-reusable workers are archived, costs stay.
    const running = await reHost.call('worker_start', pkt('verify', 'still going', { track: 'B' }));
    const pruned = reloaded.archive(ws);
    assert.ok(pruned.archived.includes(a.workerId));
    assert.ok(pruned.kept.some((k) => k.workerId === running.workerId));
    assert.equal((await reHost.call('worker_status', { runId: running.runId })).state, 'STARTING', 'prune never cancels');
    assert.ok(reloaded.usageByTurn(ws)['turn-flow'].cost >= turnCost.cost, 'archived cost history is kept');

    fs.rmSync(toolsDir, { recursive: true, force: true });
    console.log('EV-021 EndToEndAsyncWorkerFlow: PASS tool=worker actions=8 askRespond=0 selectionRefused=2 parallelTracks=2 sharedServer=true progress=nonBlocking queue+cancel=true sessionReuse=true cacheBoundary=true resume=sameSession ledgerText=0 trace=metricsEvents reload=reconnect retire=coldCache prune=protected');
}
