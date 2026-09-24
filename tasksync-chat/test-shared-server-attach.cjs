// One shared OpenCode server: attach, start-once, visible failure, and attach-aware launches. Run: node test-shared-server-attach.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-shared-server-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'sharedServer']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { ensureSharedOpenCodeServer, probeHttp } = require(path.join(buildDir, 'sharedServer.js'));
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));

// A fake machine: one port, and a server that answers some probes after being spawned.
function machine(answersAfterSpawn) {
    const state = { alive: false, spawns: 0, probes: 0 };
    return {
        state,
        deps: {
            probe: async () => { state.probes++; return state.alive; },
            spawn: () => { state.spawns++; if (answersAfterSpawn !== null) { setTimeout(() => { state.alive = true; }, answersAfterSpawn); } },
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
    };
}

(async () => {
    const url = 'http://127.0.0.1:4096';
    const running = machine(null);
    running.state.alive = true;
    assert.deepEqual(await ensureSharedOpenCodeServer(url, running.deps, 3, 5), { state: 'ATTACHED', endpoint: url, started: false, reason: '' });
    assert.equal(running.state.spawns, 0, 'an answering server is reused, never duplicated');

    const cold = machine(12);
    const started = await ensureSharedOpenCodeServer(url, cold.deps, 10, 5);
    assert.deepEqual([started.state, started.started, cold.state.spawns], ['ATTACHED', true, 1]);

    const broken = machine(null);
    const failed = await ensureSharedOpenCodeServer(url, broken.deps, 3, 5);
    assert.deepEqual([failed.state, failed.endpoint, broken.state.spawns], ['NOT_ATTACHED', '', 1]);
    assert.match(failed.reason, /no OpenCode server answered at http:\/\/127\.0\.0\.1:4096/);

    // The real probe: an HTTP listener counts as alive, a closed port does not.
    const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const live = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await probeHttp(live), true);
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await probeHttp(live, 300), false);

    // Launches attach to the shared server and the Workers tab opens the session on it.
    const profile = parseWorkerProfile('---\nname: verify\ndescription: "v"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\n---\nBody.\n');
    const children = [];
    const spawner = (args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new PassThrough();
        child.kill = () => true;
        children.push(child);
        return child;
    };
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-shared-ws-'));
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir: fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-shared-ledger-')), spawner });
    const packet = { workspacePath: workspace, profile: 'verify', dispatchTurnId: 't', baseRevision: 'HEAD', objective: 'check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'c' };
    runtime.start(packet);
    assert.ok(!children[0].args.includes('--attach'), 'before attach, a run hosts its own server');
    children[0].emit('exit', 0, null);
    runtime.setServerEndpoint(url);
    runtime.start({ ...packet, profile: 'verify', objective: 'check two' });
    assert.equal(children.length, 2);
    const args = children[children.length - 1].args;
    assert.equal(args[args.indexOf('--attach') + 1], url);
    children[children.length - 1].stdout.write(`${JSON.stringify({ type: 'step_start', sessionID: 'ses_S', part: {} })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    const listed = runtime.list(workspace).find((run) => run.sessionId === 'ses_S');
    assert.equal(listed.sessionOpenAction, `opencode attach ${url} --session ses_S`);
    assert.equal(runtime.serverEndpoint, url);

    console.log('EV-036 SharedServerAttach: PASS reuse=0spawn coldStart=1spawn failure=NOT_ATTACHED+reason probe=real launchAttach=true openOnServer=true');
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
