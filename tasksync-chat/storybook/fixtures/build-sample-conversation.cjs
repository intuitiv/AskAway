// Records a sample two-turn conversation for Storybook through the REAL runtime, `worker` tool, and commentary store.
// Only OpenCode is faked. Run from tasksync-chat/: node storybook/fixtures/build-sample-conversation.cjs
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const root = path.join(__dirname, '..', '..');
const ts = require(path.join(root, 'node_modules', 'typescript'));

const buildDir = path.join(root, '.sample-conversation-build');
fs.rmSync(buildDir, { recursive: true, force: true });
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools', 'commentary/commentary']) {
    const out = path.join(buildDir, `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(root, 'src', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const load = (name) => require(path.join(buildDir, `${name}.js`));
const { parseWorkerProfile } = load('workers/workerProfiles');
const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime');
const { projectWorkersState } = load('workers/workersState');
const { workerTool } = load('workers/workerTools');
const { CommentaryStore, commentaryToolDefinitions, commentaryView } = load('commentary/commentary');

const profile = (name, model, thinking, edit = 'deny') => parseWorkerProfile(`---\nname: ${name}\ndescription: "${name}"\ntier: light\nmodel: github-copilot/${model}\nthinking: ${thinking}\n`
    + `models: [github-copilot/${model}]\nthinkingOptions: [${thinking}]\nedit: ${edit}\n---\nBody.\n`);
const profiles = [profile('code', 'gpt-5.6-terra', 'high', 'allow'), profile('explore', 'gpt-5.6-luna', 'low'), profile('verify', 'gpt-5.6-luna', 'low')];

const ws = '/Users/reviewer/projects/askaway-demo';
let clock = new Date(2026, 8, 25, 17, 45, 0).getTime();
const now = () => clock;
const children = [];
const spawner = (args) => {
    const child = new EventEmitter();
    child.args = args;
    child.stdout = new PassThrough();
    child.kill = () => true;
    children.push(child);
    return child;
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-sample-ledger-'));
const runtime = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner, now, attachUrl: 'http://127.0.0.1:4096' });
const store = new CommentaryStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aa-sample-commentary-')), now });
const worker = workerTool(() => runtime, ws);
const [commentary] = commentaryToolDefinitions(() => store, ws);

const frames = [];
const chat = [];
const turnStarts = [];
let turn = '';
// The prompt hook marks each turn start; the sample does the same when the reviewer sends a message.
const userSays = (text) => { later(1); turnStarts.push(clock); chat.push({ role: 'user', text }); };
const snap = (caption) => {
    const state = projectWorkersState(runtime, ws, now);
    frames.push({ at: clock, caption, chat: chat.slice(), commentary: commentaryView(store.read(ws), turnStarts.slice()), workers: { ...state, scoreboard: [] } });
};
const say = async (kind, text) => { await commentary.run({ kind, text, turnId: turn }); };
const spawnedFor = new Map();
const act = async (action, args) => {
    const before = children.length;
    const result = await worker.run({ action, ...args });
    if (children.length > before && result.runId) { spawnedFor.set(result.runId, children[children.length - 1]); }
    return result;
};
const packet = (profileName, objective, extra) => ({ profile: profileName, dispatchTurnId: turn, baseRevision: 'HEAD', objective,
    allowedFiles: [], acceptance: 'The command prints the expected line.', expected: 'Result: PASS', command: 'node truncate.test.js', ...extra });
const childOf = (run) => {
    const child = spawnedFor.get(run.runId);
    if (!child) { throw new Error(`no OpenCode child for ${run.runId} (${JSON.stringify(run)})`); }
    return child;
};
const step = async (child, sid, { input, cached = 0, output = 60, cost, tool, text }) => {
    const emit = (event) => child.stdout.write(`${JSON.stringify({ sessionID: sid, ...event })}\n`);
    emit({ type: 'step_start', part: {} });
    if (tool) { emit({ type: 'tool_use', part: { id: `prt_${tool}_${clock}`, callID: `call_${tool}_${clock}`, tool, state: { status: 'completed', input: { filePath: 'src/truncate.js' }, output: 'ok', time: { start: clock - 900, end: clock } } } }); }
    emit({ type: 'step_finish', part: { id: `prt_step_${clock}`, tokens: { input, output, reasoning: 0, cache: { read: cached, write: 0 } }, cost } });
    if (text) { emit({ type: 'text', part: { type: 'text', text } }); }
    await tick();
};
const exit = async (child) => { child.emit('exit', 0, null); await tick(); };
const later = (seconds) => { clock += seconds * 1000; };

(async () => {
    // ── Turn 1 ──
    turn = 'turn-1';
    userSays('Add a truncate(text, max) helper with a test, and tell me where listenWhenFree is defined.');
    await say('update', '🏏 Plan: **two tracks** — build truncate, and locate listenWhenFree; each checked by another worker.');
    snap('The orchestrator plans two independent tracks.');
    later(4);
    const a = await act('start', packet('code', 'Write src/truncate.js and its test.', { track: 'A', allowedFiles: ['src/truncate.js', 'test/truncate.test.js'] }));
    const b = await act('start', packet('explore', 'Find listenWhenFree and its caller, path:line.', { track: 'B', command: 'rg -n listenWhenFree src' }));
    await say('update', '🚀 **Both tracks started at once**; they touch no shared files.');
    snap('Two workers start in parallel, one lane per track.');
    later(9);
    await step(childOf(a), 'ses_A', { input: 9800, cost: 0.0031, tool: 'write' });
    await step(childOf(b), 'ses_B', { input: 8400, cost: 0.0019, tool: 'grep' });
    snap('Workers report steps, tokens and cost as they go.');
    later(7);
    await step(childOf(b), 'ses_B', { input: 120, cached: 8400, cost: 0.0006, text: 'Result: PASS\nEvidence: src/mcp/sharedPort.ts:4, caller src/mcp/mcpServer.ts:375\nKnowledge: knows the MCP port code' });
    await exit(childOf(b));
    await say('update', '📦 Locator found **the definition and one caller**; a separate checker confirms next.');
    const bv = await act('start', packet('verify', 'Re-derive the listenWhenFree location independently.', { track: 'B', command: 'rg -n listenWhenFree src' }));
    snap('Track B is back; an independent verifier re-derives it.');
    later(6);
    await step(childOf(a), 'ses_A', { input: 300, cached: 9800, cost: 0.0012, text: 'Result: PASS\nEvidence: TRUNCATE-TEST: PASS\nKnowledge: knows truncate.js and its test' });
    await exit(childOf(a));
    await step(childOf(bv), 'ses_BV', { input: 8700, cost: 0.0024, tool: 'grep', text: 'Result: PASS\nEvidence: sharedPort.ts:4, mcpServer.ts:375' });
    await exit(childOf(bv));
    await say('update', '✅ **listenWhenFree accepted**: the checker found the same definition and caller.');
    const av = await act('start', packet('verify', 'Run node test/truncate.test.js and report the last line.', { track: 'A' }));
    await say('update', '🚀 Builder says truncate passes; a **different checker** now runs the test itself.');
    snap('The builder never marks its own homework: a verifier runs the test.');
    later(8);
    await step(childOf(av), 'ses_AV', { input: 8100, cost: 0.0021, tool: 'bash', text: 'Result: PASS\nEvidence: TRUNCATE-TEST: PASS\nKnowledge: ran the truncate test' });
    await exit(childOf(av));
    await say('update', '✅ **Truncate accepted**: a separate checker saw the test pass.');
    later(2);
    await say('update', '🏆 **Both tracks accepted**, 2 of 2, in 36 seconds. Cost ==about one cent==.');
    chat.push({ role: 'assistant', text: 'Both tracks accepted. truncate.js + test (TRUNCATE-TEST: PASS, run by a separate checker); listenWhenFree is defined in src/mcp/sharedPort.ts:4 and called from src/mcp/mcpServer.ts:375. Worker cost about $0.011.' });
    snap('Turn 1 done: its lines stay flat until the next prompt.');

    // ── Turn 2: the previous turn's pane collapses ──
    later(70);
    turn = 'turn-2';
    userSays('Make truncate safe for emoji.');
    snap('A new turn starts: everything so far folds into one collapsed pane.');
    later(2);
    await say('update', '🏏 Plan: **reuse the warm builder** for emoji support, then the warm checker runs the test.');
    snap('The new turn\'s lines appear below the folded pane.');
    later(3);
    const a2 = await act('submit', { workerId: a.workerId, ...packet('code', 'Make truncate count emoji as one character; extend the test.', { track: 'A', allowedFiles: ['src/truncate.js', 'test/truncate.test.js'] }) });
    await say('heads-up', '❓ Should a flag emoji like 🇮🇳 count as **one character or two**? I will assume one.');
    snap('Reusing a warm worker keeps its cache; a heads-up asks the one open question.');
    later(10);
    await step(childOf(a2), 'ses_A', { input: 400, cached: 10100, cost: 0.0014, tool: 'edit', text: 'Result: PASS\nEvidence: TRUNCATE-TEST: PASS (6 cases)\nKnowledge: knows truncate.js, emoji-safe' });
    await exit(childOf(a2));
    const av2 = await act('submit', { workerId: av.workerId, ...packet('verify', 'Run node test/truncate.test.js and report the last line.', { track: 'A' }) });
    await say('update', '🔁 Builder done; the **same warm checker** reruns the test at the cached rate.');
    snap('Follow-ups queue on warm workers, about 4x cheaper than a cold start.');
    later(5);
    await step(childOf(av2), 'ses_AV', { input: 200, cached: 8100, cost: 0.0008, tool: 'bash', text: 'Result: PASS\nEvidence: TRUNCATE-TEST: PASS (6 cases)' });
    await exit(childOf(av2));
    await say('update', '🏆 **Emoji-safe truncate accepted** by the checker. This turn cost ==$0.002==.');
    chat.push({ role: 'assistant', text: 'truncate now counts each emoji as one character (flags included, as assumed in the heads-up). 6 test cases pass, rerun by a separate checker. Turn cost $0.002.' });
    snap('Turn 2 done. Open the heads-up answer in the chat if the assumption was wrong.');

    const out = path.join(__dirname, 'sample-conversation.json');
    fs.writeFileSync(out, `${JSON.stringify({ workspacePath: ws, frames }, null, 2)}\n`);
    for (const dir of [buildDir, ledgerDir]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log(`SAMPLE CONVERSATION WRITTEN frames=${frames.length} commentary=${frames[frames.length - 1].commentary.items.length} workers=${frames[frames.length - 1].workers.workers.length} -> ${path.relative(root, out)}`);
})().catch((error) => { console.error(error); process.exit(1); });
