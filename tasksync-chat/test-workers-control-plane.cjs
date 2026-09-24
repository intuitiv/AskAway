// CY-005 Workers view state, observed as the webview receives it. Run: node test-workers-control-plane.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-workers-state-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { projectWorkersState } = require(path.join(buildDir, 'workersState.js'));

const profile = (name, model) => parseWorkerProfile(`---
name: ${name}
description: "fixture"
tier: mid
model: ${model}
thinking: high
models: [${model}]
thinkingOptions: [low, high]
---
Body.
`);
const profiles = [profile('code', 'github-copilot/gpt-5.6-terra'), profile('verify', 'github-copilot/gpt-5.6-luna')];

const children = [];
function spawner(args) {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = (signal) => { setImmediate(() => child.emit('exit', null, signal)); return true; };
    child.emitEvent = (event) => child.stdout.write(`${JSON.stringify(event)}\n`);
    child.finish = (code = 0) => new Promise((resolve) => setImmediate(() => { child.emit('exit', code, null); resolve(); }));
    children.push(child);
    return child;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const start = (id) => ({ type: 'step_start', sessionID: id, part: { type: 'step-start' } });
const text = (id, body) => ({ type: 'text', sessionID: id, part: { type: 'text', text: body } });
const finish = (id, input, output, read, cost) => ({ type: 'step_finish', sessionID: id, part: { tokens: { input, output, reasoning: 0, cache: { read, write: 0 } }, cost } });

let clock = 1_000_000;
const now = () => clock;
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-ws-ledger-'));
const wsA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-ws-a-')));
const wsB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-ws-b-')));
const runtime = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner, now });
const packet = (overrides = {}) => ({
    workspacePath: wsA, profile: 'code', dispatchTurnId: 'turn-1', baseRevision: 'abc123', objective: 'Fix add SECRET-OBJECTIVE',
    allowedFiles: ['math.js'], acceptance: 'add(2,3)===5', expected: 'MATH-TEST: PASS', command: 'node test.js', estimatedSeconds: 30, ...overrides,
});

