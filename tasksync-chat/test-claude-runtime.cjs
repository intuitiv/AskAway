// EV-WORKER-CLAUDE: Claude Code is a worker runtime like agy (reviewer, 2026-10-20: "complete support for agy, claude"). Driven
// through the one `worker` tool against a fake `claude` CLI that prints the real stream-json shapes of claude 2.1.220 (system
// init/thinking_tokens, one assistant event per content block repeating its message usage, user tool_result, final result with
// usage + total_cost_usd) on the real default spawner: start, status with token usage and reported dollars, submit resumes the
// same session_id (--resume), an error result is FAILED with its reason, refusal when Claude is off or signed out, cancel kills
// the process, Workers-tab adapter/dollars, the keep-warm ping. OpenCode stays the default.
// Run: node test-claude-runtime.cjs   (add --live for one real claude/haiku worker through this runtime)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-runtime-test-build-'));
const src = path.join(__dirname, 'src');
// Transpiles the modules reachable through relative requires, mirroring src/ so `../team/...` paths resolve.
function transpile(rel) {
    const out = path.join(buildDir, rel.replace(/\.ts$/, '.js'));
    if (fs.existsSync(out)) { return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(path.join(src, rel), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(out, js);
    for (const [, spec] of js.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
        const next = path.join(path.dirname(rel), spec);
        if (fs.existsSync(path.join(src, `${next}.ts`))) { transpile(`${next}.ts`); }
        else if (fs.existsSync(path.join(src, next, 'index.ts'))) { transpile(path.join(next, 'index.ts')); }
    }
}
for (const name of ['claudeRuntime', 'agyRuntime', 'openCodeRuntime', 'workersState', 'workerTools', 'runtimeHealth']) { transpile(`workers/${name}.ts`); }
const load = (name) => require(path.join(buildDir, 'workers', `${name}.js`));
const { parseWorkerProfile, resolveSelection } = load('workerProfiles');
const { OpenCodeWorkerRuntime } = load('openCodeRuntime');
const { registerWorkerTools, setWorkerRuntimeGate } = load('workerTools');
const { projectWorkersState, loadWorkerTrace } = load('workersState');
const health = load('runtimeHealth');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-claude-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'ws-')));
const callsFile = path.join(tmp, 'calls.jsonl');
const SESSION = '86fa5a32-cd79-4955-a530-0bb825b9f64f';
// The fake claude: records argv + cwd, then streams the real stream-json shapes. The prompt (after `--`) picks the scenario.
const fakeClaude = path.join(tmp, 'claude');
fs.writeFileSync(fakeClaude, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const cfgArg = (args.find((a) => a.startsWith('--mcp-config=')) || '').slice(13);
let cfg = ''; let cfgMode = 0;
try { cfg = fs.readFileSync(cfgArg, 'utf8'); cfgMode = fs.statSync(cfgArg).mode & 0o777; } catch (e) {}
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid, cfg, cfgMode, cfgArg }) + '\\n');
const prompt = args[args.indexOf('--') + 1] || '';
const resumed = (args.find((a) => a.startsWith('--resume=')) || '').slice(9);
const session_id = resumed || (/ERRORRESULT/.test(prompt) ? 'err-session-1' : /SLEEP/.test(prompt) ? 'sleep-session-1' : ${JSON.stringify(SESSION)});
const model = (args.find((a) => a.startsWith('--model=')) || '').slice(8);
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id, tools: ['Bash', 'Edit', 'Read'], mcp_servers: [{ name: 'askaway', status: 'connected' }], model: 'claude-' + model, permissionMode: 'acceptEdits', claude_code_version: '2.1.220' });
out({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 12, estimated_tokens_delta: 12, session_id });
if (/SLEEP/.test(prompt)) { setInterval(() => {}, 1000); return; }
if (/ERRORRESULT/.test(prompt)) {
    out({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 3, duration_ms: 900, session_id, total_cost_usd: 0.002, usage: { input_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 } });
    process.exit(1);
}
const usage1 = { input_tokens: 10, cache_creation_input_tokens: 6543, cache_read_input_tokens: 0, output_tokens: 1, service_tier: 'standard' };
const msg = (id, content, usage) => out({ type: 'assistant', message: { model: 'claude-' + model, id, type: 'message', role: 'assistant', content, stop_reason: null, usage }, parent_tool_use_id: null, session_id });
msg('msg_1', [{ type: 'thinking', thinking: 'Plan the fixture.', signature: 'sig' }], usage1);
msg('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__askaway__askaway_memory', input: { action: 'search', query: 'claude' } }], usage1);
out({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: [{ type: 'text', text: '3 results' }] }] }, parent_tool_use_id: null, session_id });
fs.writeFileSync(require('path').join(process.cwd(), 'fixture.txt'), process.pid + ' ' + Date.now());
const text = 'Result: PASS\\nEvidence: ok\\nKnowledge: knows the fixture' + (resumed ? ' (resumed)' : '');
msg('msg_2', [{ type: 'text', text }], { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 6543, output_tokens: 2 });
out({ type: 'system', subtype: 'notification', key: 'stop-hook-error', text: 'Stop hook error occurred', session_id });
// result.usage and total_cost_usd are the run totals; the stream's output_tokens were partial.
out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1651, num_turns: 2, result: text, stop_reason: 'end_turn', session_id, total_cost_usd: 0.0421,
    usage: { input_tokens: 15, cache_creation_input_tokens: 6543, cache_read_input_tokens: 6543, output_tokens: 80 }, permission_denials: [] });
