// EV-LONG-RUN-HANDOFF: over 300K input while Away/Offline -> hook text, tool-result line, one Telegram notice (Away). Run: node test-long-run-handoff.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-long-run-build-'));
fs.writeFileSync(path.join(buildDir, 'handoffThreshold.js'), ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'src', 'specs', 'handoffThreshold.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
const { LongRunHandoff, handoffNeeded } = require(path.join(buildDir, 'handoffThreshold.js'));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-long-run-home-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-long-run-ws-'));
const key = fs.realpathSync(workspace).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const file = path.join(home, '.askaway', 'availability', `${key}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
const hook = () => childProcess.execFileSync(process.execPath, [path.join(__dirname, 'hooks', 'spec-context-inject.cjs')], {
    input: JSON.stringify({ session_id: 'long-run', cwd: workspace }), env: { ...process.env, HOME: home }, encoding: 'utf8',
});
const hookText = () => { const out = hook(); return out ? JSON.parse(out).hookSpecificOutput.additionalContext : ''; };
const HOOK_RE = /Input exceeded 300K on a long run: write \/sk\.handoff now and continue in a new conversation/;

// One stubbed "latest main-chat request": the extension's tool-result path, then the external hook.
function step(gate, mode, tokens) {
    fs.writeFileSync(file, JSON.stringify({ mode, setAt: new Date().toISOString() }));
    const line = gate.check(file, tokens, mode);
    return { line, hook: hookText() };
}

try {
    assert.equal(handoffNeeded({ lastInputTokens: 301000, availability: 'here' }), false);
    assert.equal(handoffNeeded({ lastInputTokens: 300000, availability: 'away' }), false);

    const notices = [];
    const gate = new LongRunHandoff((text) => { notices.push(text); });

    let r = step(gate, 'away', 299000);
    assert.equal(r.line, ''); assert.doesNotMatch(r.hook, HOOK_RE); assert.equal(notices.length, 0);

    r = step(gate, 'away', 301000);
    assert.equal(r.line, 'Context over 300K while Away: run /sk.handoff now, then continue in a new conversation');
    assert.match(r.hook, HOOK_RE);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /Context over 300K while Away/);

    r = step(gate, 'away', 305000);
    assert.match(r.line, /while Away/);
    assert.equal(notices.length, 1, 'second crossing sends no second notice');

    r = step(gate, 'here', 301000);
    assert.equal(r.line, ''); assert.doesNotMatch(r.hook, HOOK_RE); assert.equal(notices.length, 1);

    r = step(new LongRunHandoff((t) => notices.push(t)), 'offline', 301000);
    assert.equal(r.line, 'Context over 300K while Offline: run /sk.handoff now, then continue in a new conversation');
    assert.match(r.hook, HOOK_RE);
    assert.equal(notices.length, 1, 'Offline sends no Telegram notice');

    // ask_user was removed (reviewer 2026-10-13); the hook line above and the Telegram notifier carry the decision.
    const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
    assert.match(provider, /new LongRunHandoff\(text => HandoffNotifier\.current\?\.postLongRunNotice\(text\)\)/);
    console.log('PASS EV-LONG-RUN-HANDOFF');
} finally {
    for (const dir of [buildDir, home, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
}
