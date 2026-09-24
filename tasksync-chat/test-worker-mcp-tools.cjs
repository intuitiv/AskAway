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
const { registerWorkerTools, WORKER_TOOL_NAMES } = require(path.join(buildDir, 'workerTools.js'));

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
const call = async (name, args) => {
    const tool = tools.get(name);
    const parsed = tool.config.inputSchema.parse(args);
    return JSON.parse((await tool.handler(parsed)).content[0].text);
};

(async () => {
    assert.deepEqual([...tools.keys()], [...WORKER_TOOL_NAMES]);
    assert.equal(tools.size, 8);
    assert.ok(![...tools.keys()].some((name) => /ask|respond/.test(name)), 'no Spec 003 messaging tools');
    assert.match(tools.get('worker_wait').config.description, /240s/);
    assert.throws(() => tools.get('worker_wait').config.inputSchema.parse({ runId: 'r', timeoutSeconds: 241 }), 'wait above 240s is rejected by the schema');
    assert.throws(() => tools.get('worker_start').config.inputSchema.parse({ profile: 'verify' }), 'incomplete packet rejected by the schema');

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

    for (const dir of [buildDir, ledgerDir, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('EV-012 WorkerMcpSurface: PASS tools=8 askRespond=0 waitSchemaMax=240 boundedReplies=true');
})().catch((error) => { console.error(error); process.exit(1); });
