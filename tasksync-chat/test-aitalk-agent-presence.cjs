// R-AITALK-50: the main agent joins once when a turn starts and leaves once when the turn really ends; the Validator's
// turn-end prediction runs once per real turn end. Replays what the reviewer saw on 2026-10-22: Stop hooks fired by
// other VS Code windows (the turn-complete stamp is one file for all windows), by sub-agents, and by a blocked stop, in the
// middle of one long turn. The real Stop hook script, notifier, room and Validator triggers run against a temp HOME.
// Run: node test-aitalk-agent-presence.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-presence-home-')));
const realHome = process.env.HOME;
process.env.HOME = home;
const cfg = path.join(home, '.askaway');
fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });

const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
const hookPath = path.join(cfg, 'hooks', 'cache-timer.js');
fs.writeFileSync(hookPath, extension.match(/const CACHE_TIMER_INJECT_SCRIPT = `([\s\S]*?)`;/)[1]);
const stop = payload => execFileSync(process.execPath, [hookPath], { input: JSON.stringify({ hook_event_name: 'Stop', ...payload }), env: { ...process.env, HOME: home } });

(async () => {
    const bundle = entry => { const mod = { exports: {} }; vm.runInNewContext(esbuild.buildSync({ stdin: { contents: entry, resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text,
        { module: mod, exports: mod.exports, require: id => id === 'vscode' ? { workspace: { getConfiguration: () => ({ get: () => false }), workspaceFolders: [{ uri: { fsPath: root } }] } } : require(id), __dirname, Buffer, console, process, setTimeout, clearTimeout, setInterval, clearInterval }); return mod.exports; };
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-presence-ws-')));
    const api = bundle("export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/validator/validatorTriggers'; export * from './src/services/handoffNotifier';");

    // This window's Copilot storage: its chat session has a debug-log folder and a transcript under it.
    const storage = path.join(home, 'workspaceStorage', 'mine', 'GitHub.copilot-chat');
    const debugLogs = path.join(storage, 'debug-logs');
    const mySession = 'aaaaaaaa-1111-2222-3333-444444444444';
    fs.mkdirSync(path.join(debugLogs, mySession), { recursive: true });
    const final = '## Response Handoff\n\nImpact: done.\nNext: Continue?';
    fs.writeFileSync(path.join(debugLogs, mySession, 'main.jsonl'), JSON.stringify({ type: 'agent_response', ts: Date.now(), attrs: { response: JSON.stringify([{ parts: [{ type: 'text', content: 'Whole reply.\n\n' + final }] }]) } }) + '\n');
    const mine = { session_id: mySession, cwd: root, transcript_path: path.join(storage, 'transcripts', mySession + '.jsonl') };
    const otherWindow = { session_id: 'bbbbbbbb-5555-6666-7777-888888888888', cwd: '/Users/someone/assembly-rel', transcript_path: path.join(home, 'workspaceStorage', 'other', 'GitHub.copilot-chat', 'transcripts', 'x.jsonl') };

    const seen = [], failures = [];
    const triggers = new api.ValidatorTriggers(root, async () => ({ observe: async response => { seen.push(response); return { answer: '' }; } }), () => '007-fixture', () => failures.push('failed'));
    const startCallback = extension.match(/provider\.setValidatorTurnStart\((\(text, id\) => \{[^\n]+\})\);/)[1];
    const validateCallback = extension.match(/(\(text, id\) => triggers\.turnEnd\(text, id\)),\s*\n\s*\(\) => roomFor\(memoryProject\)\.unregisterAgent\(\)/)[1];
    const leaveCallback = extension.match(/(\(\) => roomFor\(memoryProject\)\.unregisterAgent\(\))\s*\);/)[1];
    const context = { memoryProject: root, roomFor: api.roomFor, triggers };
    const run = source => vm.runInNewContext(`(${source})`, context);
    const logs = [];
    const notifier = new api.HandoffNotifier([], debugLogs, message => logs.push(message), undefined, run(validateCallback), run(leaveCallback));
    const room = api.roomFor(root);
    api.configureAITalkDelivery(root);
    const rows = text => room.snapshot().messages.filter(message => message.kind === 'system' && message.text === `Agent ${text.split(' ')[1]}`).length;
    const toolCall = () => api.beginAITalkTool();
    const poll = async () => { await sleep(1700); await notifier._onTurnEnd(); await sleep(50); };

    // The user's turn starts: the agent joins once.
    run(startCallback)('Please fix it', 'turn-1');
    assert.equal(rows('Bhaskar joined'), 1);
    toolCall();

    // Mid-turn Stop hooks that are not this window's turn end.
    stop(otherWindow); toolCall(); await poll();
    assert.equal(rows('Bhaskar left'), 0, 'another window\'s chat stopping does not make this agent leave');
    stop({ ...mine, agent_id: 'child-1' }); toolCall(); await poll();
    assert.equal(rows('Bhaskar left'), 0, 'a sub-agent stop is not the turn end');
    stop(mine); fs.writeFileSync(path.join(cfg, 'finish-gate-state.json'), JSON.stringify({ lastBlock: Date.now() })); toolCall(); await poll();
    assert.equal(rows('Bhaskar left'), 0, 'a stop the finish gate blocked is not the turn end');
    toolCall(); toolCall();
    assert.equal(seen.length, 0, 'no turn-end prediction before the turn really ends');
    assert.equal(rows('Bhaskar joined'), 1, 'tool calls inside the turn never add a second join row');
    assert.ok(logs.filter(message => /stamp ignored/.test(message)).length === 3, 'each non-final stop is logged as ignored');

    // The real end: the gate allows it (stop_hook_active), and the hook may stamp it twice.
    fs.writeFileSync(path.join(cfg, 'finish-gate-state.json'), JSON.stringify({ lastBlock: Date.now() - 60000 }));
    stop({ ...mine, stop_hook_active: true }); await poll();
    assert.equal(rows('Bhaskar left'), 1, 'the agent leaves once, at the real turn end');
    assert.equal(seen.length, 1, 'the Validator predicts once, at the real turn end');
    assert.ok(seen[0].text.includes('Response Handoff'));
    stop({ ...mine, stop_hook_active: true }); await poll();
    assert.equal(rows('Bhaskar left'), 1); assert.equal(rows('Bhaskar joined'), 1); assert.equal(seen.length, 1, 'a repeated stamp changes nothing');
    assert.equal(failures.length, 0);

    // The next user turn joins again; a stale stamp-info file from another stop never matches a different stamp.
    run(startCallback)('Another request', 'turn-2');
    assert.equal(rows('Bhaskar joined'), 2);
    console.log('PASS EV-AITALK-AGENT-PRESENCE: during one turn the main agent joins once and leaves once at the end; a turn-end trigger fires once per user turn');
    notifier.dispose();
})().catch(error => { console.error('FAIL EV-AITALK-AGENT-PRESENCE:', error); process.exitCode = 1; }).finally(() => { process.env.HOME = realHome; });
