const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const manifest = require('./package.json');
const provider = fs.readFileSync(__dirname + '/src/webview/webviewProvider.ts', 'utf8');
const panel = provider.match(/id="panel-settings">([\s\S]*?)<!-- End panel-settings -->/)[1];
assert.doesNotMatch(panel, /cm-goal|cm-copy|Main goal|Copy opener/);
const nodes = [];
const host = { innerHTML: '', appendChild(node) { nodes.push(node); } };
const element = () => ({ appendChild(node) { nodes.push(node); }, addEventListener() {}, setAttribute() {}, innerHTML: '' });
const browser = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
    document: { readyState: 'loading', addEventListener() {}, createElement: element, getElementById: id => id === 'settings-tab-shell' ? host : null },
    window: {}, console, setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {} };
const source = fs.readFileSync(__dirname + '/media/webview.js', 'utf8');
assert.doesNotMatch(source, /function (?:handleAttach|toggleModeDropdown|positionModeDropdown|setMode)\(/, 'uncalled Chat entry points are removed');
vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.renderSettings = createSettingsModal; }());'), browser);
browser.renderSettings();
assert.doesNotMatch(nodes.map(node => node.innerHTML).join(''), /sound-toggle|send-shortcut-toggle|Ctrl\/Cmd\+Enter|cm-goal|cm-copy/);
for (const key of ['askaway.sendWithCtrlEnter', 'askaway.notificationSound']) assert.ok(!Object.hasOwn(manifest.contributes.configuration.properties, key));
assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false, 'provider stays CRLF');
console.log('PASS settings cleanup: goal/copy, Chat send shortcut and old notifications absent from rendered Settings and configuration');
