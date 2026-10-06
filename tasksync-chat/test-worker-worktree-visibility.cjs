// A worker dispatched into a git worktree of the window's workspace stays visible and counted. Run: node test-worker-worktree-visibility.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-worktree-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { projectWorkersState } = require(path.join(buildDir, 'workersState.js'));
const { workerToolDefinitions, invokeDefinition } = require(path.join(buildDir, 'workerTools.js'));

const profile = parseWorkerProfile('---\nname: verify\ndescription: "v"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n');
const keyOf = (dir) => dir.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const git = (cwd, ...args) => childProcess.execFileSync('git', args, { cwd, stdio: 'ignore' });

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-wt-')));
const owner = path.join(root, 'owner');
const worktree = path.join(root, 'owner-wt-keys');
const ledgerDir = path.join(root, 'ledger');
fs.mkdirSync(owner);
git(owner, 'init', '-q');
git(owner, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
git(owner, 'worktree', 'add', '-q', worktree);

const children = [];
const spawner = (args) => {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = (signal) => { setImmediate(() => child.emit('exit', null, signal)); return true; };
    children.push(child);
    return child;
};

(async () => {
    try {
        const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner });
        const start = workerToolDefinitions(() => runtime, owner).find((d) => d.name === 'worker_start');
        const packet = { profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
        const started = JSON.parse(await invokeDefinition(start, { ...packet, workspacePath: worktree }));
        assert.equal(started.state, 'STARTING');
        assert.equal(children[0].args[children[0].args.indexOf('--dir') + 1], fs.realpathSync(worktree), 'OpenCode runs in the worktree');

        children[0].stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'ses_W', part: { tokens: { input: 10, output: 2 }, cost: 0.5 } })}\n`);
        await new Promise((resolve) => setImmediate(resolve));

        const since = Date.now() - 60_000;
        const state = projectWorkersState(runtime, owner);
        assert.deepEqual(state.workers.flatMap((w) => w.runs.map((r) => r.runId)), [started.runId], 'the owner\'s Workers tab lists the run');
        const spend = runtime.usageSince(owner, since);
        assert.equal(spend.requests, 1, 'the owner\'s banner counts the checkpoint');
        assert.equal(spend.dollars, 0.5);
        assert.ok(fs.existsSync(path.join(ledgerDir, `${keyOf(fs.realpathSync(owner))}.jsonl`)), 'ledger is keyed by the owner');
        assert.ok(!fs.existsSync(path.join(ledgerDir, `${keyOf(fs.realpathSync(worktree))}.jsonl`)), 'not by the worktree');
        const fact = runtime.facts(owner).find((f) => f.runId === started.runId);
        assert.equal(fact.workspace, fs.realpathSync(owner));
        assert.equal(fact.cwd, fs.realpathSync(worktree), 'ledger facts record the cwd');

        // Ledgers written before the split were keyed by the worktree: still found for the owner.
        const legacyDir = path.join(root, 'legacy-ledger');
        fs.mkdirSync(legacyDir);
        const wt = fs.realpathSync(worktree);
        const record = (type, extra = {}) => JSON.stringify({ ts: Date.now(), workspace: wt, workerId: 'host-w1', runId: 'run-host-5', sessionId: 's', dispatchTurnId: 't', source: 'github-copilot',
            profile: 'verify', model: 'github-copilot/gpt-5.6-luna', thinking: 'low', type, ...extra });
        fs.writeFileSync(path.join(legacyDir, `${keyOf(wt)}.jsonl`), `${record('checkpoint', { usage: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 1, steps: 1 } })}\n${record('stop', { state: 'COMPLETED' })}\n`);
        const reloaded = new OpenCodeWorkerRuntime([profile], { ledgerDir: legacyDir, spawner });
        reloaded.rehydrate(owner, false);
        assert.deepEqual(projectWorkersState(reloaded, owner).workers.flatMap((w) => w.runs.map((r) => r.runId)), ['run-host-5'], 'old worktree-keyed runs are rehydrated for the owner');
        assert.equal(reloaded.usageSince(owner, since).requests, 1);

        console.log('PASS EV-WORKER-WORKTREE-VISIBLE');
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exit(1); });
