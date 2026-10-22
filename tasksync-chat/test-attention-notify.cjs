const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
async function main() {
    let mode = 'here', focused = false, visible = true, choice = 'Open AITalk';
    const shown = [], commands = [], posts = [], reveals = [];
    const view = { get visible() { return visible; }, show: preserveFocus => reveals.push(preserveFocus), webview: { postMessage: async message => posts.push(message) } };
    const vscode = { window: { state: { get focused() { return focused; } }, showInformationMessage: async (...args) => { shown.push(args); return choice; } }, commands: { executeCommand: async name => commands.push(name) } };
    const build = await esbuild.build({ entryPoints: [path.join(__dirname, 'src/services/attentionNotify.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), mod, mod.exports);
    const { notifyAttention, registerAttentionNotify } = mod.exports;
    const registration = registerAttentionNotify({ availability: () => mode ? { mode } : undefined, view: () => view });
    const triggers = [{ kind: 'heads-up' }, { kind: 'question', pending: true, to: 'user' }, { kind: 'message', mentions: ['user'] }, { kind: 'message', text: '@user please review' }];
    for (const [index, trigger] of triggers.entries()) {
        for (const state of [{ focused: false, visible: true }, { focused: true, visible: false }]) {
            focused = state.focused; visible = state.visible;
            const item = { id: `${index}-${focused}`, text: 'Please review the choice', ...trigger };
            const count = shown.length; await Promise.all([notifyAttention(item), notifyAttention(item)]);
            assert.equal(shown.length, count + 1); assert.deepEqual(shown.at(-1), [item.text, 'Open AITalk']);
            assert.equal(commands.at(-1), 'askAwayView.focus'); assert.deepEqual(posts.at(-1), { type: 'switchTab', tab: 'aitalk' }); assert.equal(reveals.at(-1), true);
        }
    }
    console.log('PASS heads-up, pending user question and user mention notify once; unfocused or hidden; action opens AITalk');
    const before = shown.length;
    for (mode of ['away', 'awayValidator', 'offline', undefined]) {
        focused = false; visible = false;
        for (const [index, trigger] of triggers.entries()) await notifyAttention({ id: `${mode}-${index}`, text: 'Need review', ...trigger });
    }
    mode = 'here'; focused = true; visible = true;
    await notifyAttention({ id: 'in-view', kind: 'heads-up', text: 'Need review' });
    focused = false;
    for (const item of [{ kind: 'update' }, { kind: 'question', pending: false, to: 'user' }, { kind: 'question', pending: true, to: 'validator' }, { mentions: ['agent'] }, { text: 'email@user.example' }]) await notifyAttention({ id: JSON.stringify(item), text: 'Need review', ...item });
    assert.equal(shown.length, before);
    console.log('PASS focused+visible, Away/Offline/unknown, ordinary updates and non-user/resolved questions suppressed');
    choice = undefined; const actionsBefore = commands.length;
    await notifyAttention({ id: 'dismissed', kind: 'heads-up', text: 'Need review' });
    assert.equal(commands.length, actionsBefore);
    registration.dispose(); await notifyAttention({ id: 'disposed', kind: 'heads-up', text: 'Need review' }); assert.equal(shown.length, before + 1);
    const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
    assert.match(extension, /registerAttentionNotify\(\{ availability[:,]/); assert.match(extension, /notifyAttention\(item\)/); assert.doesNotMatch(extension, /provider\.waitForUserResponse/);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8'), /waitForUserResponse/, 'AITalk attention works without the retired request queue');
    console.log('PASS EV-ATTENTION-NOTIFY');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
