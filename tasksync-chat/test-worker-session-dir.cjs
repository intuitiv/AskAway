// A session is only reused for its own run directory; a silent worker process becomes visible as STALLED. Run: node test-worker-session-dir.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { transpileSrc } = require('./tools/transpile-src.cjs');

const buildDir = path.join(__dirname, '.worker-session-dir-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
transpileSrc(buildDir);
const { parseWorkerProfile } = require(path.join(buildDir, 'workers', 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'workers', 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workers', 'workerTools.js'));

const MODEL = 'github-copilot/gpt-5.6-luna';
const profile = parseWorkerProfile(`---\nname: verify\ndescription: "v"\ntier: light\nmodel: ${MODEL}\nthinking: low\nmodels: [${MODEL}]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n`);
const ledgerDir = fs.mkdtempSync(path.join(buildDir, 'askaway-sessdir-ledger-'));
const owner = fs.mkdtempSync(path.join(buildDir, 'askaway-sessdir-owner-'));
const worktree = fs.mkdtempSync(path.join(buildDir, 'askaway-sessdir-worktree-'));
const packet = { profile: 'verify', dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const arg = (child, flag) => child.args[child.args.indexOf(flag) + 1];

const clock = { t: 1_000_000 };
const children = [];
const timers = [];
const spawner = (args) => {
    const child = new EventEmitter();
    child.args = args;
    child.pid = 4000 + children.length;
    child.stdout = new PassThrough();
    child.kill = () => true;
    children.push(child);
    return child;
};
const setTimer = (fire, ms) => { const timer = { fire, ms, live: true }; timers.push(timer); return () => { timer.live = false; }; };
const forkSession = async (id) => ({ sessionId: `${id}-fork` });
const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner, setTimer, forkSession, now: () => clock.t });
const tools = new Map();
registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, owner);
const call = async (action, args) => {
    const tool = tools.get('worker');
    return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
};
const finish = async (child, session) => {
    child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: session, part: { tokens: { input: 100, output: 5 }, cost: 0.001 } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: session, part: { type: 'text', text: 'Result: PASS\nEvidence: ok' } })}\n`);
    await tick();
    child.emit('exit', 0, null);
    await tick();
};
const ledger = () => fs.readdirSync(ledgerDir).flatMap((file) => fs.readFileSync(path.join(ledgerDir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));

(async () => {
    // The start fact is in the ledger at spawn, before the process emitted anything.
    const first = await call('start', packet);
    const early = ledger().filter((r) => r.runId === first.runId);
    assert.deepEqual(early.map((r) => r.type), ['start'], 'only the start fact, no event yet');
    assert.equal(early[0].pid, 4000);
    assert.equal(early[0].dir, fs.realpathSync(owner));
    assert.equal(early[0].sessionId, '');
    assert.equal(first.state, 'STARTING');
    await finish(children[0], 'ses_OWNER');
    assert.equal(ledger().filter((r) => r.runId === first.runId && r.type === 'start').length, 1, 'start is written once per spawn');

    // Same directory: reused, session resumed.
    clock.t += 1000;
    const again = await call('start', packet);
    assert.equal(again.workerId, first.workerId, 'same cwd reuses the warm worker');
    assert.equal(arg(children[1], '--session'), 'ses_OWNER');
    await finish(children[1], 'ses_OWNER');

    // A different run directory (a git worktree of the owner) never gets that session.
    clock.t += 1000;
    const other = await call('start', { ...packet, workspacePath: worktree });
    assert.notEqual(other.workerId, first.workerId, 'different cwd creates a new worker');
    assert.equal(children[2].args.includes('--session'), false, 'the owner session is not sent to another directory');
    assert.equal(arg(children[2], '--dir'), fs.realpathSync(worktree));
    await finish(children[2], 'ses_TREE');
    clock.t += 1000;
    assert.equal((await call('start', { ...packet, workspacePath: worktree })).workerId, other.workerId, 'the worktree worker is reused for the worktree');
    await finish(children[3], 'ses_TREE');

    // submit and fanout naming a worker of another directory are refused with CWD_MISMATCH; nothing spawns.
    const spawned = children.length;
    const refused = await call('submit', { workerId: first.workerId, ...packet, workspacePath: worktree });
    assert.equal(refused.status, 'CWD_MISMATCH');
    assert.match(refused.reason, /never reused across directories/);
    assert.equal((await call('submit', { workerId: other.workerId, ...packet })).status, 'CWD_MISMATCH', 'and the other way round');
    const fan = await call('fanout', { workerId: first.workerId, packets: [{ ...packet, workspacePath: worktree }, packet] });
    assert.equal(fan.status, 'CWD_MISMATCH');
    assert.equal(children.length, spawned, 'refusals spawn nothing');
    const okSubmit = await call('submit', { workerId: first.workerId, ...packet });
    assert.equal(okSubmit.workerId, first.workerId, 'submit in the worker\'s own directory still works');
    await finish(children[spawned], 'ses_OWNER');

    // Stall detector: a silent child is STALLED 60 s after spawn; wait returns at once; the process is not killed.
    clock.t += 1000;
    const silent = await call('start', { ...packet, thinking: undefined, model: undefined, workspacePath: fs.mkdtempSync(path.join(buildDir, 'askaway-sessdir-silent-')) });
    const stallTimer = timers.filter((t) => t.live).pop();
    assert.equal(stallTimer.ms, 60_000);
    assert.equal((await call('status', { runId: silent.runId })).state, 'STARTING');
    let killed = false;
    const child = children[children.length - 1];
    child.kill = () => { killed = true; return true; };
    const waiting = call('wait', { runId: silent.runId, timeoutSeconds: 200 });
    clock.t += 60_000;
    stallTimer.fire();
    const waited = await Promise.race([waiting, new Promise((resolve) => setTimeout(() => resolve({ status: 'WAIT_HUNG' }), 2000))]);
    assert.equal(waited.status, 'STALLED', 'a pending wait returns early');
    assert.match(waited.reason, /^no event 60 s after spawn \(session none, dir .*askaway-sessdir-silent-.*\)$/);
    const status = await call('status', { runId: silent.runId });
    assert.deepEqual([status.state, status.reason], ['STALLED', waited.reason]);
    assert.equal((await call('wait', { runId: silent.runId, timeoutSeconds: 200 })).status, 'STALLED', 'a later wait returns at once too');
    assert.ok(ledger().some((r) => r.runId === silent.runId && r.type === 'error' && r.state === 'STALLED' && r.reason === waited.reason), 'the stall is recorded');
    assert.equal(killed, false, 'never killed automatically');
    // The process speaking after all clears the stall.
    child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'ses_LATE', part: { type: 'text', text: 'hi' } })}\n`);
    await tick();
    assert.equal((await call('status', { runId: silent.runId })).state, 'RUNNING');
    // A child that speaks in time never stalls.
    const lively = await call('start', { ...packet, workspacePath: fs.mkdtempSync(path.join(buildDir, 'askaway-sessdir-lively-')) });
    const livelyTimer = timers.filter((t) => t.live).pop();
    children[children.length - 1].stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'ses_L', part: { type: 'text', text: 'hi' } })}\n`);
    await tick();
    assert.equal(livelyTimer.live, false, 'the first event cancels the stall timer');
    assert.equal((await call('status', { runId: lively.runId })).state, 'RUNNING');

    // A legacy record imported for B still belongs to A even without cwd.
    const restoredLedger = fs.mkdtempSync(path.join(buildDir, 'restored-ledger-'));
    const key = value => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const historical = ledger().filter(row => row.runId === first.runId).map(({ cwd, ...row }) => row);
    fs.writeFileSync(path.join(restoredLedger, key(fs.realpathSync(worktree)) + '.jsonl'), historical.map(JSON.stringify).join('\n') + '\n');
    const restored = new OpenCodeWorkerRuntime([profile], { ledgerDir: restoredLedger, spawner, setTimer, forkSession, now: () => clock.t });
    const fresh = restored.start({ ...packet, workspacePath: worktree });
    assert.notEqual(fresh.workerId, first.workerId);
    assert.equal(children.at(-1).args.includes('--session'), false, 'legacy directory A session never resumes in directory B');
    children.at(-1).stdout.write(JSON.stringify({ type: 'error', error: { data: { message: 'Unexpected server error: session directory mismatch' } } }) + '\n');
    children.at(-1).emit('exit', 1, null);
    assert.match((await restored.wait(fresh.runId, 1)).reason, /session directory mismatch/);
    console.log('PASS EV-WORKER-SESSION-DIR sameCwd=reused otherCwd=newWorker submitMismatch=CWD_MISMATCH fanoutMismatch=CWD_MISMATCH startFactAtSpawn=pid+dir stalled=60s waitEarly=true');
})().catch((error) => { console.error(error); process.exit(1); });