(async () => {
    // Worker A, run 1: completes with real usage.
    const run1 = runtime.start(packet());
    children[0].emitEvent(start('ses_A'));
    children[0].emitEvent(finish('ses_A', 1200, 340, 50, 0.0021));
    children[0].emitEvent(text('ses_A', 'Result: PASS TRANSCRIPT-TEXT'));
    clock += 4000;
    await children[0].finish(0);

    // Worker A, run 2: reuses the session and is blocked on an OpenCode approval; run 3 queues behind it.
    clock += 1000;
    const run2 = runtime.submit(run1.workerId, packet({ dispatchTurnId: 'turn-2' }));
    children[1].emitEvent(start('ses_A'));
    children[1].emitEvent(finish('ses_A', 300, 20, 1500, 0.0004));
    clock += 2000;
    children[1].emitEvent({ type: 'permission.asked', sessionID: 'ses_A', part: {} });
    await tick();
    const run3 = runtime.submit(run1.workerId, packet({ dispatchTurnId: 'turn-2', objective: 'queued follow-up' }));

    // Worker C: a verify worker that failed; worker D: retired.
    const runC = runtime.start(packet({ profile: 'verify', dispatchTurnId: 'turn-3' }));
    children[2].emitEvent(start('ses_C'));
    await children[2].finish(2);
    const runD = runtime.start(packet({ profile: 'verify', thinking: 'low', dispatchTurnId: 'turn-3' }));
    children[3].emitEvent(start('ses_D'));
    await children[3].finish(0);
    runtime.router.retire(runD.workerId, 'context 300001 > 300000');

    // Another workspace's worker must not appear.
    runtime.start(packet({ workspacePath: wsB }));
    await tick();

    const state = JSON.parse(JSON.stringify(projectWorkersState(runtime, wsA, now)));
    assert.deepEqual(state.server, { state: 'NOT_ATTACHED', endpoint: '' });
    assert.equal(state.generatedAt, clock);
    assert.equal(state.workers.length, 3, 'workspace filter keeps only wsA workers');

    const a = state.workers.find((w) => w.workerId === run1.workerId);
    assert.deepEqual([a.state, a.adapter, a.profile, a.model, a.thinking], ['WAITING_APPROVAL', 'opencode', 'code', 'github-copilot/gpt-5.6-terra', 'high']);
    assert.equal(a.blocker, 'waiting for approval in OpenCode');
    assert.deepEqual([a.sessionId, a.sessionOpenAction], ['ses_A', 'opencode --session ses_A']);
    assert.equal(a.contextTokens, 1250, 'historical/cached context of the reused worker');
    assert.deepEqual(a.runs.map((r) => [r.runId, r.state, r.queuePosition]),
        [[run1.runId, 'COMPLETED', 0], [run2.runId, 'WAITING_APPROVAL', 0], [run3.runId, 'STARTING', 1]]);
    const [t1, t2] = a.runs;
    assert.deepEqual([t1.elapsedMs, t1.usage.cost, t1.usage.input, t1.usage.output, t1.usage.cacheRead], [4000, 0.0021, 1200, 340, 50]);
    assert.deepEqual([t2.dispatchTurnId, t2.usage.cost, t2.usage.input, t2.usage.output, t2.usage.cacheRead], ['turn-2', 0.0004, 300, 20, 1500],
        'per-run cost resets while reused cached input stays visible');
    assert.equal(a.usage.cost, 0.0021 + 0.0004);
    assert.equal(a.usage.input, 1500);
    assert.equal(a.lastUpdateAt, 1_000_000 + 7000, 'last update is the approval event time');

    const c = state.workers.find((w) => w.workerId === runC.workerId);
    assert.deepEqual([c.state, c.blocker, c.model, c.sessionOpenAction], ['FAILED', 'exit code 2', 'github-copilot/gpt-5.6-luna', 'opencode --session ses_C']);
    const d = state.workers.find((w) => w.workerId === runD.workerId);
    assert.deepEqual([d.state, d.blocker, d.thinking], ['RETIRED', 'retired: context 300001 > 300000', 'low']);

    const serialized = JSON.stringify(state);
    assert.doesNotMatch(serialized, /SECRET-OBJECTIVE|TRANSCRIPT-TEXT|MATH-TEST|Objective:|"evidence"|"packet"/i, 'no packet or transcript text');
    assert.doesNotMatch(serialized, /"(approve|reject|allow|deny|respond)\w*"\s*:/i, 'no approval-command keys');

    // The shared server endpoint is reported when workers attach to it.
    const attached = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner, now, attachUrl: 'http://127.0.0.1:4096' });
    assert.deepEqual(projectWorkersState(attached, wsA, now).server, { state: 'ATTACHED', endpoint: 'http://127.0.0.1:4096' });

    // A reloaded host shares the ledger, so its first worker and run IDs must not collide with earlier ones.
    const reloaded = attached.start(packet());
    assert.notEqual(reloaded.workerId, run1.workerId);
    assert.notEqual(reloaded.runId, run1.runId);

    console.log(`EV-014 WorkersStateProjection: PASS workers=${state.workers.length} runs=${a.runs.length + c.runs.length + d.runs.length} filteredOut=1 transcriptKeys=0 approvalKeys=0`);

    // Session open: only a projected worker's session, never an arbitrary string reaching the terminal.
    const { sessionOpenCommand } = require(path.join(buildDir, 'workersState.js'));
    assert.equal(sessionOpenCommand(state, 'ses_A'), 'opencode --session ses_A');
    assert.equal(sessionOpenCommand(state, 'ses_unknown'), undefined);
    assert.equal(sessionOpenCommand(state, 'ses_A; rm -rf ~'), undefined);

    // The webview's own render code, run as the tab runs it.
    const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
    const from = webview.indexOf('// ── Workers tab: pure render');
    const to = webview.indexOf('// ── end Workers pure render ──');
    assert.ok(from > 0 && to > from, 'Workers render block present');
    const ui = {};
    require('node:vm').runInNewContext(`${webview.slice(from, to)}\nout.render = renderWorkersHtml; out.pending = workersPendingApprovals;`, { out: ui });

    const all = ui.render(state, '', {});
    assert.equal((all.match(/class="worker-card"/g) || []).length, 3);
    assert.match(all, /1 worker waiting for approval\. Open the session in OpenCode/);
    assert.match(all, /Server: NOT_ATTACHED/);
    assert.equal(ui.pending(state), 1);
    const onlyVerify = ui.render(state, 'verify', {});
    assert.equal((onlyVerify.match(/class="worker-card"/g) || []).length, 2, 'filter by mode');
    assert.doesNotMatch(onlyVerify, new RegExp(run1.workerId));
    assert.match(ui.render(state, 'nothing-matches', {}), /No worker matches the filter/);
    assert.match(ui.render({ ...state, workers: [] }, '', {}), /No workers in this workspace yet/);

    const openA = ui.render(state, '', { [run1.workerId]: true });
    const openButtons = openA.match(/data-worker-action="open" data-session-id="[^"]*"/g) || [];
    assert.deepEqual(openButtons.sort(), ['ses_A', 'ses_C', 'ses_D'].map((id) => `data-worker-action="open" data-session-id="${id}"`));
    assert.equal((openA.match(/<tr data-run-id=/g) || []).length, 3, 'expanded trace lists every run');
    assert.match(openA, new RegExp(`data-run-id="${run1.runId}"><td>${run1.runId}</td><td>COMPLETED</td><td>turn-1</td><td>4s</td><td>\\$0\\.0021</td><td>1\\.2K</td><td>340</td><td>50</td>`));
    assert.match(openA, new RegExp(`data-run-id="${run3.runId}"><td>${run3.runId}</td><td>STARTING #1</td>`), 'queued run shows its position');
    assert.match(openA, /gpt-5\.6-terra · high/);
    assert.match(openA, /\$0\.0025 · in 1\.5K · out 360 · cached 1\.6K · ctx 1\.3K/);
    const actions = [...openA.matchAll(/data-worker-action="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(actions)].sort(), ['open', 'open-external', 'trace'], 'no approval or conversation controls');
    assert.equal((openA.match(/data-worker-action="open-external" data-session-id="ses_A"/g) || []).length, 1, 'terminal-app open targets the same session');
    assert.doesNotMatch(openA, /SECRET-OBJECTIVE|TRANSCRIPT-TEXT|<textarea/);
    const hostile = { ...state, workers: [{ ...state.workers[0], profile: '<img src=x onerror=alert(1)>' }] };
    assert.doesNotMatch(ui.render(hostile, '', {}), /<img/, 'worker fields are escaped');
    console.log(`EV-015 WorkersViewInteraction: PASS cards=3 filtered=2 openTargets=${openButtons.length} traceRows=3 pendingApproval=1`);

    const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
    for (const selector of ['.workers-filter', '.worker-state-waiting_approval', '.worker-state-failed', '.worker-trace', '.workers-approval-notice', '.worker-open-btn']) {
        assert.ok(css.includes(selector), `style for ${selector}`);
    }
    console.log('EV-016 WorkersControlPlanePresentation: PASS selectors=6');

    const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
    assert.match(provider, /data-tab="workers"/);
    assert.match(provider, /id="panel-workers"/);
    assert.match(provider, /sessionOpenCommand\(this\._workersStateSource\(root\), sessionId\)/, 'open-session goes through the allowlist');
    assert.match(provider, /if \(external\) \{ openInTerminalApp\(command, root\); return; \}/, 'terminal-app open uses the same allowlisted command');
    const terminalJs = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', 'terminalApp.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    fs.writeFileSync(path.join(buildDir, 'terminalApp.js'), terminalJs);
    const { terminalAppLaunch } = require(path.join(buildDir, 'terminalApp.js'));
    const mac = terminalAppLaunch('opencode --session ses_A', "/work/it's here", 'darwin', '/tmp/x');
    assert.equal(mac.file, 'open');
    assert.equal(mac.args[0], mac.script.path);
    assert.match(mac.script.path, /^\/tmp\/x\/opencode-session-\d+\.command$/);
    assert.equal(mac.script.content, "#!/bin/zsh -l\ncd '/work/it'\\''s here'\nopencode --session ses_A\n", 'cwd is shell-quoted');
    assert.deepEqual(terminalAppLaunch('opencode --session ses_A', '/w', 'linux').args, ['-e', 'sh', '-c', "cd '/w' && opencode --session ses_A; exec sh"]);
    assert.match(webview, /case 'workersState':\s*applyWorkersState\(message\.data\)/);
    console.log('EV-017 WorkersUiBoundary: PASS transcriptKeys=0 approvalActions=0 sessionAllowlist=true');
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
