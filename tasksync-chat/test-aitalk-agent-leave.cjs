// The main agent leaves the AITalk room when the turn ends, even when the final text has no Response Handoff (R-AITALK-32).
// Run: node test-aitalk-agent-leave.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/services/handoffNotifier.ts')], bundle: true, external: ['vscode'],
    platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const loaded = { exports: {} };
const vscode = { workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) } };
vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require: id => (id === 'vscode' ? vscode : require(id)), __dirname, Buffer, console, process, setTimeout, clearTimeout });
const { HandoffNotifier } = loaded.exports;

(async () => {
    let left = 0, stamp = 1000;
    const notifier = new HandoffNotifier([], undefined, () => {}, undefined, async () => {}, () => { left++; });
    notifier._readStamp = () => stamp;
    notifier._findHandoff = () => undefined;
    await notifier._onTurnEnd();
    assert.equal(left, 1, 'agent leaves at turn end although no handoff was found');
    await notifier._onTurnEnd();
    assert.equal(left, 1, 'the same turn end never announces a second departure');
    stamp = 2000;
    await notifier._onTurnEnd();
    assert.equal(left, 2, 'the next turn end leaves again');
    console.log('test-aitalk-agent-leave: passed (EV-AITALK-LEAVE)');
})().catch(error => { console.error(error); process.exitCode = 1; });
