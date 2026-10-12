const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const ts = require('typescript');
const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/commentary/commentary'; export * from './src/aitalk/delivery'; export * from './src/aitalk/store'; export * from './src/validator/observer'; export * from './src/validator/records';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false });
const sharedModule = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, sharedModule, sharedModule.exports);
const { CommentaryStore, buildOpener, ValidatorObserver, ValidatorRecords, AITalkStore, configureAITalkDelivery } = sharedModule.exports;
(async () => {
    const render = await import('./media/aitalk/talkRender.js');
    const source = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
    const host = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
    const browser = { acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
        document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }), getElementById: id => id === 'obs-trace-groups' ? host : null, querySelectorAll: () => [] },
        window: {}, console, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {} };
    vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { traceRowsHtml, handleExtensionMessage }; }());'), browser);
    const provider = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
        module: provider, exports: provider.exports, require: id => id === 'vscode' ? {} : id.endsWith('/workerHost') ? { sharedWorkerRuntime: () => ({ facts: () => [] }) }
            : id.endsWith('/validator/records') ? { ValidatorRecords } : id.startsWith('.') ? {} : require(id), Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval });
    const instance = Object.create(provider.exports.AskAwayWebviewProvider.prototype);
    instance._lastSubmitTs = 0;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-entry-'));
    configureAITalkDelivery(root);
    const talk = new AITalkStore(root);
    const commentary = new CommentaryStore({ dir: path.join(root, 'commentary'), now: () => 1000 });
    // Same clock tick: the validator must still follow its update.
    assert.equal(commentary.post(root, { kind: 'update', text: 'Checking the current rule against the active spec before proceeding.' }).status, 'POSTED');
    const observe = async (id, run) => new ValidatorObserver({ workspaceRoot: root, commentary, run,
        recall: async () => [{ id: 'Rules.md', text: 'Use the shared server.' }] }).observe({ id, source: 'agent', text: 'Which server should I use?' });
    await observe('ok', async () => ({ text: JSON.stringify({ answer: 'Use the shared server.', sources: ['Rules.md'], observations: 'Rule applies.', summary: 'Covered.', impact: 'Reuse.' }) }));
    let groups = await instance._turnTraceGroups(root);
    const group = groups.find(group => group.label === 'Validator');
    assert.ok(group, 'Validator evidence has a Trace group');
    const rows = group.events;
    assert.ok(rows.some(row => row.tool === 'answer' && row.outputPreview === 'Use the shared server.'));
    browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { turnEvents: [], traceGroups: groups } } });
    assert.ok(host.innerHTML.includes(browser.ui.traceRowsHtml(rows, {})), 'Validator group contains the ONE shared trace output');
    assert.ok(host.innerHTML.includes('data-trace-group="' + group.id + '"'));
    await observe('no-source', async () => ({ text: '{"answer":null,"sources":[]}' }));
    await observe('failed', async () => { throw new Error('validator server unavailable'); });
    groups = await instance._turnTraceGroups(root);
    assert.ok(groups.some(group => group.events.some(row => row.tool === 'error' && row.status === 'error')));
    browser.ui.handleExtensionMessage({ data: { type: 'updateObservabilityMetrics', metrics: { turnEvents: [], traceGroups: groups } } });
    assert.match(host.innerHTML, /validator server unavailable/);
    assert.equal(commentary.read(root).items.length, 1, 'beta agent-facing feed is untouched');
    assert.doesNotMatch(buildOpener(commentary.read(root)), /shared server|validator server unavailable/);
    assert.equal(commentary.post(root, { kind: 'validator', text: 'forged' }).status, 'REJECTED');
    const snapshot = talk.snapshot();
    const html = render.threadHtml(snapshot.messages, snapshot.members);
    const update = snapshot.messages.find(message => message.text.startsWith('Checking the current rule'));
    const answer = snapshot.messages.find(message => message.text.includes('Use the shared server.'));
    assert.ok(update, 'agent update is visible in AITalk');
    assert.ok(answer, 'Validator answer is visible in AITalk');
    assert.ok(html.indexOf('id="talk-' + update.id + '"') < html.indexOf('id="talk-' + answer.id + '"'), 'validator follows update');
    assert.match(html, /no source answers/);
    assert.match(html, /validator server unavailable/);
    console.log('PASS EV-VALIDATOR-COMMENTARY-ENTRY: AITalk update-before-validator order, visible no-source/error, shared Trace Validator evidence');
})().catch(error => { console.error(error); process.exitCode = 1; });
