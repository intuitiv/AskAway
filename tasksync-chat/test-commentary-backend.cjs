// Commentary + VS Code worker-tool backend, observed from callers: tool invocations, the tab's state, the next conversation's hook.
// Run: node test-commentary-backend.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.commentary-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools', 'commentary/commentary']) {
    require('./test-fixture-transpile.cjs')(buildDir, `${name}.ts`);
}
const { CommentaryStore, commentaryToolDefinitions, commentaryView } = require(path.join(buildDir, 'commentary', 'commentary.js'));
const { invokeDefinition, workerTool } = require(path.join(buildDir, 'workers', 'workerTools.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'workers', 'openCodeRuntime.js'));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-commentary-home-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-commentary-ws-')));
let clock = Date.UTC(2026, 8, 24, 19, 14);
const store = new CommentaryStore({ dir: path.join(home, '.askaway', 'commentary'), now: () => clock });
const [commentary] = commentaryToolDefinitions(() => store, workspace);
const call = async (definition, input) => JSON.parse(await invokeDefinition(definition, input));

(async () => {
    // --- The commentary tool as the orchestrator calls it ---
    assert.deepEqual((await call(commentary, { kind: 'update', ref: 'A.1', text: 'Split T015: base tab now, swimlanes later, unblocks commentary work.' })).status, 'POSTED');
    clock += 60_000;
    assert.equal((await call(commentary, { kind: 'heads-up', text: 'Commentary tab beside Workers, or replace it?' })).status, 'POSTED');
    const tooLong = await call(commentary, { kind: 'update', text: 'two words' });
    assert.equal(tooLong.status, 'REJECTED', 'the 3-word minimum stays; the upper limit is soft (reviewer, 2026-10-24; see test-aitalk-soft-limit.cjs)');
    assert.equal((await call(commentary, { kind: 'update', text: 'ok' })).status, 'REJECTED', 'too short to be useful');
    assert.equal((await call(commentary, { kind: 'milestone', text: 'old kinds are gone from the contract now' })).status, 'INVALID_INPUT');
    assert.equal((await call(commentary, { kind: 'heads-up', text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123 expired again today' })).reason, 'text contains a credential');
    assert.equal((await call(commentary, { text: 'missing kind here' })).status, 'INVALID_INPUT');

    // --- What the Commentary tab receives ---
    let view = commentaryView(store.read(workspace));
    assert.equal('goal' in view, false);
    const legacy = JSON.parse(fs.readFileSync(store.file(workspace), 'utf8'));
    fs.writeFileSync(store.file(workspace), JSON.stringify({ ...legacy, goal: 'Retired goal', goalUpdatedAt: 1 }));
    assert.equal('goal' in store.read(workspace), false, 'legacy goal state is ignored');
    assert.deepEqual(view.items.map((i) => i.kind), ['update', 'heads-up']);
    assert.equal(view.opener, [
        'Commentary since last clear (2):',
        '- 19:14 Split T015: base tab now, swimlanes later, unblocks commentary work.',
        '- 19:15 HEADS-UP: Commentary tab beside Workers, or replace it?',
    ].join('\n'));
    const pushed = [];
    store.onChange((state) => pushed.push(state.items.length));
    clock += 60_000;
    store.clear(workspace, 'feed');
    assert.equal('goal' in JSON.parse(fs.readFileSync(store.file(workspace), 'utf8')), false, 'writes drop legacy goal persistence');
    view = commentaryView(store.read(workspace));
    assert.deepEqual([view.items.length, view.archivedCount], [0, 2], 'clear keeps audit history');
    await call(commentary, { kind: 'update', text: 'Track A: code worker editing workersState.ts, verify queued next.' });
    assert.equal((await call(commentary, { kind: 'update', text: 'Accepted: verify worker saw the EV-014 PASS line exactly.' })).status, 'POSTED');
    assert.deepEqual(commentaryView(store.read(workspace)).items.map((i) => [i.kind, 'ref' in i]), [['update', false], ['update', false]], 'only posts after the clear are live; an old caller\'s ref is dropped');
    assert.deepEqual(pushed, [2, 3, 4], 'every change is pushed to the tab');
    assert.equal((await call(commentary, { kind: 'update', text: `🚀 ${Array(20).fill('word').join(' ')} ✅` })).status, 'POSTED', 'emojis do not count as words');

    // --- The worker tool as a VS Code LM tool: one tool, same contract, validated input, bounded JSON ---
    const runtime = new OpenCodeWorkerRuntime([], { ledgerDir: path.join(home, 'ledger'), spawner: () => { throw new Error('no spawn'); } });
    const worker = workerTool(() => runtime, workspace);
    const workers = { worker };
    assert.deepEqual(await call(worker, { action: 'list' }), []);
    assert.equal((await call(worker, { action: 'status' })).status, 'INVALID_INPUT', 'missing runId is refused before the runtime');
    assert.equal((await call(worker, { action: 'wait', runId: 'r', timeoutSeconds: 999 })).status, 'UNKNOWN_RUN', 'wait above 240s is clamped, not refused');
    assert.equal((await call(worker, { action: 'start', profile: 'code' })).status, 'INVALID_INPUT');
    assert.equal((await call(worker, { runId: 'r' })).status, 'INVALID_INPUT', 'no action, no call');

    // --- package.json declares exactly these tools (VS Code only exposes declared LM tools) ---
    const check = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'tools', 'gen-lm-tool-manifest.cjs'), '--check'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const declared = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).contributes.languageModelTools;
    assert.equal(declared.find(tool => tool.name === 'aitalk').modelDescription, commentary.description, 'VS Code and MCP expose identical aitalk guidance');
    assert.match(commentary.description, /plain first-person sentences/);
    assert.match(commentary.description, /one or two short sentences/);
    assert.match(commentary.description, /heads-up asks the exact question with options/);
    assert.doesNotMatch(commentary.description, /Lead with one emoji|\*\*bold\*\*|==highlight==/);
    const voice = fs.readFileSync(path.join(__dirname, 'docs/voice.md'), 'utf8');
    const sharedVoice = /<!-- shared-voice:start -->[\s\S]*?<!-- shared-voice:end -->/.exec(voice)[0];
    assert.match(voice, /plain first-person sentences/);
    assert.ok(fs.readFileSync(path.join(__dirname, 'src/agents/sharedVoice.ts'), 'utf8').includes(sharedVoice));
    assert.match(fs.readFileSync(path.join(__dirname, 'src/agents/askawayBuildAgent.ts'), 'utf8'), /one or two short first-person sentences/);
    assert.equal((await call(commentary, { kind: 'heads-up', text: "Can you pick Workers or Trace? I'd put the scoreboard in Workers." })).status, 'POSTED');
    console.log('EV-COMMENTARY-SPEECH: PASS first-person guidance shared by VS Code, MCP, voice doc and Build; direct question accepted');
    for (const name of [...Object.keys(workers), 'aitalk']) {
        assert.ok(declared.some((tool) => tool.name === name && tool.toolReferenceName), `package.json declares ${name}`);
    }
    const toolsSource = fs.readFileSync(path.join(__dirname, 'src', 'tools.ts'), 'utf8');
    assert.match(toolsSource, /registerLmToolDefinitions\(\[\s*workerTool\(\(\) => sharedWorkerRuntimeReady\(workspaceRoot\), workspaceRoot[\s\S]*?\),\s*\.\.\.commentaryToolDefinitions\(sharedCommentaryStore, workspaceRoot\)/);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).contributes.languageModelTools.some((t) => /^worker_/.test(t.name)), 'the eight per-operation tools are gone');
    console.log(`EV-035 OrchestratorReachesWorkers: PASS lmTools=${Object.keys(workers).length + 1} manifestInSync=true invalidInputRefused=4`);

    // --- The same commentary tool on the AskAway MCP, as a scripted client or OpenCode host calls it ---
    // Reviewer 2026-09-28: lines from this workspace showed in another one. The MCP server lives in ONE window and
    // defaulted to that window's workspace; over MCP a line must name its workspace.
    const { registerToolDefinitions } = require(path.join(buildDir, 'workers', 'workerTools.js'));
    const mcpTools = new Map();
    registerToolDefinitions((name, config, handler) => mcpTools.set(name, { config, handler }), commentaryToolDefinitions(() => store, ''));
    const viaMcp = async (args) => JSON.parse((await mcpTools.get('aitalk').handler(mcpTools.get('aitalk').config.inputSchema.parse(args))).content[0].text);
    const otherWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-commentary-other-')));
    const before = store.read(workspace).items.length;
    const unnamed = await viaMcp({ kind: 'update', text: '🏏 Posted over MCP without naming a workspace at all.' });
    assert.deepEqual([unnamed.status, /workspacePath is required/.test(unnamed.reason)], ['REJECTED', true], 'no silent fallback to the server owner\'s workspace');
    assert.equal((await viaMcp({ kind: 'update', text: '🏏 Plan posted from an MCP client, same feed as the orchestrator.', workspacePath: workspace })).status, 'POSTED');
    assert.equal(store.read(workspace).items.length, before + 1, 'an MCP post lands in the named workspace feed');
    assert.equal(store.read(otherWorkspace).items.length, 0, 'and in no other workspace');
    assert.equal((await viaMcp({ kind: 'update', text: 'too short', workspacePath: workspace })).status, 'REJECTED', 'same 3-word minimum as the VS Code tool');
    assert.throws(() => mcpTools.get('aitalk').config.inputSchema.parse({ kind: 'milestone', text: 'old kind' }), 'same kinds as the VS Code tool');
    assert.match(fs.readFileSync(path.join(__dirname, 'src', 'mcp', 'mcpServer.ts'), 'utf8'),
        /registerToolDefinitions\([^\n]*commentaryToolDefinitions\(sharedCommentaryStore, ''\)\)/, 'the MCP server registers it with no default workspace');
    fs.rmSync(otherWorkspace, { recursive: true, force: true });
    console.log('EV-030d CommentaryOnMcp: PASS posted=namedWorkspaceOnly unnamed=refused limits=shared kinds=shared registered=mcpServer');

    // --- Next conversation: carry-over once, goal anchor every prompt, asides ---
    fs.mkdirSync(path.join(workspace, '.specify'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'specs', '001-demo'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-demo' }));
    fs.writeFileSync(path.join(workspace, 'specs', '001-demo', 'Goal.md'), 'Ship the async worker runner.');
    fs.writeFileSync(path.join(workspace, 'specs', '001-demo', 'Rules.md'), 'Root cause first.');
    fs.writeFileSync(path.join(workspace, 'specs', '001-demo', 'tasks.md'), '- [x] T001 [CY-001] done\n- [ ] T014 [CY-005] next\n');
    const hook = (input) => {
        const out = childProcess.execFileSync(process.execPath, [path.join(__dirname, 'hooks', 'spec-context-inject.cjs')],
            { input: JSON.stringify({ cwd: workspace, ...input }), env: { ...process.env, HOME: home }, encoding: 'utf8' });
        return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
    };
    const first = hook({ session_id: 'next-1', prompt: 'continue' });
    assert.match(first, /Ship the async worker runner/);
    assert.match(first, /## Carry-over from the previous conversation[\s\S]*\d\d:\d\d Track A: code worker/);
    assert.doesNotMatch(first, /Split T015/, 'cleared commentary is not carried over');
    const second = hook({ session_id: 'next-1', prompt: 'next step' });
    assert.doesNotMatch(second, /Ship the async worker runner|Carry-over/, 'Goal.md and carry-over are injected once');
    assert.match(second, /^Main goal: finish CY-005 of 001-demo\./);
    assert.match(hook({ session_id: 'next-1', prompt: 'aside: what is RTK?' }), /This prompt is an aside: answer it briefly, do not change the main goal/);
    store.clear(workspace, 'all');
    assert.match(hook({ session_id: 'next-1', prompt: 'go' }), /^Main goal: finish CY-005 of 001-demo\./, 'without a goal box the anchor is the active cycle');
    assert.doesNotMatch(hook({ session_id: 'next-2', prompt: 'go' }), /Carry-over/, 'nothing to carry after a full clear');
    console.log('EV-030 CommentaryBackend: PASS kinds=update+heads-up refs=true maxWords=20 rejections=5 clearKeepsAudit=true pushOnChange=true opener=exact');
    console.log('EV-031 GoalAnchor: PASS carryOverOnce=true anchorEveryPrompt=true aside=true cycleFallback=CY-005');

    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
})().catch((error) => { console.error(error); process.exit(1); });
