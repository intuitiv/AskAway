// T012: the eight worker tools as registered on the MCP surface, driven through their real handlers. Run: node test-worker-mcp-tools.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

// Built inside the package so `zod` resolves from node_modules.
const buildDir = path.join(__dirname, '.worker-tools-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { registerWorkerTools, WORKER_TOOL_NAMES, WORKER_ACTIONS } = require(path.join(buildDir, 'workerTools.js'));

const profile = parseWorkerProfile('---\nname: verify\ndescription: "v"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n');
const children = [];
const spawner = (args) => {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = (signal) => { setImmediate(() => child.emit('exit', null, signal)); return true; };
    children.push(child);
    return child;
};
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-tools-ledger-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-tools-ws-'));
const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner });

const tools = new Map();
registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
// Operations are named as in the contract (`worker_start`); on the wire they are actions of the one `worker` tool.
const viaWorkerTool = (registry) => async (name, args) => {
    const tool = registry.get('worker');
    const parsed = tool.config.inputSchema.parse({ action: name.slice('worker_'.length), ...args });
    return JSON.parse((await tool.handler(parsed)).content[0].text);
};
const call = viaWorkerTool(tools);

(async () => {
    assert.deepEqual([...tools.keys()], ['worker'], 'one tool, not eight');
    assert.deepEqual(tools.get('worker').config.inputSchema.shape.action.options, WORKER_ACTIONS);
    assert.deepEqual(WORKER_ACTIONS.map((a) => `worker_${a}`), [...WORKER_TOOL_NAMES], 'the eight contract operations are its actions');
    assert.ok(!WORKER_ACTIONS.some((name) => /ask|respond/.test(name)), 'no Spec 003 messaging actions');
    assert.match(tools.get('worker').config.description, /240s/);
    assert.throws(() => tools.get('worker').config.inputSchema.parse({ action: 'wait', runId: 'r', timeoutSeconds: 241 }), 'wait above 240s is rejected by the schema');
    assert.throws(() => tools.get('worker').config.inputSchema.parse({ action: 'fly' }), 'unknown action rejected by the schema');
    const incomplete = await call('worker_start', { profile: 'verify' });
    assert.equal(incomplete.status, 'INVALID_INPUT', 'incomplete packet refused before the runtime');
    assert.match(incomplete.reason, /dispatchTurnId/);
    assert.equal((await call('worker_status', {})).status, 'INVALID_INPUT', 'each action validates its own required fields');

    const packet = { profile: 'verify', dispatchTurnId: 'turn-9', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
    const started = await call('worker_start', packet);
    assert.equal(started.state, 'STARTING');
    children[0].stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'ses_T', part: { tokens: { input: 10, output: 2 }, cost: 0.0004 } })}\n`);
    await new Promise((resolve) => setImmediate(resolve));

    const listed = await call('worker_list', {});
    assert.equal(listed.length, 1);
    assert.deepEqual(Object.keys(listed[0]).sort(), ['cost', 'knowledge', 'lastRunId', 'model', 'nextInputTokens', 'profile', 'sessionOpenAction', 'state', 'thinking', 'warmForSeconds', 'workerId']);
    assert.equal(listed[0].nextInputTokens, 12, 'next input = last prompt + last output');
    assert.equal(listed[0].sessionOpenAction, 'opencode --session ses_T');
    assert.equal((await call('worker_status', { runId: started.runId })).usage.cost, 0.0004);
    assert.equal((await call('worker_status', { runId: 'ghost' })).status, 'UNKNOWN_RUN');
    assert.equal((await call('worker_wait', { runId: started.runId, timeoutSeconds: 0 })).status, 'STILL_RUNNING');

    const queued = await call('worker_submit', { workerId: started.workerId, ...packet });
    assert.equal(queued.queuePosition, 1);
    assert.equal((await call('worker_cancel', { runId: queued.runId })).status, 'CANCELLATION_REQUESTED');
    assert.equal((await call('worker_status', { runId: queued.runId })).state, 'CANCELLED');

    children[0].stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'ses_T', part: { type: 'text', text: 'Result: PASS\nEvidence: ok\nKnowledge: knows slugify.js, its test, and the scratch dir layout' } })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    children[0].emit('exit', 0, null);
    assert.equal((await call('worker_wait', { runId: started.runId, timeoutSeconds: 1 })).status, 'COMPLETED');
    const catalog = await call('worker_list', {});
    assert.deepEqual([catalog[0].knowledge, catalog[0].state, catalog[0].warmForSeconds > 290], ['knows slugify.js, its test, and the scratch dir layout', 'COMPLETED', true],
        'a finished worker publishes what it knows and how long it stays warm');
    const facts = await call('worker_logs', { runId: started.runId, limit: 1 });
    assert.equal(facts.length, 1, 'logs are bounded by limit');
    assert.deepEqual(Object.keys(facts[0]).sort().filter((k) => facts[0][k] !== undefined), ['exitCode', 'ts', 'type']);
    assert.equal((await call('worker_resume', { runId: started.runId })).status, 'FRESH_SUBMISSION_REQUIRED');

    // T019 retirement boundary, as the orchestrator sees it: a cold cache or an oversized context retires the worker for good.
    let clock = 1_000_000;
    const agedChildren = [];
    const aged = new OpenCodeWorkerRuntime([profile], { ledgerDir, now: () => clock, spawner: (args) => { const c = spawner(args); agedChildren.push(c); return c; } });
    const agedTools = new Map();
    registerWorkerTools((name, config, handler) => agedTools.set(name, { config, handler }), () => aged, workspace);
    const agedCall = viaWorkerTool(agedTools);
    const finishRun = async (child, input) => {
        child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'ses_R', part: { tokens: { input, output: 5 }, cost: 0.001 } })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'ses_R', part: { type: 'text', text: 'Result: PASS\nEvidence: ok' } })}\n`);
        await new Promise((resolve) => setImmediate(resolve));
        child.emit('exit', 0, null);
    };
    const cold = await agedCall('worker_start', packet);
    await finishRun(agedChildren[0], 100);
    clock += 299_000;
    assert.equal((await agedCall('worker_submit', { workerId: cold.workerId, ...packet })).queuePosition, 0, 'still warm: reused');
    await finishRun(agedChildren[1], 100);
    clock += 301_000;
    const refused = await agedCall('worker_submit', { workerId: cold.workerId, ...packet });
    assert.deepEqual([refused.status, refused.reason], ['RETIRED', 'cache expired; start a fresh worker (action start)']);
    assert.deepEqual((await agedCall('worker_submit', { workerId: cold.workerId, ...packet })).status, 'RETIRED', 'stays retired');
    assert.ok(!(await agedCall('worker_list', {})).some((w) => w.workerId === cold.workerId), 'a retired worker is not offered for reuse');
    assert.equal(agedChildren.length, 2, 'no run was started on the retired worker');

    const big = await agedCall('worker_start', packet);
    assert.notEqual(big.workerId, cold.workerId, 'a fresh start gets a new worker');
    await finishRun(agedChildren[2], 300_001);
    const tooBig = await agedCall('worker_submit', { workerId: big.workerId, ...packet });
    assert.equal(tooBig.status, 'RETIRED');
    assert.match(tooBig.reason, /context 300006/);
    const { projectWorkersState } = require(path.join(buildDir, 'workersState.js'));
    const shown = projectWorkersState(aged, workspace, () => clock).workers.find((w) => w.workerId === cold.workerId);
    assert.deepEqual([shown.state, shown.blocker, shown.expired], ['RETIRED', 'retired: cache expired', true], 'the tab shows why, under Show completed');
    console.log('EV-019 RetirementBoundary: PASS coldCache=RETIRED context300k=RETIRED reuseRefused=true freshStart=newWorker');

    // T020 archive-only prune: only inactive, empty-queue, non-reusable workers go; active work is never touched.
    const busy = await agedCall('worker_start', { ...packet, dispatchTurnId: 'turn-busy' });
    const busyQueued = await agedCall('worker_submit', { workerId: busy.workerId, ...packet });
    assert.equal(busyQueued.queuePosition, 1);
    const pruned = aged.archive(workspace);
    assert.deepEqual(pruned.archived.sort(), [big.workerId, cold.workerId].sort());
    assert.deepEqual(pruned.kept, [{ workerId: busy.workerId, reason: 'running or queued work' }]);
    assert.deepEqual([(await agedCall('worker_status', { runId: busy.runId })).state, (await agedCall('worker_status', { runId: busyQueued.runId })).state], ['STARTING', 'STARTING'], 'nothing cancelled');
    assert.deepEqual(projectWorkersState(aged, workspace, () => clock).workers.map((w) => w.workerId), [busy.workerId], 'archived workers leave the tab');
    assert.equal((await agedCall('worker_submit', { workerId: cold.workerId, ...packet })).status, 'INELIGIBLE', 'an archived worker cannot be reused');
    const reloaded = new OpenCodeWorkerRuntime([profile], { ledgerDir, now: () => clock, spawner });
    reloaded.rehydrate(workspace, true);
    assert.ok(!reloaded.list(workspace).some((run) => [cold.workerId, big.workerId].includes(run.workerId)), 'a reload does not bring them back');
    assert.ok(reloaded.usageByTurn(workspace)['turn-9'].cost >= 0.003, 'their measured cost stays in the ledger');
    console.log(`EV-020 InactiveOnlyArchivePrune: PASS archived=${pruned.archived.length} keptActive=1 cancelled=0 reloadRestores=0 costKept=true`);

    for (const dir of [buildDir, ledgerDir, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('EV-012 WorkerMcpSurface: PASS tools=1 actions=8 askRespond=0 waitSchemaMax=240 perActionValidation=true boundedReplies=true');
})().catch((error) => { console.error(error); process.exit(1); });
