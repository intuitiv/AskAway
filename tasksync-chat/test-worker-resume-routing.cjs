// Caller-view regression: resumed sessions remain busy until the resumed run finishes.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-resume-routing-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const model = 'github-copilot/gpt-5.6-luna';
const profile = parseWorkerProfile(`---\nname: verify\ndescription: "fixture"\ntier: light\nmodel: ${model}\nthinking: low\nmodels: [${model}]\nthinkingOptions: [low]\n---\nBody.\n`);
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-resume-ws-')));
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-resume-ledger-'));
const children = [];
const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, setTimer: () => () => {}, spawner: (args) => {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = () => { child.emit('exit', null, 'SIGTERM'); return true; };
    children.push(child);
    return child;
} });
const packet = { workspacePath: workspace, profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc',
    objective: 'Verify routing', allowedFiles: [], acceptance: 'parallel sessions', expected: 'PASS', command: 'true' };
const event = (child, sessionID, text) => child.stdout.write(`${JSON.stringify({ type: 'text', sessionID, part: { text } })}\n`);
const tick = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
    for (const state of ['FAILED', 'CANCELLED']) {
        const first = runtime.start(packet);
        assert.ok(first.runId);
        const child = children.at(-1);
        const session = 'ses_resumed';
        event(child, session, 'Working');
        await tick();
        if (state === 'CANCELLED') { runtime.cancel(first.runId); }
        else { child.emit('exit', 2, null); }
        assert.equal(runtime.status(first.runId).state, state);

        const resumed = runtime.resume(first.runId);
        assert.equal(resumed.workerId, first.workerId);
        const resumedChild = children.at(-1);
        assert.equal(resumedChild.args[resumedChild.args.indexOf('--session') + 1], session);
        const parallel = runtime.start({ ...packet, objective: 'Independent task' });
        assert.ok(parallel.runId);
        assert.notEqual(parallel.workerId, first.workerId, 'start must not reuse a resumed worker even before its first event');
        const parallelChild = children.at(-1);
        assert.equal(parallelChild.args.includes('--session'), false, 'new worker must not enter the resumed session');
        event(resumedChild, session, 'Working again');
        await tick();
        assert.equal(runtime.status(first.runId).state, 'RUNNING');
        const another = runtime.start(packet);
        assert.notEqual(another.workerId, first.workerId, 'running resumed worker remains unavailable');

        event(resumedChild, session, 'Result: PASS\nEvidence: resumed task finished');
        await tick();
        resumedChild.emit('exit', 0, null);
        assert.equal(runtime.status(first.runId).state, 'COMPLETED');
        const reused = runtime.start(packet);
        assert.equal(reused.workerId, first.workerId, 'finished resumed worker becomes reusable again');
        const count = children.length;
        const refused = runtime.resume(parallel.runId);
        assert.equal(refused.runId, parallel.runId, 'resuming an already running run is a no-op');
        assert.equal(children.length, count);
        runtime.cancel(reused.runId);
        runtime.cancel(parallel.runId);
        runtime.cancel(another.runId);
        const busy = runtime.start(packet);
        const beforeRefusal = children.length;
        const busyResume = runtime.resume(reused.runId);
        assert.equal(busyResume.status, 'FRESH_SUBMISSION_REQUIRED', 'a failed run cannot resume into a worker now running another task');
        assert.equal(children.length, beforeRefusal);
        runtime.cancel(busy.runId);
    }
    console.log('PASS EV-WORKER-RESUME-ROUTING failed+cancelled resume excludes busy session; completion restores reuse; busy resume refused');
})().catch((error) => { console.error(error); process.exitCode = 1; });
