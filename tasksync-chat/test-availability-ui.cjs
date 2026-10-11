// Availability selector (T019): render block + provider writer + the real hook. Run: node test-availability-ui.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const slice = (text, a, b) => {
    const from = text.indexOf(a);
    const to = text.indexOf(b);
    assert.ok(from >= 0 && to > from, `${a} present`);
    return text.slice(from, to);
};

// Caller-view frame and title-bar command contract.
const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const ui = {};
const classes = new Set();
vm.runInNewContext(`${slice(webview, '    function applyAvailabilityState', '    function initCommentaryTab')}\nout.apply = applyAvailabilityState;`, { out: ui, document: { body: { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } } } });
const manifest = require('./package.json');
for (const mode of ['here', 'away', 'awayValidator', 'offline']) {
    ui.apply({ mode });
    assert.deepEqual([...classes], ['avail-' + mode]);
    const command = manifest.contributes.commands.find(row => row.command === 'askaway.availability.' + mode);
    assert.ok(command);
    for (const theme of ['light', 'dark']) assert.match(fs.readFileSync(path.join(__dirname, command.icon[theme]), 'utf8'), /<svg/);
    assert.ok(manifest.contributes.menus['view/title'].some(row => row.command === command.command && row.group === 'navigation@0' && row.when === `view == askAwayView && askaway.availability == '${mode}'`));
}
assert.doesNotMatch(webview, /cm-avail|availabilityControlHtml/);
assert.match(webview, /case 'availabilityState':\s*applyAvailabilityState\(message\.data\)/);
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
assert.doesNotMatch(provider, /id="cm-avail"/);
assert.match(provider, /case 'setAvailability'/);

// Provider writer (real source, transpiled) with the real commentaryKey.
const commentarySrc = fs.readFileSync(path.join(__dirname, 'src', 'commentary', 'commentary.ts'), 'utf8');
const keyFn = commentarySrc.slice(commentarySrc.indexOf('export function commentaryKey'), commentarySrc.indexOf('export function uncleared'));
const writerSrc = slice(provider, '// ── availability state (pure', '// ── end availability state ──');
const code = ts.transpileModule(`${keyFn}\n${writerSrc}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { require, exports: mod.exports, module: mod, Date, fs, os, path });
const { writeAvailability, readAvailability } = mod.exports;
const extension = fs.readFileSync(path.join(__dirname, 'src', 'extension.ts'), 'utf8');
const commands = {};
let selected, contextMode;
const pickerCode = slice(extension, '        const presence = [', '        // Session commands');
vm.runInNewContext(ts.transpileModule(pickerCode, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: '/fixture' } }] }, window: { showQuickPick: async items => { assert.equal(items.length, 4); assert.match(items[0].description, /Current/); return items.find(row => row.mode === selected); } }, commands: { registerCommand: (name, fn) => { commands[name] = fn; return {}; } } },
    context: { subscriptions: [] }, readAvailability: () => ({ mode: 'here' }), writeAvailability: (_root, state) => { contextMode = state.mode; }, provider: { _pushAvailability() {} }
});
const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /body\.avail-awayValidator::before[^}]+animation: presence-glow/);
assert.match(provider, /'setContext', 'askaway.availability'/);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-avail-ui-home-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-avail-ui-ws-'));
const hook = () => childProcess.execFileSync(process.execPath, [path.join(__dirname, 'hooks', 'spec-context-inject.cjs')], {
    input: JSON.stringify({ session_id: `s-${Math.random()}`, cwd: workspace }),
    env: { ...process.env, HOME: home }, encoding: 'utf8',
});
try {
    assert.equal(readAvailability(workspace, home), null);
    const until = new Date(Date.now() + 3600000).toISOString();
    writeAvailability(workspace, { mode: 'away', until, note: 'back\nsoon' }, home);
    assert.deepEqual({ ...readAvailability(workspace, home), setAt: 0 }, { mode: 'away', until, note: 'back soon', setAt: 0 });
    const away = JSON.parse(hook()).hookSpecificOutput.additionalContext;
    assert.match(away, /Reviewer: Away \(reachable on Telegram\)/);
    assert.match(away, /Reviewer note: back soon/);

    writeAvailability(workspace, { mode: 'offline', until: '', note: '' }, home);
    assert.match(JSON.parse(hook()).hookSpecificOutput.additionalContext, /Reviewer: Offline \(not reachable\)/);

    writeAvailability(workspace, { mode: 'bogus', until: 'garbage' }, home);
    assert.equal(readAvailability(workspace, home).mode, 'here', 'unknown mode falls back to Here');
    assert.equal(hook(), '', 'Here injects nothing');
    for (const mode of ['here', 'away', 'awayValidator', 'offline']) {
        writeAvailability(workspace, { mode }, home);
        assert.equal(readAvailability(workspace, home).mode, mode);
    }
    (async () => { for (const mode of ['here', 'away', 'awayValidator', 'offline']) { selected = mode; await commands['askaway.availability.' + mode](); assert.equal(contextMode, mode); } console.log('PASS EV-AVAILABILITY-UI four title commands; picker writes four states; body frames; Commentary selector absent'); })().catch(error => { console.error(error); process.exitCode = 1; });
} finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
}
