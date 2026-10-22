// EV-VALIDATOR-STACK-WIRING: the real Stop hook script + HandoffNotifier hand the agent's final response to onAgentFinal once per real turn end,
// and StackCapture reports the reviewer's drained prompts with their stack key (ADR 0038, R-PLAN-38/39, R-AITALK-50).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

process.umask(0);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stack-wiring-home-')));
const realHome = process.env.HOME;
process.env.HOME = home;
const cfg = path.join(home, '.askaway');
fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });

const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
const hookPath = path.join(cfg, 'hooks', 'cache-timer.js');
fs.writeFileSync(hookPath, extension.match(/const CACHE_TIMER_INJECT_SCRIPT = `([\s\S]*?)`;/)[1]);
const stop = payload => execFileSync(process.execPath, [hookPath], { input: JSON.stringify({ hook_event_name: 'Stop', ...payload }), env: { ...process.env, HOME: home } });

(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stack-wiring-ws-')));
    const bundle = entry => { const mod = { exports: {} }; vm.runInNewContext(esbuild.buildSync({ stdin: { contents: entry, resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text,
        { module: mod, exports: mod.exports, require: id => id === 'vscode' ? { workspace: { getConfiguration: () => ({ get: () => false }), workspaceFolders: [{ uri: { fsPath: root } }] } } : require(id), __dirname, Buffer, console, process, setTimeout, clearTimeout, setInterval, clearInterval }); return mod.exports; };
    const api = bundle("export * from './src/services/handoffNotifier'; export * from './src/validator/stackCapture'; export * from './src/validator/conversationStack';");

    const storage = path.join(home, 'workspaceStorage', 'mine', 'GitHub.copilot-chat');
    const debugLogs = path.join(storage, 'debug-logs');
    const mySession = 'aaaaaaaa-1111-2222-3333-444444444444';
    fs.mkdirSync(path.join(debugLogs, mySession), { recursive: true });
    const handoff = '## Response Handoff\n\nImpact: done.\nNext: Continue?';
    fs.writeFileSync(path.join(debugLogs, mySession, 'main.jsonl'), JSON.stringify({ type: 'agent_response', ts: Date.now(), attrs: { response: JSON.stringify([{ parts: [{ type: 'text', content: 'Whole reply.\n\n' + handoff }] }]) } }) + '\n');
    const mine = { session_id: mySession, cwd: root, transcript_path: path.join(storage, 'transcripts', mySession + '.jsonl') };
    const otherWindow = { session_id: 'bbbbbbbb-5555-6666-7777-888888888888', cwd: '/Users/someone/elsewhere', transcript_path: path.join(home, 'workspaceStorage', 'other', 'GitHub.copilot-chat', 'transcripts', 'x.jsonl') };

    const finals = [], validated = [];
    const notifier = new api.HandoffNotifier([], debugLogs, () => {}, undefined, async text => { validated.push(text); }, undefined);
    notifier.setAgentFinal(async input => { finals.push(input); });
    const poll = async () => { await sleep(1700); await notifier._onTurnEnd(); await sleep(50); };

    // 1. stops that are not this window's real turn end never reach onAgentFinal
    stop({ ...otherWindow, last_assistant_message: 'foreign final' }); await poll();
    stop({ ...mine, agent_id: 'child-1', last_assistant_message: 'sub-agent final' }); await poll();
    stop({ ...mine, last_assistant_message: 'blocked final' }); fs.writeFileSync(path.join(cfg, 'finish-gate-state.json'), JSON.stringify({ lastBlock: Date.now() })); await poll();
    fs.writeFileSync(path.join(cfg, 'finish-gate-state.json'), JSON.stringify({ lastBlock: Date.now() - 60000 }));
    assert.equal(finals.length, 0, 'foreign, sub-agent and gate-blocked stops are never captured');
    assert.equal(validated.length, 0);

    // 2. an own stop with no Response Handoff section is captured, once even when the stamp is written twice
    stop({ ...mine, last_assistant_message: 'Plain final answer, no handoff section.' }); await poll();
    assert.equal(finals.length, 1);
    assert.equal(finals[0].sessionId, mySession);
    assert.equal(finals[0].text, 'Plain final answer, no handoff section.');
    stop({ ...mine, last_assistant_message: 'Plain final answer, no handoff section.' }); await poll();
    assert.equal(finals.length, 1, 'the same final written twice is captured once');
    assert.equal(validated.length, 0, 'the old validate path is not used when onAgentFinal is');

    // 3. a different final is a new capture; a secret-looking final is not put in the stamp, so the handoff text from the log is used
    stop({ ...mine, last_assistant_message: 'Second final answer.' }); await poll();
    assert.equal(finals.length, 2);
    stop({ ...mine, last_assistant_message: 'My key is ghp_abcdefghijklmnopqrstuvwxyz0123456789AB' }); await poll();
    assert.ok(!JSON.parse(fs.readFileSync(path.join(cfg, 'turn-complete-info.json'), 'utf8')).lastAssistantMessage, 'a secret-looking final is omitted from the stamp');
    assert.equal(finals.length, 3);
    assert.match(finals[2].text, /Response Handoff/);
    assert.doesNotMatch(JSON.stringify(finals), /ghp_/);
    assert.equal(validated.length, 0);

    // 4. a long final is capped
    stop({ ...mine, last_assistant_message: 'x'.repeat(50000) }); await poll();
    assert.equal(finals.length, 4);
    assert.equal(finals[3].text.length, 40000);

    // 4b. promptId: identical text in two genuine turns is captured twice; one promptId written three times once
    const before = finals.length;
    stop({ ...mine, prompt_id: 'p-1', last_assistant_message: 'Done.' }); await poll();
    stop({ ...mine, prompt_id: 'p-2', last_assistant_message: 'Done.' }); await poll();
    assert.equal(finals.length, before + 2, 'identical final text with two prompt ids is captured twice');
    for (let i = 0; i < 3; i++) { stop({ ...mine, prompt_id: 'p-3', last_assistant_message: 'Same turn text.' }); await poll(); }
    assert.equal(finals.length, before + 3, 'the same prompt id written three times is captured once');
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'turn-complete-info.json'), 'utf8')).promptId, 'p-3');

    // 4c. the stamp file carries the final response, so it is private: 0600 even when it existed with wider modes
    const infoFile = path.join(cfg, 'turn-complete-info.json');
    fs.chmodSync(infoFile, 0o644);
    stop({ ...mine, prompt_id: 'p-4', last_assistant_message: 'Private.' });
    assert.equal(fs.statSync(infoFile).mode & 0o777, 0o600);
    await poll();
    const fresh = path.join(cfg, 'turn-complete-info.json'); fs.rmSync(fresh);
    stop({ ...mine, prompt_id: 'p-5', last_assistant_message: 'Private again.' });
    assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
    await poll();
    const base = finals.length;

    // 5. an empty session id keeps the old validate path
    stop({ cwd: root }); await poll();
    assert.equal(finals.length, base);
    assert.equal(validated.length, 1);
    assert.match(validated[0], /Response Handoff/);

    // 6. StackCapture.onUser reports the stack key of each drained prompt; two sessions give two keys
    const spoolDir = path.join(home, 'spool'); fs.mkdirSync(spoolDir);
    const users = [];
    const capture = new api.StackCapture({ spoolDir, stacks: new api.ConversationStacks({ dir: path.join(home, 'stacks') }), workspaceRoot: root, onUser: input => users.push(input) });
    for (const [n, session] of [['1', 'S1'], ['2', 'S2']]) fs.writeFileSync(path.join(spoolDir, `000${n}-x.json`), JSON.stringify({ kind: 'user', sessionId: session, cwd: root, text: `question ${n}`, at: Date.now() }));
    capture.drain();
    assert.deepEqual(users.map(u => u.text), ['question 1', 'question 2']);
    assert.deepEqual(users.map(u => u.conversationKey), [api.stackKey(root, 'S1'), api.stackKey(root, 'S2')]);
    assert.notEqual(users[0].conversationKey, users[1].conversationKey);
    assert.deepEqual(users.map(u => u.sessionId), ['S1', 'S2']);

    // 7. extension.ts starts and stops the capture and forwards the final and the reviewer's reply to the triggers
    assert.match(extension, /new StackCapture\(/);
    assert.match(extension, /capture\.start\(\)/);
    assert.match(extension, /capture\.stop\(\)/);
    assert.match(extension, /triggers\.onReviewerReply\(/);
    assert.match(extension, /triggers\.onAgentFinal\(/);
    assert.match(extension, /validator-stacks/);
    const observerBuild = extension.slice(extension.indexOf('new ValidatorObserver({'), extension.indexOf('new ValidatorObserver({') + 900);
    assert.match(observerBuild, /knowledgeStore: store/, 'the observer persists extracted facts');
    assert.match(observerBuild, /knowledgeScope: \{ project: memoryProject, agentId: 'validator' \}/);
    assert.match(extension, /validatorSession\b/);
    assert.doesNotMatch(extension, /sessionContinues: validatorSessionContinues/);

    notifier.dispose();
    console.log('PASS EV-VALIDATOR-STACK-WIRING');
})().catch(error => { console.error('FAIL EV-VALIDATOR-STACK-WIRING:', error); process.exitCode = 1; }).finally(() => { process.env.HOME = realHome; });
