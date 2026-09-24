const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const source = fs.readFileSync(path.join(__dirname, 'src', 'mcp', 'mcpServer.ts'), 'utf8');
const contract = source.slice(
    source.indexOf('export const WORKER_RUNTIME_OPERATIONS'),
    source.indexOf('async function tryReadImageAsMcpContent')
);

const operations = [...contract.matchAll(/'worker_[a-z]+'/g)].map((match) => match[0].slice(1, -1));
const expectedOperations = [
    'worker_start', 'worker_submit', 'worker_list', 'worker_status',
    'worker_wait', 'worker_cancel', 'worker_resume', 'worker_logs',
];

assert.deepStrictEqual(operations.slice(0, expectedOperations.length), expectedOperations);
assert.strictEqual(new Set(operations.slice(0, expectedOperations.length)).size, 8);
assert.match(contract, /export interface WorkerHandle/);
for (const field of ['workerId', 'runId', 'openCodeSessionId', 'effectiveAdapter', 'effectiveModel', 'effectiveThinking', 'state']) {
    assert.match(contract, new RegExp(`\\b${field}\\b`));
}
assert.match(contract, /state: WorkerDispatchState/);
assert.doesNotMatch(contract, /worker_ask|worker_respond|credential|secret|approvalDecision/i);

const chatBuildDir = path.join(__dirname, '.worker-contract-test-build');
fs.rmSync(chatBuildDir, { recursive: true, force: true });
fs.mkdirSync(chatBuildDir, { recursive: true });
fs.writeFileSync(
    path.join(chatBuildDir, 'workerOperationFacade.js'),
    ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'mcp', 'workerOperationFacade.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
    ).outputText
);
const { createWorkerOperationFacade } = require(path.join(chatBuildDir, 'workerOperationFacade.js'));
fs.rmSync(chatBuildDir, { recursive: true, force: true });
let terminalReleased = false;
let releaseTerminal;
const terminal = new Promise((resolve) => { releaseTerminal = resolve; });
const handle = {
    workerId: 'worker-fixture',
    runId: 'run-fixture',
    openCodeSessionId: 'session-fixture',
    effectiveAdapter: 'opencode',
    effectiveModel: 'fixture-model',
    effectiveThinking: { kind: 'budget', value: 128 },
    state: 'STARTING',
};
const facade = createWorkerOperationFacade({
    worker_start: async () => handle,
    worker_submit: async () => ({ ...handle, runId: 'run-submitted' }),
    worker_list: async () => ({ canonicalWorkspacePath: '/fixture/workspace', workers: [] }),
    worker_status: async () => ({ workerId: handle.workerId, profileId: 'fixture', openCodeSessionId: handle.openCodeSessionId, state: 'STARTING', contextTokens: 0, sourceRevision: 'fixture', lastUpdateAt: 'fixture', sessionOpenAction: 'fixture', metrics: { elapsedTime: 0, cost: 0, input: 0, output: 0 } }),
    worker_wait: async () => { await terminal; return { status: 'COMPLETED', evidence: [] }; },
    worker_cancel: async () => ({ workerId: handle.workerId, status: 'CANCELLATION_REQUESTED' }),
    worker_resume: async () => handle,
    worker_logs: async () => ({ workerId: handle.workerId, events: [] }),
});
assert.deepStrictEqual(Object.keys(facade), expectedOperations);

(async () => {
    const started = await facade.worker_start({});
    const submitted = await facade.worker_submit({});
    assert.strictEqual(started.state, 'STARTING');
    assert.strictEqual(submitted.state, 'STARTING');
    assert.notStrictEqual(started.runId, submitted.runId);
    assert.strictEqual(terminalReleased, false);
    const waited = facade.worker_wait({ workerId: handle.workerId });
    releaseTerminal();
    terminalReleased = true;
    assert.deepStrictEqual(await waited, { status: 'COMPLETED', evidence: [] });

const relaySource = fs.readFileSync(path.join(__dirname, '..', 'tasksync-opencode', 'src', 'relay.ts'), 'utf8');
const relayBuildDir = path.join(__dirname, '..', 'tasksync-opencode', '.worker-contract-test-build');
fs.mkdirSync(relayBuildDir, { recursive: true });
fs.writeFileSync(
    path.join(relayBuildDir, 'relay.js'),
    ts.transpileModule(relaySource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
);
const { translateLifecycleEvent } = require(path.join(relayBuildDir, 'relay.js'));
fs.rmSync(relayBuildDir, { recursive: true, force: true });
const identity = {
    canonicalWorkspace: '/fixture/workspace',
    workerId: 'worker-fixture',
    runId: 'run-fixture',
    sessionId: 'session-fixture',
};

for (const type of ['start', 'message_update', 'before_tool', 'after_tool', 'checkpoint', 'stop', 'error']) {
    const fact = translateLifecycleEvent({ type, fixture: 'stable' }, identity);
    assert.deepStrictEqual(
        [fact.canonicalWorkspace, fact.workerId, fact.runId, fact.sessionId],
        [identity.canonicalWorkspace, identity.workerId, identity.runId, identity.sessionId]
    );
    assert.strictEqual(fact.type, type);
}
for (const event of [
    { type: 'message_update', token: 'fixture-token' },
    { type: 'message_update', metadata: { token: 'fixture-token' } },
    { type: 'before_tool', approvalDecision: 'approved' },
    { type: 'message_update', transcriptBody: 'fixture transcript' },
]) {
    assert.throws(() => translateLifecycleEvent(event, identity), /excluded/i);
}

console.log('EV-001 ContractSchemaComplete: PASS operationCount=8 matched=8 forbiddenOperations=0 secretFields=0');
console.log('EV-001a CallableOperationFacade: PASS operationCount=8 matched=8');
console.log('EV-002 ImmediateHandleContract: PASS state=STARTING handleBeforeTerminal=true freshRunId=true');
console.log('EV-003 EventIdentityContract: PASS eventTypes=7 identities=4 tokenRejections=2 boundaryRejections=2');
console.log('CAC-CY-001 ContractSeamReady: PASS');
console.log('PAC-P0 ContractAndTestSeamReady: PASS operationCount=8');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});