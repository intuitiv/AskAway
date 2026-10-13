const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const esbuild = require('esbuild');
const vm = require('node:vm');
(async () => {
    const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/validator/validatorTriggers'; export * from './src/validator/observer'; export * from './src/commentary/commentary'; export * from './src/workers/openCodeRuntime'; export * from './src/workers/workerProfiles';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
    const api = mod.exports;
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-presence-')));
    const store = new api.AITalkStore(root);
    api.activateAITalk(root);
    const member = kind => store.snapshot().members.find(item => item.kind === kind);
    assert.equal(member('user').presence, 'joined'); assert.equal(member('validator').presence, 'joined');
    assert.equal(member('agent').presence, 'left');
    const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
    const startCallback = extension.match(/provider\.setValidatorTurnStart\((\(text, id\) => \{[^\n]+\})\);/)[1];
    const stopCallback = extension.match(/(\(text, id\) => \{ setAITalkTurnActive\(memoryProject, false\);[^\n]+\})/)[1];
    const turns = [];
    const context = { memoryProject: root, setAITalkTurnActive: api.setAITalkTurnActive,
        triggers: { previousFinal: () => 'previous', turnStart: (...args) => turns.push(['start', ...args]), turnEnd: (...args) => turns.push(['end', ...args]) } };
    vm.runInNewContext(`(${startCallback})`, context)('start message', 'turn-presence'); assert.equal(member('agent').presence, 'joined');
    assert.ok(member('agent').joinedAt);
    vm.runInNewContext(`(${stopCallback})`, context)('final message', 'turn-presence'); assert.equal(member('agent').presence, 'left'); assert.ok(member('agent').leftAt);
    assert.deepEqual(turns, [['start', 'previous', 'start message', 'turn-presence'], ['end', 'final message', 'turn-presence']]);
    assert.match(extension, /setWorkerPresenceLifecycle\(setAITalkWorkerPresence\)/);
    for (const file of ['workerHost.ts', 'openCodeRuntime.ts']) {
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'src/workers', file), 'utf8'), /(?:from\s*|require\()['"]\.\.\/aitalk\/store/);
    }
    const profile = api.parseWorkerProfile('---\nname: verify\ndescription: "fixture"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\n---\nBody.\n');
    let child;
    const runtime = new api.OpenCodeWorkerRuntime([profile], { onPresence: api.setAITalkWorkerPresence, ledgerDir: path.join(root, 'ledger'), setTimer: () => () => {}, spawner: () => {
        child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => true; return child;
    } });
    const run = runtime.start({ workspacePath: root, profile: 'verify', dispatchTurnId: 'turn', baseRevision: 'abc123', objective: 'Verify presence', allowedFiles: ['fixture.js'], acceptance: 'presence lifecycle', expected: 'PASS', command: 'node fixture.js' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.snapshot().members.find(item => item.id === run.workerId).presence, 'joined');
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false, 'provider CRLF preserved');
    const polling = provider.slice(provider.indexOf("            case 'requestAITalk':"), provider.indexOf("            case 'requestAITalk':") + 4000);
    const pollingBlock = polling.slice(0, polling.indexOf('\n            case ', polling.indexOf("case 'aitalkReact':")));
    const poll = require('typescript').transpileModule(`async function poll(message) { switch(message.type) { ${pollingBlock} } }`, { compilerOptions: { target: 9 } }).outputText;
    for (const workerState of ['STARTING', 'RUNNING', 'WAITING_APPROVAL']) {
        let delivered;
        const pollingContext = { AITalkStore: api.AITalkStore, vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: () => '' }) }, extensions: { getExtension: () => undefined } }, os, path, fs,
            projectWorkersState: () => ({ workers: [{ workerId: run.workerId, state: workerState }] }), sharedWorkerRuntime: () => runtime,
            setAITalkPresence: api.setAITalkPresence, isAITalkTurnActive: api.isAITalkTurnActive };
        const invokePoll = vm.runInNewContext(poll + ';poll', pollingContext);
        await invokePoll.call({ _broadcast: message => { delivered = message.data; } }, { type: 'requestAITalk' });
        assert.equal(delivered.members.find(item => item.id === run.workerId).presence, 'joined', `${workerState} polling must retain lifecycle presence`);
    }
    child.stdout.write(JSON.stringify({ type: 'text', sessionID: 'fixture', part: { text: 'Result: PASS' } }) + '\n');
    await new Promise(resolve => setImmediate(resolve)); child.emit('exit', 0, null);
    assert.equal(store.snapshot().members.find(item => item.id === run.workerId).presence, 'left');
    const notices = store.snapshot().messages.filter(item => item.kind === 'system');
    assert.ok(notices.some(item => item.text === 'Agent joined')); assert.ok(notices.some(item => item.text === 'Agent left'));
    api.configureAITalkDelivery(root);
    let calls = 0, release;
    const blocked = new Promise(resolve => { release = resolve; });
    const observer = new api.ValidatorObserver({ workspaceRoot: root,
        commentary: new api.CommentaryStore({ dir: path.join(root, 'commentary') }),
        recall: async () => [{ id: 'fixture', text: 'Use green.' }],
        run: async input => { calls++; assert.match(input.prompt, /choose a colour/); await blocked;
            return { text: JSON.stringify({ answer: 'Use green', sources: ['fixture'] }) }; } });
    const triggers = new api.ValidatorTriggers(root, async () => observer, () => 'fixture', () => assert.fail('Validator failed'));
    const routing = api.registerAITalkValidator(root, (text, id) => triggers.validatorCall(text, id));
    const question = store.post('@Validator choose a colour').messages.at(-1);
    assert.equal(question.tick, 'sent');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); assert.equal(new api.AITalkStore(root).snapshot().messages.find(item => item.id === question.id).tick, 'delivered');
    release(); await routing.flush();
    const snapshot = new api.AITalkStore(root).snapshot();
    assert.equal(snapshot.messages.find(item => item.id === question.id).tick, 'read');
    assert.ok(snapshot.messages.some(item => item.author === member('validator').id && item.replyTo === question.id && item.text === 'Use green'));
    store.post('ordinary progress'); await routing.flush(); assert.equal(calls, 1);
    routing.dispose();
    console.log('PASS EV-AITALK-PRESENCE activation, turn and worker lifecycle; @Validator model reply with replyTo; persisted sent → delivered → read');
})().catch(error => { console.error(error); process.exitCode = 1; });
