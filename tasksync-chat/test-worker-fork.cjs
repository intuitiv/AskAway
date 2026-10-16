// EV-WORKER-FORK (spec 005 T022): `submit` to a busy worker whose expected wait is past FORK_AFTER_SECONDS forks the worker's
// OpenCode session into a parallel worker; a short wait still queues; an impossible fork queues with its reason.
// Driven through the `worker` tool with a fake spawner and a fake fork (plus a fake HTTP server for the default fork). Run: node test-worker-fork.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-fork-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
    require('./test-fixture-transpile.cjs')(buildDir, `workers/${name}.ts`);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workers/workerProfiles.js'));
const { OpenCodeWorkerRuntime, forkSessionViaServer } = require(path.join(buildDir, 'workers/openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workers/workerTools.js'));
const { projectWorkersState } = require(path.join(buildDir, 'workers/workersState.js'));
const { FORK_AFTER_SECONDS } = require(path.join(buildDir, 'workers/workerRouter.js'));

const profile = parseWorkerProfile('---\nname: verify\ndescription: "v"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n');
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-fork-ledger-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-fork-ws-'));
const packet = { profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const emit = async (child, event) => { child.stdout.write(`${JSON.stringify(event)}\n`); await tick(); };

/** A runtime on fake children; `call` is the one `worker` tool, as an orchestrator sees it. */
function fixture(options = {}) {
    const children = [];
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner: (args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new PassThrough();
        child.kill = (signal) => { setImmediate(() => child.emit('exit', null, signal)); return true; };
        children.push(child);
        return child;
    }, ...options });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
    const call = async (action, args) => {
        const tool = tools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
    return { runtime, children, call };
}

/** One finished run that leaves the worker holding context (1050 tokens) and a knowledge line, then a second run left in flight. */
async function busyParent(f, estimatedSeconds) {
    const first = await f.call('start', { ...packet, estimatedSeconds: 10 });
    await emit(f.children[0], { type: 'step_finish', sessionID: 'ses_PARENT', part: { tokens: { input: 1000, output: 50 }, cost: 0.001 } });
    await emit(f.children[0], { type: 'text', sessionID: 'ses_PARENT', part: { type: 'text', text: 'Result: PASS\nEvidence: ok\nKnowledge: knows the router and the runtime' } });
    f.children[0].emit('exit', 0, null);
    await tick();
    const second = await f.call('submit', { workerId: first.workerId, ...packet, estimatedSeconds });
    assert.equal(second.workerId, first.workerId, 'an idle worker is simply reused');
    await emit(f.children[1], { type: 'step_finish', sessionID: 'ses_PARENT', part: { tokens: { input: 1100, output: 10 }, cost: 0.001 } });
    return { parentId: first.workerId, parentRunId: second.runId };
}

