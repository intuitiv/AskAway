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
const config = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/availability/presence.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: config.exports });
let flyout, posted;
const browser = { out: ui, Date, escapeHtml: s => s, vscode: { postMessage: message => { posted = message; } }, document: {
    getElementById: () => flyout,
    createElement: () => ({ innerHTML: '', handlers: {}, setAttribute() {}, addEventListener(type, fn) { this.handlers[type] = fn; }, querySelector() { return { focus() {} }; }, remove() { flyout = null; } }),
    body: { appendChild(el) { flyout = el; }, style: { setProperty() {} }, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } }
} };
const presenceModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'media/aitalk/presence.js'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, allowJs: true, target: ts.ScriptTarget.ES2022 } }).outputText, { module: presenceModule, exports: presenceModule.exports, require: () => ({ escapeHtml: s => s }), Date });
let control = presenceModule.exports.createPresence({ name: 'Sam Morgan' });
ui.apply = state => { for (const value of config.exports.presenceStates) browser.document.body.classList.toggle('avail-' + value.id, value.id === state.mode); control = presenceModule.exports.createPresence({ mode: state.mode, name: 'Sam Morgan' }); };
ui.choose = mode => { control.choose(mode); const state = control.snapshot(); posted = { type: 'setAvailability', mode, until: state.expiresAt ? new Date(state.expiresAt).toISOString() : '', note: '' }; flyout = null; };
ui.open = () => { control.toggle(); flyout = { innerHTML: control.html(), handlers: { keydown: event => { control.key(event.key); if (!control.snapshot().open) flyout = null; }, change: event => control.setReset(event.target.value) } }; };
const manifest = require('./package.json');
for (const mode of ['here', 'away', 'awayValidator', 'offline']) {
    ui.apply({ mode });
    assert.deepEqual([...classes], ['avail-' + mode]);
    assert.equal(manifest.contributes.commands.some(row => row.command === 'askaway.availability.' + mode), false);
    assert.equal((manifest.contributes.menus?.['view/title'] || []).some(row => row.command === 'askaway.availability.' + mode), false);
}
assert.doesNotMatch(JSON.stringify(manifest), /media\/icons\/presence-/);
console.log('PASS test-presence-icons: native title availability commands/icons/menus absent; shared AITalk avatar owns availability');
assert.doesNotMatch(webview, /cm-avail|availabilityControlHtml/);
assert.match(webview, /case 'openPresence':\s*openPresence\(\)/);
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
let opened = 0;
const pickerCode = 'provider._pushAvailability();';
assert.doesNotMatch(extension, /registerCommand\('askaway\.availability\./);
vm.runInNewContext(ts.transpileModule(pickerCode, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    presenceStates: config.exports.presenceStates,
    vscode: { commands: { registerCommand: (name, fn) => { commands[name] = fn; return {}; } } },
    context: { subscriptions: [] }, provider: { openPresence() { opened++; }, _pushAvailability() {} }
});
assert.doesNotMatch(pickerCode, /showQuickPick/);
assert.match(provider, /_broadcast\(\{ type: 'openPresence' \}\)/);
ui.open();
for (const state of config.exports.presenceStates) {
    assert.ok(flyout.innerHTML.includes(state.label)); assert.ok(flyout.innerHTML.includes(state.meaning));
    assert.ok(flyout.innerHTML.includes('data-presence="' + state.id + '"'));
}
assert.match(flyout.innerHTML, /presence-badge/);
flyout.handlers.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(flyout, null);
const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
assert.match(css, /prefers-reduced-motion/);
// One hue per mode as a static light→strong gradient; no second accent colour, no pulsing (2026-10-14).
const frame = css.match(/body\[class\*="avail-"\]::before, \.availability-frame::before \{[^}]+\}/)[0];
assert.match(frame, /linear-gradient\(135deg, color-mix\(in srgb, var\(--presence\) \d+%, transparent\), var\(--presence\)\)/);
assert.doesNotMatch(css + fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8'), /presence-accent|presence-glow/);
for (const mode of ['here', 'away', 'awayValidator', 'offline']) assert.equal((css.match(new RegExp(`body\\.avail-${mode},[^{]*\\{ --presence: var\\(--vscode-[\\w-]+\\); \\}`, 'g')) || []).length, 1, `${mode} has one hue`);
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
    for (const mode of ['here', 'away', 'awayValidator', 'offline']) {
        ui.open(); ui.choose(mode);
        assert.equal(posted.mode, mode); writeAvailability(workspace, posted, home);
        ui.apply(readAvailability(workspace, home)); assert.deepEqual([...classes], ['avail-' + mode]);
    }
    assert.equal(opened, 0, 'no native title command is registered');
    ui.open(); flyout.handlers.change({ target: { value: '30m' } }); ui.choose('away');
    assert.ok(Date.parse(posted.until) > Date.now() + 29 * 60000);
    writeAvailability(workspace, { mode: 'away', until: new Date(Date.now() - 1000).toISOString() }, home);
    assert.equal(readAvailability(workspace, home).mode, 'here');
    assert.equal(JSON.parse(fs.readFileSync(mod.exports.availabilityFile(workspace, home), 'utf8')).mode, 'here');
    assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false, 'CRLF preserved');
    console.log('PASS EV-AVAILABILITY-UI title openPresence; config four-state flyout badge/label/meaning; persisted selection/frame; reset expiry Here; Escape; quick pick removed; CRLF');
} finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
}
