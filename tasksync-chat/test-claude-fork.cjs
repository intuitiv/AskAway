// EV-CLAUDE-FORK: fork/fanout of a warm Claude worker (reviewer, 2026-10-22: "What to do to make claude and agy behave like opencode?").
// A fake `claude` CLI answers like the real one: `--resume P --fork-session` names a NEW session id; a plain `--resume X` keeps X.
// Run: node test-claude-fork.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fork-build-'));
const src = path.join(__dirname, 'src');
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
for (const name of ['claudeRuntime', 'agyRuntime', 'openCodeRuntime', 'workersState', 'workerTools']) { transpile(`workers/${name}.ts`); }
const load = (name) => require(path.join(buildDir, 'workers', `${name}.js`));
const { parseWorkerProfile } = load('workerProfiles');
const { OpenCodeWorkerRuntime } = load('openCodeRuntime');
const { registerWorkerTools } = load('workerTools');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-claude-fork-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'ws-')));
const callsFile = path.join(tmp, 'calls.jsonl');
const counterFile = path.join(tmp, 'counter');
fs.writeFileSync(counterFile, '0');
const fakeClaude = path.join(tmp, 'claude');
fs.writeFileSync(fakeClaude, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ args }) + '\\n');
const prompt = args[args.indexOf('--') + 1] || '';
const resumed = (args.find((a) => a.startsWith('--resume=')) || '').slice(9);
const forked = args.includes('--fork-session');
let n = Number(fs.readFileSync(${JSON.stringify(counterFile)}, 'utf8'));
if (!resumed || forked) { n += 1; fs.writeFileSync(${JSON.stringify(counterFile)}, String(n)); }
const session_id = forked ? 'forked-session-' + n : resumed || 'parent-session-' + n;
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
out({ type: 'system', subtype: 'init', session_id, model: 'claude-sonnet' });
if (/SLEEP/.test(prompt)) { setInterval(() => {}, 1000); return; }
const text = 'Result: PASS\\nEvidence: ok\\nKnowledge: knows the fixture';
out({ type: 'assistant', message: { id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 2 } }, session_id });
out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id, total_cost_usd: 0.01, usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2 } });
`);
fs.chmodSync(fakeClaude, 0o755);

const profile = parseWorkerProfile('---\nname: explore\ndescription: "e"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: medium\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [medium]\nedit: deny\nbash: deny\n---\nExplore.\n');
const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir: path.join(tmp, 'ledger'), claudeCommand: fakeClaude, claudeMcpUrl: () => 'http://localhost:4567/sse' });
const tools = new Map();
registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
const call = async (action, args) => {
    const tool = tools.get('worker');
    return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
};
const packet = (objective, extra = {}) => ({ profile: 'explore', runtime: 'claude', model: 'sonnet', dispatchTurnId: 'turn-1', baseRevision: 'abc',
    objective, allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true', ...extra });
const calls = () => fs.readFileSync(callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const arg = (c, flag) => (c.args.find((a) => a.startsWith(`${flag}=`)) || '').slice(flag.length + 1);

(async () => {
    const parent = await call('start', packet('warm up'));
    assert.equal((await call('wait', { runId: parent.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    const P = arg(calls()[0], '--resume') || 'parent-session-1';
    assert.equal(calls()[0].args.includes('--fork-session'), false, 'the first launch is not a fork');

    const fanned = await call('fanout', { workerId: parent.workerId, packets: [packet('track one', { model: undefined }), packet('track two', { model: undefined })] });
    assert.equal(fanned.status, 'FANNED_OUT', JSON.stringify(fanned));
    assert.equal(fanned.runs.length, 2);
    for (const run of fanned.runs) { assert.equal(run.forkedFrom, parent.workerId); assert.notEqual(run.workerId, parent.workerId); }
    for (const run of fanned.runs) { assert.equal((await call('wait', { runId: run.runId, timeoutSeconds: 20 })).status, 'COMPLETED'); }
    const forkCalls = calls().slice(1);
    assert.equal(forkCalls.length, 2);
    for (const c of forkCalls) {
        assert.equal(arg(c, '--resume'), 'parent-session-1', 'a fork resumes the parent session');
        assert.ok(c.args.includes('--fork-session'), 'and forks it');
        assert.equal(arg(c, '--model'), 'sonnet', 'same model as the parent');
    }
    console.log('PASS fanout of 2 packets runs two `--resume <parent> --fork-session` launches in new workers');

    const states = await Promise.all(fanned.runs.map((run) => call('status', { runId: run.runId })));
    const ids = states.map((s) => s.sessionId);
    assert.ok(ids.every((id) => /^forked-session-/.test(id)), `each fork records its own new session id: ${ids}`);
    assert.notEqual(ids[0], ids[1]);
    assert.ok(ids.every((id) => id !== 'parent-session-1'));
    const before = calls().length;
    const next = await call('submit', { ...packet('follow up', { model: undefined }), workerId: fanned.runs[0].workerId });
    assert.ok(next.runId, JSON.stringify(next));
    assert.equal((await call('wait', { runId: next.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    const resumeCall = calls()[before];
    assert.equal(arg(resumeCall, '--resume'), ids[0], 'a later submit resumes the fork\'s own session');
    assert.equal(resumeCall.args.includes('--fork-session'), false, 'and does not fork again');
    console.log('PASS each fork records its own session id; a later submit resumes it without --fork-session');

    const busy = await call('start', packet('SLEEP now'));
    const refused = await call('fanout', { workerId: busy.workerId, packets: [packet('a'), packet('b')] });
    assert.equal(refused.status, 'INELIGIBLE', JSON.stringify(refused));
    assert.ok(refused.reason, 'a busy parent is refused with a reason');
    await call('cancel', { runId: busy.runId });
    console.log('PASS busy parent refused with a reason');

    const agyWorker = runtime.router.route({ workspacePath: workspace, cwd: workspace, profile: 'explore', model: 'agy/gemini-4-argon-medium', thinking: 'medium', packetId: 'x', estimatedSeconds: 1 });
    assert.ok(agyWorker.workerId, JSON.stringify(agyWorker));
    runtime.router.complete(agyWorker.workerId, agyWorker.runId, { contextTokens: 100 });
    const agyRefusal = await runtime.fanout(agyWorker.workerId, [packet('a', { runtime: 'agy', model: 'agy/gemini-4-argon-medium', workspacePath: workspace }), packet('b', { runtime: 'agy', model: 'agy/gemini-4-argon-medium', workspacePath: workspace })]);
    assert.equal(agyRefusal.status, 'INELIGIBLE', JSON.stringify(agyRefusal));
    assert.match(agyRefusal.reason, /agy conversations cannot be forked: the agy CLI has no fork flag/);
    console.log('PASS EV-CLAUDE-FORK: fanout and fork of a warm Claude worker run each packet as `claude -p --resume <parentSession> --fork-session` in a new worker; agy fork stays refused with the CLI reason');
})().catch((e) => { console.error(e); process.exit(1); });
