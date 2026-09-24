// CY-005 Workers view state, observed as the webview receives it. Run: node test-workers-control-plane.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-workers-state-'));
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'evalScoreboard']) {
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
    children[0].emitEvent({ type: 'tool_use', sessionID: 'ses_A', part: { id: 'prt_t1', callID: 'call_EDIT1', tool: 'edit',
        state: { status: 'completed', input: { filePath: 'math.js' }, output: 'Edit applied', time: { start: 100, end: 1350 } } } });
    children[0].emitEvent({ ...finish('ses_A', 1200, 340, 50, 0.0021), part: { ...finish('ses_A', 1200, 340, 50, 0.0021).part, id: 'prt_STEP1' } });
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
    assert.equal(a.nextInputTokens, 300 + 1500 + 20, 'next input = last prompt (input + cache) + last output, live while running');
    assert.deepEqual([a.expired, a.cacheExpiresAt], [false, 0], 'a running worker has no cache countdown');
    assert.deepEqual(a.runs.map((r) => [r.runId, r.state, r.queuePosition]),
        [[run1.runId, 'COMPLETED', 0], [run2.runId, 'WAITING_APPROVAL', 0], [run3.runId, 'STARTING', 1]]);
    const [t1, t2] = a.runs;
    assert.deepEqual([t1.elapsedMs, t1.usage.cost, t1.usage.input, t1.usage.output, t1.usage.cacheRead], [4000, 0.0021, 1200, 340, 50]);
    assert.deepEqual([t2.dispatchTurnId, t2.usage.cost, t2.usage.input, t2.usage.output, t2.usage.cacheRead], ['turn-2', 0.0004, 300, 20, 1500],
        'per-run cost resets while reused cached input stays visible');
    assert.equal(a.usage.cost, 0.0021 + 0.0004);
    // The run trace is in the Metrics turn-trace format: each request row leads the tools it decided.
    assert.deepEqual(t1.events.map((e) => [e.kind, e.id, e.model || e.tool]), [['request', 'STEP1', 'gpt-5.6-terra'], ['tool', 'EDIT1', 'edit']]);
    assert.deepEqual([t1.events[0].inputTokens, t1.events[0].cachedTokens, t1.events[0].dollars], [1250, 50, 0.0021], 'input is the full prompt, as in Metrics');
    assert.deepEqual([t1.events[1].durMs, t1.events[1].status, t1.events[1].inputPreview, t1.events[1].outputPreview], [1250, 'ok', '', ''], 'ledger facts carry no tool text');
    const ledgerText = fs.readdirSync(ledgerDir).map((f) => fs.readFileSync(path.join(ledgerDir, f), 'utf8')).join('');
    assert.doesNotMatch(ledgerText, /Edit applied|math\.js/, 'the ledger keeps facts only; OpenCode owns the transcript');
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
    const bannerFrom = webview.indexOf('// ── Usage banner');
    const bannerTo = webview.indexOf('// ── end Usage banner ──');
    assert.ok(bannerFrom > 0 && bannerTo > bannerFrom, 'shared usage banner block present');
    const traceFrom = webview.indexOf('// ── Turn trace rows: pure render');
    const traceTo = webview.indexOf('// ── end Turn trace rows ──');
    assert.ok(traceFrom > 0 && traceTo > traceFrom, 'shared turn-trace block present');
    require('node:vm').runInNewContext(`${webview.slice(bannerFrom, bannerTo)}\n${webview.slice(traceFrom, traceTo)}\n${webview.slice(from, to)}\nout.render = renderWorkersHtml; out.pending = workersPendingApprovals; out.refs = workerRefsFromPreview; out.badge = workerRefBadge; out.chatBanner = usageBannerHtml; out.trace = traceRowsHtml;`, { out: ui });

    // Metrics turn trace: a worker tool's JSON output yields a worker/run badge that links to this tab.
    assert.deepEqual(JSON.parse(JSON.stringify(ui.refs('{"runId":"run-84lnfg-4","workerId":"worker-84lnfg-3","state":"STARTING"}'))), { workerId: 'worker-84lnfg-3', runId: 'run-84lnfg-4' });
    assert.equal(ui.refs('{"status":"ok"}'), null);
    assert.equal(ui.badge(ui.refs('{"workerId":"worker-a-1"}')), '<span class="obs-worker-tag" data-worker-ref="worker-a-1" title="Show this worker in the Workers tab">worker-a-1</span> ');
    assert.match(webview, /workerRefBadge\(workerRefsFromPreview\(ev\.outputPreview\)\)/, 'turn-trace tool rows carry the badge');
    assert.match(webview, /eventTbody\.innerHTML = traceRowsHtml\(events, /, 'the Metrics timeline renders through the shared trace block');

    const all = ui.render(state, '', {});
    assert.equal((all.match(/class="worker-card"/g) || []).length, 2, 'the retired worker is hidden');
    assert.doesNotMatch(all, /expired worker|toggle-expired/, 'no inline expired button; the header switch controls it');
    const withExpired = ui.render(state, '', {}, true);
    assert.equal((withExpired.match(/class="worker-card"/g) || []).length, 3, 'the toggle reveals the retired worker');
    assert.match(all, /<span class="worker-banner-metrics">1 req &middot; <strong class="health-cost">\$0\.0004<\/strong> &middot; 1\.80K last in \/ 20 turn out &middot; 83% cache<\/span><strong class="health-cache warm">Age: 0:00 warm<\/strong>/,
        'running worker: the chat banner for its current run');
    assert.ok(all.includes(ui.chatBanner(a.banner)), 'the card uses exactly the chat banner template');
    assert.match(all, /0 reqs &middot; <strong class="health-cost">\$0\.00<\/strong> &middot; 0 last in \/ 0 turn out &middot; – cache/, 'idle worker with no requests');
    assert.match(all, /1 worker waiting for approval\. Open the session in OpenCode/);
    assert.match(all, /Shared OpenCode server not running · starts with the first worker/);
    assert.match(ui.render({ ...state, server: { state: 'ATTACHED', endpoint: 'http://127.0.0.1:4096' } }, '', {}), /Shared OpenCode server · http:\/\/127\.0\.0\.1:4096/);
    assert.equal(ui.pending(state), 1);
    const onlyVerify = ui.render(state, 'verify', {});
    assert.equal((onlyVerify.match(/class="worker-card"/g) || []).length, 1, 'filter by mode');
    assert.doesNotMatch(onlyVerify, new RegExp(run1.workerId));
    assert.match(ui.render(state, 'nothing-matches', {}), /No worker matches the filter/);
    assert.match(ui.render({ ...state, workers: [] }, '', {}), /No live workers in this workspace\./);

    const openA = ui.render(state, '', { [run1.workerId]: true });
    const openButtons = openA.match(/data-worker-action="open" data-session-id="[^"]*"/g) || [];
    assert.deepEqual(openButtons.sort(), ['ses_A', 'ses_C'].map((id) => `data-worker-action="open" data-session-id="${id}"`));
    assert.equal((openA.match(/<tr class="worker-run-partition" data-run-id=/g) || []).length, 3, 'one partition per run in the worker conversation');
    assert.match(openA, new RegExp(`data-run-id="${run1.runId}"><td colspan="7"><span class="worker-state worker-state-completed">COMPLETED</span> <span class="obs-req-id">${run1.runId}</span> · turn turn-1 · 4s · \\$0\\.0021 · 1 req</td>`));
    assert.match(openA, /worker-state-starting">STARTING #1<\/span>[\s\S]*?Queued/, 'queued run shows its position');
    assert.ok(openA.includes(ui.trace(t1.events, { openIds: {} })), 'run rows are exactly the Metrics trace rows');
    assert.match(openA, /<thead><tr><th>ID<\/th><th>Model \/ Tool<\/th><th>Credits<\/th><th>Input<\/th><th>Output<\/th><th>Cached<\/th><th title="cached \/ input">Hit%<\/th><\/tr><\/thead>/, 'same columns as Metrics');
    assert.match(openA, /<span class="obs-req-id">STEP1<\/span><\/td><td class="obs-scope">gpt-5\.6-terra<\/td><td>\$0\.0021<\/td><td>1\.25K<\/td><td>340<\/td><td>50<\/td><td class="obs-cache-risk">4%<\/td>/);
    assert.match(openA, /<details class="obs-tl-item obs-tl-tool" data-eid="t:EDIT1:1">[\s\S]*?edit<\/span>[\s\S]*?1\.25s/, 'ledger facts render as Metrics tool rows before the session loads');
    const kept = ui.render(state, '', { [run1.workerId]: true }, false, { 't:EDIT1:1': true });
    assert.match(kept, /data-eid="t:EDIT1:1" open>/, 'an expanded row stays open across the 1s re-render');

    // Expanding a trace reads the worker's OpenCode session (shape of GET /session/:id/message) for real tool input and output.
    const { loadWorkerTrace } = require(path.join(buildDir, 'workersState.js'));
    const at = (ms) => a.runs[0].startedAt + ms;
    const session = [
        { info: { role: 'user', time: { created: at(1) } }, parts: [{ type: 'text', text: 'packet' }] },
        { info: { role: 'assistant', modelID: 'gpt-5.6-terra', time: { created: at(2) } }, parts: [
            { type: 'step-start' },
            { type: 'tool', callID: 'call_N0kFHF5QnlLjX7Z0NDtTAtGE', tool: 'bash', state: { status: 'completed', input: { command: 'ls /tmp/aa-evals/sim' }, output: 'wordcount.js\nwordcount.test.js', time: { start: 10, end: 50 } } },
            { type: 'step-finish', id: 'prt_0d402f213001xlo939tIFPQjy9', tokens: { input: 5827, output: 43, cache: { read: 0, write: 0 } }, cost: 0.0015322 },
        ] },
        { info: { role: 'assistant', modelID: 'gpt-5.6-terra', time: { created: a.runs[1].startedAt + 5 } }, parts: [
            { type: 'step-finish', id: 'prt_0d4030d29001xjnNWcklEY3tcU', tokens: { input: 66, output: 108, cache: { read: 6121, write: 0 } }, cost: 0.00026837 },
        ] },
    ];
    const fetched = [];
    const trace = JSON.parse(JSON.stringify(await loadWorkerTrace(state, run1.workerId, async (sid) => { fetched.push(sid); return session; })));
    assert.deepEqual(fetched, ['ses_A'], 'reads exactly this worker\'s session');
    assert.deepEqual(trace.runs[run1.runId].map((e) => [e.kind, e.id, e.tool || e.model]), [['request', 'PQJY9', 'gpt-5.6-terra'], ['tool', 'TATGE', 'bash']]);
    assert.deepEqual(trace.runs[run2.runId].map((e) => e.id), ['Y3TCU'], 'a message belongs to the run that was active when it was written');
    assert.deepEqual(trace.runs[run3.runId], [], 'a queued run owns no messages');
    const withSession = ui.render(state, '', { [run1.workerId]: true }, false, {}, { [run1.workerId]: trace });
    assert.ok(withSession.includes(ui.trace(trace.runs[run1.runId], { openIds: {} })), 'session rows are the Metrics trace rows');
    assert.match(withSession, /<pre class="obs-tl-pre">\{&quot;command&quot;:&quot;ls \/tmp\/aa-evals\/sim&quot;\}<\/pre>[\s\S]*?<pre class="obs-tl-pre">wordcount\.js\nwordcount\.test\.js<\/pre>/, 'tool input and output are shown');
    const down = JSON.parse(JSON.stringify(await loadWorkerTrace(state, run1.workerId, async () => { throw new Error('ECONNREFUSED'); })));
    assert.match(ui.render(state, '', { [run1.workerId]: true }, false, {}, { [run1.workerId]: down }), /Tool input and output unavailable: OpenCode server did not answer \(ECONNREFUSED\)/);
    assert.match(webview, /type: 'requestWorkerTrace', workerId: id/, 'expanding a trace requests it');
    assert.match(webview, /if \(workersPointerDown\) return;/, 'a re-render never lands between pointerdown and click, so rows collapse on click');
    assert.match(fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8'), /case 'requestWorkerTrace':/);
    console.log('EV-038 SharedTraceRows: PASS metricsBlock=traceRowsHtml workerRowsContainMetricsRows=true partitionsPerRun=3 expandKept=true toolText=fromOpenCodeSession ledgerText=0');
    assert.match(openA, /gpt-5\.6-terra · high/);
    clock += 301_000;
    const later = JSON.parse(JSON.stringify(projectWorkersState(runtime, wsA, now)));
    assert.deepEqual(later.workers.filter((w) => !w.expired).map((w) => w.workerId), [run1.workerId], 'after 5 min idle the failed worker expires; the running one stays');
    assert.match(ui.render(later, '', {}), /class="worker-card"/);
    assert.equal((ui.render(later, '', {}).match(/class="worker-card"/g) || []).length, 1, 'two expired workers are hidden');
    // Age counts up with the clock, not only when a new state arrives.
    const ageAt = (ms) => (ui.render({ ...state, generatedAt: state.generatedAt + ms }, '', {}).match(/Age: (\d:\d\d) (warm|cold)/) || [])[1];
    assert.deepEqual([ageAt(0), ageAt(7000), ageAt(65_000)], ['0:00', '0:07', '1:05'], 'Age advances as time passes');
    assert.match(webview, /generatedAt: Date\.now\(\) - workersClockSkew/, 'the tab re-renders with the current clock every second');
    const actions = [...openA.matchAll(/data-worker-action="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(actions)].sort(), ['cancel-run', 'open', 'open-external', 'trace'], 'no approval or conversation controls');
    // Cancel-before-start from the tab: only the queued run offers it, and only this workspace's queued run is cancelled.
    assert.deepEqual([...openA.matchAll(/data-worker-action="cancel-run" data-run-id="([^"]+)"/g)].map((m) => m[1]), [run3.runId]);
    assert.match(webview, /type: 'cancelQueuedWorkerRun', runId: btn\.getAttribute\('data-run-id'\)/);
    const { cancelQueuedRun } = require(path.join(buildDir, 'workersState.js'));
    assert.equal(cancelQueuedRun(runtime, wsA, run1.runId).status, 'NOT_CANCELLABLE', 'a finished run cannot be cancelled');
    assert.equal(cancelQueuedRun(runtime, wsA, run2.runId).status, 'NOT_CANCELLABLE', 'a started run is not cancelled from the tab');
    const otherWs = runtime.list(wsB)[0].runId;
    assert.equal(cancelQueuedRun(runtime, wsA, otherWs).status, 'NOT_CANCELLABLE', 'another workspace\'s run is out of reach');
    assert.equal(cancelQueuedRun(runtime, wsA, run3.runId).status, 'CANCELLATION_REQUESTED');
    const afterCancel = projectWorkersState(runtime, wsA, now).workers.find((w) => w.workerId === run1.workerId);
    assert.deepEqual([afterCancel.state, afterCancel.runs.find((r) => r.runId === run3.runId).state], ['WAITING_APPROVAL', 'CANCELLED'], 'the queued run is cancelled; the worker keeps its state');

    // Eval scoreboard: results ledger → mode × model rows in the Metrics table, collapsed until opened.
    const { loadEvalScoreboard } = require(path.join(buildDir, 'evalScoreboard.js'));
    const resultsFile = path.join(ledgerDir, 'results.jsonl');
    const result = (mode, model, verdict, cost, durationMs, ts) => JSON.stringify({ ts, suite: 'workers', mode, model, variant: 'low', verdict, usage: { cost }, durationMs });
    fs.writeFileSync(resultsFile, [
        result('code', 'github-copilot/gpt-5.6-luna', 'PASS', 0.002, 10000, '2026-09-24T01:00:00Z'),
        result('code', 'github-copilot/gpt-5.6-luna', 'FAIL', 0.004, 20000, '2026-09-24T02:00:00Z'),
        '{corrupt',
        result('verify', 'github-copilot/gpt-5.6-luna', 'PASS', 0.001, 5000, '2026-09-24T03:00:00Z'),
    ].join('\n'));
    const board = loadEvalScoreboard(resultsFile);
    assert.deepEqual(board.map((r) => [r.mode, r.model, r.runs, r.passed, +r.avgCost.toFixed(4), r.avgMs]),
        [['code', 'gpt-5.6-luna', 2, 1, 0.003, 15000], ['verify', 'gpt-5.6-luna', 1, 1, 0.001, 5000]], 'malformed lines skipped');
    assert.deepEqual(loadEvalScoreboard(path.join(ledgerDir, 'missing.jsonl')), []);
    const withBoard = ui.render({ ...state, scoreboard: board }, '', {});
    assert.match(withBoard, /<details class="obs-tl-item workers-scoreboard" data-eid="evals">[\s\S]*?3 runs · 2 mode\/model pairs/);
    assert.match(withBoard, /<td class="obs-scope">code<\/td><td>gpt-5\.6-luna · low<\/td><td>1\/2<\/td><td class="obs-cache-risk">50%<\/td><td>\$0\.0030<\/td><td>15\.0s<\/td>/, 'low pass rate is flagged like a cache miss');
    assert.match(ui.render({ ...state, scoreboard: board }, '', {}, false, { evals: true }), /data-eid="evals" open>/, 'stays open across re-renders');
    assert.match(ui.render({ ...state, workers: [], scoreboard: board }, '', {}), /No live workers[\s\S]*Eval scoreboard/, 'shown even with no workers');
    assert.doesNotMatch(ui.render(state, '', {}), /Eval scoreboard/, 'hidden when there are no results');
    console.log(`EV-015b WorkersQueueAndEvals: PASS cancelQueued=true refused=3 scoreboardRows=${board.length} malformedSkipped=1`);

    // The tab answers "how many are there" and "how do I spend less" before any card.
    assert.match(all, /^<div class="workers-summary"><strong>2<\/strong> live workers &middot; 1 running &middot; 1 queued &middot; 1 warm &middot; 1 completed &middot; <strong class="health-cost">\$0\.0025<\/strong> spent<\/div>/);
    assert.match(all, new RegExp(`<div class="workers-tips"><div class="workers-tips-head">Save cost</div><div class="workers-tip">Reuse verify worker ${runC.workerId} for the next verify packet: its cache is warm for 5:00`));
    const tipsWithBoard = ui.render({ ...state, scoreboard: [
        { mode: 'code', model: 'gpt-5.6-terra', variant: 'high', runs: 3, passed: 2, avgCost: 0.01, avgMs: 1 },
        { mode: 'code', model: 'gpt-5.6-luna', variant: 'low', runs: 4, passed: 4, avgCost: 0.002, avgMs: 1 },
    ] }, '', {});
    assert.match(tipsWithBoard, /For code, gpt-5\.6-luna passed 4\/4 evals at \$0\.0020 vs gpt-5\.6-terra at \$0\.0100: try gpt-5\.6-luna first\./, 'the scoreboard points at a cheaper model that passes as often');
    const bloated = { ...state, workers: state.workers.map((w) => w.workerId === run1.workerId ? { ...w, nextInputTokens: 250000, banner: { ...w.banner, requests: 3, lastIn: 1000, lastCached: 100 } } : w) };
    assert.match(ui.render(bloated, '', {}), new RegExp(`${run1.workerId} re-sends 250K tokens per request`));
    assert.match(ui.render(bloated, '', {}), /last request hit only 10% cache: send its packets back to back, within 5 minutes\./);
    // Swimlanes appear only when packets name a track; untracked workers go last.
    assert.doesNotMatch(all, /workers-lane/, 'no lanes without tracks');
    const tracked = { ...state, workers: state.workers.map((w) => w.workerId === runC.workerId ? { ...w, track: 'B' } : w.workerId === run1.workerId ? { ...w, track: 'A' } : w) };
    const lanes = [...ui.render(tracked, '', {}, true).matchAll(/<div class="workers-lane" data-track="([^"]*)">([^<]*)/g)].map((m) => m[2]);
    assert.deepEqual(lanes, ['Track A &middot; 1 worker &middot; ', 'Track B &middot; 1 worker &middot; ', 'No track &middot; 1 worker &middot; ']);
    const trackRuntime = new OpenCodeWorkerRuntime(profiles, { ledgerDir: fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-track-')), spawner, now });
    trackRuntime.start(packet({ track: 'A' }));
    assert.equal(projectWorkersState(trackRuntime, wsA, now).workers[0].track, 'A', 'the packet track reaches the tab');
    console.log('EV-015c WorkersSummaryTipsLanes: PASS summary=counts+spend tips=reuse,bloat,cacheMiss,cheaperModel lanes=byTrack');
    assert.equal((openA.match(/data-worker-action="open-external" data-session-id="ses_A"/g) || []).length, 1, 'terminal-app open targets the same session');
    assert.doesNotMatch(openA, /SECRET-OBJECTIVE|TRANSCRIPT-TEXT|<textarea/);
    const hostile = { ...state, workers: [{ ...state.workers[0], profile: '<img src=x onerror=alert(1)>' }] };
    assert.doesNotMatch(ui.render(hostile, '', {}), /<img/, 'worker fields are escaped');
    console.log(`EV-015 WorkersViewInteraction: PASS cards=2 hiddenExpired=1 banner=sharedTemplate trace=metricsRows partitions=3 filtered=1 openTargets=${openButtons.length} pendingApproval=1`);

    const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
    for (const selector of ['.workers-filter', '.worker-state-waiting_approval', '.worker-state-failed', '.worker-run-partition', '.workers-approval-notice', '.worker-open-btn']) {
        assert.ok(css.includes(selector), `style for ${selector}`);
    }
    console.log('EV-016 WorkersControlPlanePresentation: PASS selectors=6');

    const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
    assert.match(provider, /data-tab="workers"/);
    assert.match(provider, /id="panel-workers"/);
    assert.match(provider, /<span>Show completed<\/span>\s*<div class="toggle-switch specs-toggle-switch" id="workers-show-expired" role="switch"/, 'the same switch as the Specs tab');
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