`);
fs.chmodSync(fakeClaude, 0o755);

const profile = parseWorkerProfile('---\nname: build\ndescription: "b"\ntier: mid\nmodel: github-copilot/gpt-5.6-luna\nthinking: medium\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [medium]\nedit: allow\nbash: allow\nmcp: [askaway_askaway_memory, askaway_commentary, askaway_worker]\n---\nBUILD-PROFILE-BODY.\n');
const readOnly = parseWorkerProfile('---\nname: explore\ndescription: "e"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: medium\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [medium]\nedit: deny\nbash: deny\n---\nExplore.\n');
const MCP_URL = 'http://localhost:4567/sse';
const runtime = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir: path.join(tmp, 'ledger'), claudeCommand: fakeClaude, claudeMcpUrl: () => MCP_URL });
const tools = new Map();
registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
const call = async (action, args) => {
    const tool = tools.get('worker');
    return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
};
const packet = { profile: 'build', runtime: 'claude', model: 'sonnet', dispatchTurnId: 'turn-1', baseRevision: 'abc',
    objective: 'Write the fixture', allowedFiles: ['fixture.txt'], acceptance: 'a', expected: 'e', command: 'true' };
const calls = () => fs.readFileSync(callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const arg = (c, flag) => (c.args.find((a) => a.startsWith(`${flag}=`)) || '').slice(flag.length + 1);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const close = (a, b) => Math.abs(a - b) < 1e-9;

(async () => {
    // start: `runtime: 'claude'` + a bare alias is namespaced claude/; the profile's own model list has no Claude model.
    const started = await call('start', packet);
    assert.equal(started.model, 'claude/sonnet', JSON.stringify(started));
    const done = await call('wait', { runId: started.runId, timeoutSeconds: 20 });
    assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
    assert.ok(done.evidence.includes('Result: PASS'));
    const [first] = calls();
    assert.equal(first.cwd, workspace, 'claude runs in the workspace');
    assert.deepEqual(first.args.slice(0, 4), ['-p', '--output-format=stream-json', '--verbose', '--model=sonnet']);
    assert.equal(arg(first, '--effort'), 'medium');
    assert.equal(arg(first, '--add-dir'), workspace);
    assert.equal(arg(first, '--permission-mode'), 'acceptEdits');
    assert.deepEqual(arg(first, '--allowedTools').split(','), ['Bash(rtk:*)', 'mcp__askaway__askaway_memory', 'mcp__askaway__commentary', 'mcp__askaway__worker'], 'rtk shell + named MCP tools (commentary for AITalk questions; the worker tool because this profile lists it, bounded by the worker-tool guard)');
    assert.ok(arg(first, '--disallowedTools').split(',').includes('Task'), 'workers never spawn subagents');
    assert.ok(!arg(first, '--disallowedTools').split(',').includes('mcp__askaway__worker'), 'a profile that lists the worker tool may call it');
    assert.ok(!arg(first, '--disallowedTools').split(',').includes('mcp__askaway__commentary'), 'a profile that lists commentary may call it');
    // The identity token is a credential: it is in a private 0600 file read at launch, never in argv, and the file is removed when the run ends.
    const mcpConfig = JSON.parse(first.cfg);
    const token = mcpConfig.mcpServers.askaway.headers['X-AskAway-Run'];
    assert.deepEqual({ ...mcpConfig.mcpServers.askaway, headers: undefined }, { type: 'http', url: MCP_URL, headers: undefined });
    assert.match(token, /^[0-9a-f]{48}$/, 'a random per-run identity token rides in a header');
    assert.ok(!JSON.stringify(first.args).includes(token), 'the token never appears in the spawned argv');
    assert.ok(path.isAbsolute(first.cfgArg) && first.cfgArg.startsWith(os.tmpdir()), 'the config is a file path under the OS temp dir');
    assert.equal(first.cfgMode, 0o600, 'the config file is private to the user');
    assert.equal(fs.existsSync(first.cfgArg), false, 'the config file is deleted when the run ends');
    assert.equal(fs.existsSync(path.dirname(first.cfgArg)), false, 'and so is its private directory');
    assert.ok(first.args.includes('--strict-mcp-config'), 'only the per-run config: no other askaway entry can shadow the identity header');
    assert.equal(runtime.workerForRunToken(token), undefined, 'the token is dropped when the run ends');
    assert.match(arg(first, '--append-system-prompt'), /BUILD-PROFILE-BODY/);
    assert.equal(first.args.includes('--resume') || !!arg(first, '--resume'), false, 'a fresh worker starts a new session');
    assert.match(first.args[first.args.indexOf('--') + 1], /^Objective: Write the fixture/);
    console.log('EV-WORKER-CLAUDE start: headless claude argv from the profile, in the workspace: PASS');

    // status: session_id from the first event; token usage like OpenCode step_finish; the run cost is Claude's reported dollars.
    const status = await call('status', { runId: started.runId });
    assert.equal(status.sessionId, SESSION);
    assert.equal(status.costStatus, undefined, 'claude reports its cost');
    assert.deepEqual({ ...status.usage, cost: 0 }, { input: 15, output: 80, reasoning: 0, cacheRead: 6543, cacheWrite: 6543, cost: 0, steps: 2 }, JSON.stringify(status.usage));
    assert.ok(close(status.usage.cost, 0.0421), `cost ${status.usage.cost}`);
    const logs = await call('logs', { runId: started.runId, limit: 100 });
    assert.deepEqual([...new Set(logs.map((fact) => fact.type))].sort(), ['after_tool', 'before_tool', 'checkpoint', 'message_update', 'start', 'stop']);
    assert.ok(logs.filter((fact) => fact.tool).every((fact) => fact.tool === 'askaway_askaway_memory'), 'MCP tools are named <server>_<tool>');
    assert.ok(logs.every((fact) => !fact.costStatus));
    console.log('EV-WORKER-CLAUDE status: session, usage counted once, reported dollars, ledger facts: PASS');

    // Team/Workers projection: claude adapter, real dollars, a warm cache like OpenCode (not agy).
    const state = projectWorkersState(runtime, workspace);
    const row = state.workers.find((w) => w.workerId === started.workerId);
    assert.equal(row.adapter, 'claude');
    assert.ok(close(row.banner.dollars, 0.0421));
    assert.ok(row.cacheExpiresAt > Date.now(), 'Claude has a provider prompt cache: the worker stays warm like OpenCode');
    assert.equal(row.sessionOpenAction, '', 'no OpenCode viewer for a claude conversation');
    const listed = (await call('list', {})).find((w) => w.workerId === started.workerId);
    assert.ok(close(listed.cost, 0.0421), 'worker list replies show dollars');
    assert.equal((await loadWorkerTrace(runtime, workspace, started.workerId, async () => { throw new Error('no OpenCode transcript'); })).source, 'ledger');
    assert.equal(runtime.keepWarmWorkers(workspace).some((w) => w.workerId === started.workerId), true, 'claude workers are kept warm');
    console.log('EV-WORKER-CLAUDE Workers tab: adapter claude, dollars, warm cache: PASS');

    // submit: the same worker resumes its session with --resume, so it is warm.
    const submitted = await call('submit', { workerId: started.workerId, ...packet, objective: 'Second packet' });
    assert.equal(submitted.workerId, started.workerId, JSON.stringify(submitted));
    assert.equal((await call('wait', { runId: submitted.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    const second = calls()[1];
    assert.equal(arg(second, '--resume'), SESSION);
    assert.equal((await call('status', { runId: submitted.runId })).sessionId, SESSION);
    console.log('EV-WORKER-CLAUDE submit: resumes the same session_id: PASS');

    // keep-warm ping: one --resume call; its reported cost lands on a ping checkpoint.
    const ping = await runtime.ping(started.workerId);
    assert.equal(ping.status, 'PINGED', JSON.stringify(ping));
    const pinged = calls().at(-1);
    assert.equal(arg(pinged, '--resume'), SESSION);
    const pingFact = runtime.facts(workspace).filter((fact) => fact.ping).at(-1);
    assert.ok(pingFact && close(pingFact.usage.cost, 0.0421));
    console.log('EV-WORKER-CLAUDE keep-warm ping resumes the session: PASS');

    // error result: FAILED with Claude's own reason, no auto-resume loop. A read-only profile denies edits and shell.
    const failed = await call('start', { ...packet, profile: 'explore', objective: 'ERRORRESULT please' });
    const failedDone = await call('wait', { runId: failed.runId, timeoutSeconds: 20 });
    assert.equal(failedDone.status, 'FAILED');
    assert.match(failedDone.reason, /^claude error_max_turns/);
    const errCall = calls().at(-1);
    assert.equal(arg(errCall, '--permission-mode'), 'dontAsk');
    assert.deepEqual(arg(errCall, '--disallowedTools').split(',').sort(), ['Agent', 'Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'WebFetch', 'Write', 'mcp__askaway__worker']);
    assert.equal(arg(errCall, '--mcp-config'), '', 'no MCP config for a profile without MCP tools');
    assert.equal(calls().filter((c) => /ERRORRESULT/.test(c.args.at(-1))).length, 1, 'an error result is not auto-resumed');
    console.log('EV-WORKER-CLAUDE error result -> FAILED with reason: PASS');

    // cancel kills the process.
    const sleeping = await call('start', { ...packet, model: 'haiku', objective: 'SLEEP until cancelled' });
    assert.equal(sleeping.model, 'claude/haiku');
    for (let i = 0; i < 100 && (await call('status', { runId: sleeping.runId })).state !== 'RUNNING'; i++) { await new Promise((r) => setTimeout(r, 50)); }
    const sleepPid = calls().at(-1).pid;
    assert.equal(alive(sleepPid), true);
    assert.equal((await call('cancel', { runId: sleeping.runId })).status, 'CANCELLATION_REQUESTED');
    assert.equal((await call('wait', { runId: sleeping.runId, timeoutSeconds: 10 })).status, 'CANCELLED');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(sleepPid), false, 'cancel kills the claude process');
    console.log('EV-WORKER-CLAUDE cancel kills the process: PASS');

    // Selection: any profile may run any claude/ model; an OpenCode packet never takes a claude model.
    assert.equal(resolveSelection(profile, { model: 'claude/opus' }).status, 'SELECTED');
    assert.equal(resolveSelection(profile).model, 'github-copilot/gpt-5.6-luna', 'OpenCode stays the default');
    assert.match((await call('start', { ...packet, runtime: 'opencode', model: 'claude/opus' })).reason, /belongs to runtime claude/);
    console.log('EV-WORKER-CLAUDE selection, OpenCode default: PASS');

    // Refused when Claude is off in Settings or signed out, in the existing reason style; nothing is spawned.
    const settings = { opencode: true, agy: true, claude: false };
    let auth = '{"loggedIn":true}';
    health.configureRuntimeHealth({ enabled: (name) => settings[name], setEnabled: async () => {}, warn: () => {}, home: () => '/home/u',
        pathDirs: () => ['/fake/bin'], exists: (file) => file === '/fake/bin/claude', claudeAuth: async () => auth, probeOpenCode: async () => true, now: () => Date.now() });
    setWorkerRuntimeGate(health.runtimeRefusal, () => runtime);
    const before = calls().length;
    assert.deepEqual(await call('start', { ...packet, objective: 'gated' }), { status: 'RUNTIME_OFF', runtime: 'claude', reason: 'Claude is off in Settings' });
    assert.equal((await call('submit', { workerId: started.workerId, ...packet, runtime: undefined, model: undefined, objective: 'gated' })).reason, 'Claude is off in Settings', 'the warm worker\'s model decides');
    settings.claude = true;
    auth = '{"loggedIn":false}';
    assert.deepEqual(await call('start', { ...packet, objective: 'gated' }), { status: 'RUNTIME_UNHEALTHY', runtime: 'claude', reason: 'Claude is not signed in' });
    assert.equal(calls().length, before, 'a refused packet never spawns claude');
    setWorkerRuntimeGate(undefined);
    console.log('EV-WORKER-CLAUDE refused when off or signed out: PASS');

    if (process.argv.includes('--live')) {
        const live = new OpenCodeWorkerRuntime([readOnly], { ledgerDir: path.join(tmp, 'live-ledger') });
        const liveRun = live.start({ ...packet, profile: 'explore', model: 'haiku', workspacePath: workspace, allowedFiles: [],
            objective: 'Do not use any tool. Reply with exactly three lines: Result: PASS / Evidence: live haiku / Not done: none' });
        const liveDone = await live.wait(liveRun.runId, 120);
        const liveStatus = live.status(liveRun.runId);
        assert.equal(liveDone.status, 'COMPLETED', JSON.stringify(liveDone));
        assert.ok(liveStatus.usage.cost > 0 && liveStatus.sessionId, JSON.stringify(liveStatus));
        console.log(`EV-WORKER-CLAUDE live haiku: COMPLETED, $${liveStatus.usage.cost.toFixed(4)}, session ${liveStatus.sessionId}: PASS`);
    }
    console.log('PASS EV-WORKER-CLAUDE');
    process.exit(0);
})().catch((error) => { console.error(error); console.log('FAIL EV-WORKER-CLAUDE'); process.exit(1); });