(async () => {
    assert.equal(FORK_AFTER_SECONDS, 30, 'the fork threshold defaults to 30 seconds');

    // 1) Long expected wait: forked into a parallel worker on the forked session.
    const forkCalls = [];
    const f = fixture({ forkSession: async (sessionId) => { forkCalls.push(sessionId); return { sessionId: 'ses_FORK1' }; } });
    const { parentId, parentRunId } = await busyParent(f, 100);
    const forked = await f.call('submit', { workerId: parentId, ...packet, objective: 'Check the fork', estimatedSeconds: 100 });
    assert.equal(forked.status, 'FORKED');
    assert.equal(forked.forkedFrom, parentId);
    assert.notEqual(forked.workerId, parentId, 'a new worker, not a queue slot on the parent');
    assert.equal(forked.sessionId, 'ses_FORK1', 'the new worker runs in the forked session');
    assert.equal(forked.queuePosition, 0, 'it starts at once');
    assert.deepEqual(forkCalls, ['ses_PARENT'], 'the parent session is what gets forked');
    assert.deepEqual([forked.profile, forked.model, forked.thinking], ['verify', 'github-copilot/gpt-5.6-luna', 'low'], 'same profile, model and thinking');
    assert.equal(forked.nextInputTokens, 1050, "the fork inherits the parent's context size (its last completed run)");
    assert.equal(forked.knowledge, 'knows the router and the runtime', "the fork inherits the parent's knowledge");
    const forkArgs = f.children[2].args;
    assert.equal(forkArgs[forkArgs.indexOf('--session') + 1], 'ses_FORK1', 'the run is launched into the fork session');
    assert.equal(forkArgs.includes('--attach'), false, 'no attach URL configured here');

    await emit(f.children[2], { type: 'step_finish', sessionID: 'ses_FORK1', part: { tokens: { input: 10, output: 5, cache: { read: 990, write: 0 } }, cost: 0.0004 } });
    assert.equal((await f.call('status', { runId: parentRunId })).state, 'RUNNING', 'the parent keeps running');
    assert.equal((await f.call('status', { runId: forked.runId })).state, 'RUNNING', 'the fork runs at the same time');
    const listed = await f.call('list', {});
    assert.deepEqual(listed.map((w) => w.state).sort(), ['RUNNING', 'RUNNING'], 'both workers are listed running');

    const state = projectWorkersState(f.runtime, workspace);
    assert.equal(state.workers.find((w) => w.workerId === forked.workerId).forkedFrom, parentId, 'the Workers projection shows forkedFrom');
    assert.equal(state.workers.find((w) => w.workerId === parentId).forkedFrom, '', 'a fresh worker has no parent');

    const forkFact = f.runtime.facts(workspace).find((fact) => fact.type === 'fork');
    assert.ok(forkFact && forkFact.forkedFrom === parentId && forkFact.sessionId === 'ses_FORK1' && forkFact.workerId === forked.workerId, 'the fork is recorded in the ledger');

    // 4) Reload: the ledger keeps the forked worker and its parent link.
    const reloaded = new OpenCodeWorkerRuntime([profile], { ledgerDir });
    reloaded.rehydrate(workspace, true);
    assert.equal(reloaded.router.worker(forked.workerId).forkedFrom, parentId, 'rehydrate keeps forkedFrom on the routed worker');
    const row = projectWorkersState(reloaded, workspace).workers.find((w) => w.workerId === forked.workerId);
    assert.ok(row, 'the forked worker survives the reload');
    assert.deepEqual([row.forkedFrom, row.sessionId], [parentId, 'ses_FORK1']);

    // 2) Short expected wait still queues behind the running worker; nothing is forked.
    const noFork = [];
    const s = fixture({ forkSession: async (id) => { noFork.push(id); return { sessionId: 'ses_NEVER' }; } });
    const shortRun = await s.call('start', { ...packet, estimatedSeconds: 10 });
    await emit(s.children[0], { type: 'step_finish', sessionID: 'ses_SHORT', part: { tokens: { input: 10, output: 1 }, cost: 0 } });
    const queued = await s.call('submit', { workerId: shortRun.workerId, ...packet, estimatedSeconds: 10 });
    assert.equal(queued.status, undefined, 'a short wait is not FORKED');
    assert.equal(queued.workerId, shortRun.workerId);
    assert.equal(queued.queuePosition, 1, 'queued behind the running run');
    assert.deepEqual(noFork, [], 'no fork was attempted');
    assert.equal((await s.call('list', {})).length, 1, 'still one worker');

    // 3) A failing fork queues as today and says why.
    const bad = fixture({ forkSession: async () => { throw new Error('POST /session/:id/fork -> HTTP 500'); } });
    const failing = await busyParent(bad, 100);
    const failed = await bad.call('submit', { workerId: failing.parentId, ...packet, estimatedSeconds: 100 });
    assert.equal(failed.workerId, failing.parentId);
    assert.equal(failed.queuePosition, 1, 'queued on the busy worker');
    assert.match(failed.forkSkipped, /fork failed: .*HTTP 500/, 'the reply says why it did not fork');
    assert.equal((await bad.call('list', {})).length, 1, 'no extra worker was created');

    // No shared server and no injected fork: queue, with the reason.
    const offline = fixture();
    const lone = await busyParent(offline, 100);
    const none = await offline.call('submit', { workerId: lone.parentId, ...packet, estimatedSeconds: 100 });
    assert.equal(none.queuePosition, 1);
    assert.match(none.forkSkipped, /no shared OpenCode server/);

    // The default fork talks to the shared server: cut at the user message of the unfinished reply, never copying it.
    const requests = [];
    let messages;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            requests.push({ method: req.method, url: req.url, body });
            res.setHeader('content-type', 'application/json');
            if (req.url === '/session/ses_PARENT/message') { res.end(JSON.stringify(messages)); }
            else if (req.url === '/session/ses_PARENT/fork') { res.end(JSON.stringify({ id: 'ses_HTTP' })); }
            else { res.statusCode = 500; res.end('{"secret":"must not leak"}'); }
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const done = { completed: 1 };
    messages = [
        { info: { id: 'm1', role: 'user' } }, { info: { id: 'm2', role: 'assistant', parentID: 'm1', time: done } },
        { info: { id: 'm3', role: 'user' } }, { info: { id: 'm4', role: 'assistant', parentID: 'm3', time: {} } },
    ];
    assert.deepEqual(await forkSessionViaServer(url, 'ses_PARENT'), { sessionId: 'ses_HTTP' });
    assert.deepEqual(JSON.parse(requests.find((r) => r.url.endsWith('/fork')).body), { messageID: 'm3' }, 'forked before the unfinished turn');
    messages = [{ info: { id: 'm1', role: 'user' } }, { info: { id: 'm2', role: 'assistant', parentID: 'm1', time: done } }];
    await forkSessionViaServer(url, 'ses_PARENT');
    assert.deepEqual(JSON.parse(requests[requests.length - 1].body), {}, 'a fully completed session is forked whole');
    messages = [{ info: { id: 'm1', role: 'user' } }, { info: { id: 'm2', role: 'assistant', parentID: 'm1', time: {} } }];
    await assert.rejects(forkSessionViaServer(url, 'ses_PARENT'), /no completed message/, 'nothing completed yet: nothing to fork');
    await assert.rejects(forkSessionViaServer(url, 'ses_OTHER'), (error) => /HTTP 500/.test(error.message) && !/secret/.test(error.message), 'an HTTP error never echoes the body');
    await assert.rejects(forkSessionViaServer(url, '../x'), /invalid session id/);

    messages = [
        { info: { id: 'm1', role: 'user' } }, { info: { id: 'm2', role: 'assistant', parentID: 'm1', time: done } },
        { info: { id: 'm3', role: 'user' } }, { info: { id: 'm4', role: 'assistant', parentID: 'm3', time: {} } },
    ];
    const viaHttp = fixture({ attachUrl: url });
    const httpParent = await busyParent(viaHttp, 100);
    const httpFork = await viaHttp.call('submit', { workerId: httpParent.parentId, ...packet, estimatedSeconds: 100 });
    assert.equal(httpFork.status, 'FORKED', 'with a shared server attached the runtime forks over HTTP by default');
    assert.equal(httpFork.sessionId, 'ses_HTTP');
    const httpArgs = viaHttp.children[2].args;
    assert.equal(httpArgs[httpArgs.indexOf('--attach') + 1], url, 'the fork run attaches to the same shared server');
    server.close();

    for (const dir of [buildDir, ledgerDir, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('PASS EV-WORKER-FORK');
})().catch((error) => { fs.rmSync(buildDir, { recursive: true, force: true }); console.error(error); process.exit(1); });
