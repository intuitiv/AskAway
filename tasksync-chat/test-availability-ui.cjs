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

// Render block from the real webview.js.
const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const ui = {};
vm.runInNewContext(`${slice(webview, '// ── Availability control + badge', '// ── end Availability pure render ──')}\nout.control = availabilityControlHtml; out.badge = availabilityBadge; out.local = availabilityLocalValue;`, { out: ui });
const control = ui.control();
for (const id of ['cm-avail-mode', 'cm-avail-until', 'cm-avail-note', 'cm-avail-badge']) { assert.match(control, new RegExp(`id="${id}"`)); }
assert.match(control, /<option value="here">Here<\/option><option value="away">Away \(Telegram\)<\/option><option value="offline">Offline<\/option>/);
const now = new Date(2026, 9, 2, 12, 0, 0).getTime();
assert.equal(ui.badge({ mode: 'here' }, now), '', 'Here shows nothing');
assert.equal(ui.badge(null, now), '');
assert.equal(ui.badge({ mode: 'away', until: new Date(2026, 9, 2, 18, 30).toISOString() }, now), 'Away until 18:30');
assert.equal(ui.badge({ mode: 'offline', until: new Date(2026, 9, 3, 7, 5).toISOString() }, now), 'Offline until 10-03 07:05');
assert.equal(ui.badge({ mode: 'offline' }, now), 'Offline');
assert.equal(ui.badge({ mode: 'away', until: new Date(2026, 9, 2, 11, 0).toISOString() }, now), '', 'expired until shows nothing');
assert.equal(ui.local(new Date(2026, 9, 2, 18, 30).toISOString()), '2026-10-02T18:30');
// Wiring: the control posts one message type, the provider answers with one.
assert.match(webview, /type: 'setAvailability'/);
assert.match(webview, /case 'availabilityState':\s*applyAvailabilityState\(message\.data\)/);
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
assert.match(provider, /id="cm-avail"/);
assert.match(provider, /case 'setAvailability'/);

// Provider writer (real source, transpiled) with the real commentaryKey.
const commentarySrc = fs.readFileSync(path.join(__dirname, 'src', 'commentary', 'commentary.ts'), 'utf8');
const keyFn = commentarySrc.slice(commentarySrc.indexOf('export function commentaryKey'), commentarySrc.indexOf('export function uncleared'));
const writerSrc = slice(provider, '// ── availability state (pure', '// ── end availability state ──');
const code = ts.transpileModule(`${keyFn}\n${writerSrc}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { require, exports: mod.exports, module: mod, Date, fs, os, path });
const { writeAvailability, readAvailability } = mod.exports;

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
    console.log('PASS EV-AVAILABILITY-UI');
} finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
}
