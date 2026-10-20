// The AITalk header has a Clear chat button; clearing empties the conversation and keeps who is in the room (R-AITALK-33).
// Run: node test-aitalk-clear.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const load = relative => {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, relative)], bundle: true, external: ['vscode'], platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const loaded = { exports: {} };
    vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require, __dirname, Buffer, console, process, setTimeout, clearTimeout });
    return loaded.exports;
};
const { AITalkStore } = load('src/aitalk/store.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-clear-'));
const store = new AITalkStore(root);
const agent = store.snapshot().members.find(member => member.kind === 'agent');
store.setPresence(agent, true);
store.post('Hello team');
assert.ok(store.snapshot(true).messages.some(message => message.kind === 'system'), 'the join line exists before clearing');
assert.ok(store.snapshot(true).messages.length >= 2);

store.clear();
const after = store.snapshot(true);
assert.equal(after.messages.length, 0, 'no message and no old join/leave line is left');
const presence = Object.fromEntries(after.members.map(member => [member.id, member.presence]));
assert.equal(presence[agent.id], 'joined', 'the agent stays in the room');
assert.equal(after.members.find(member => member.kind === 'user').presence, 'joined');
store.post('After clear');
assert.equal(store.snapshot(true).messages.length, 1, 'the room works as before after clearing');
store.setPresence(agent, false);
assert.ok(store.snapshot(true).messages.some(message => message.text.endsWith('left')), 'a later leave is announced as usual');
new AITalkStore(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-empty-'))).clear();

const render = fs.readFileSync(path.join(__dirname, 'media/aitalk/talkRender.js'), 'utf8');
assert.match(render, /<header class="talk-header">[\s\S]*data-clear-chat aria-label="Clear chat"/, 'the header carries the button');
const controller = fs.readFileSync(path.join(__dirname, 'media/aitalk/talkController.js'), 'utf8');
assert.match(controller, /data-clear-chat'\)\) \{ post\(\{ type: 'aitalkClear' \}\)/);
const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
assert.match(provider, /case 'aitalkClear'[\s\S]{0,500}modal: true[\s\S]{0,300}new AITalkStore\(root\)\.clear\(\)/, 'the extension confirms before clearing');
console.log('test-aitalk-clear: passed (EV-AITALK-CLEAR)');
