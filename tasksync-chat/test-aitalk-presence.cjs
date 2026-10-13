const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const esbuild = require('esbuild');
const vm = require('node:vm');
(async () => {
    const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/validator/validatorTriggers'; export * from './src/validator/observer'; export * from './src/commentary/commentary'; export * from './src/workers/openCodeRuntime'; export * from './src/workers/workerProfiles';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
    const api = mod.exports;
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-presence-')));
    const store = new api.AITalkStore(root);
    const member = kind => store.snapshot().members.find(item => item.kind === kind);
    // A stale registration from an earlier window is cleared at activation; actors register themselves.
    store.setPresence(member('agent'), true);
    api.roomFor(root).activate();
    assert.equal(member('user').presence, 'joined'); assert.equal(member('agent').presence, 'left');
    const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
    const startCallback = extension.match(/provider\.setValidatorTurnStart\((\(text, id\) => \{[^\n]+\})\);/)[1];
    const stopCallback = extension.match(/(\(text, id\) => \{ roomFor\(memoryProject\)\.unregisterAgent\(\);[^\n]+\})/)[1];
    const turns = [];
    const context = { memoryProject: root, roomFor: api.roomFor,
        triggers: { previousFinal: () => 'previous', turnStart: (...args) => turns.push(['start', ...args]), turnEnd: (...args) => turns.push(['end', ...args]) } };
    vm.runInNewContext(`(${startCallback})`, context)('start message', 'turn-presence'); assert.equal(member('agent').presence, 'joined');
    assert.ok(member('agent').joinedAt);
    vm.runInNewContext(`(${stopCallback})`, context)('final message', 'turn-presence'); assert.equal(member('agent').presence, 'left'); assert.ok(member('agent').leftAt);
    assert.deepEqual(turns, [['start', 'previous', 'start message', 'turn-presence'], ['end', 'final message', 'turn-presence']]);
    assert.match(extension, /setWorkerPresenceLifecycle\(\(workspace, worker, running\) => roomFor\(workspace\)\.workerLifecycle\(worker, running\)\)/);
    for (const file of ['workerHost.ts', 'openCodeRuntime.ts']) {
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'src/workers', file), 'utf8'), /(?:from\s*|require\()['"]\.\.\/aitalk\//);
    }
    const profile = api.parseWorkerProfile('---\nname: verify\ndescription: "fixture"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\n---\nBody.\n');
    let child;
    const runtime = new api.OpenCodeWorkerRuntime([profile], { onPresence: (workspace, worker, running) => api.roomFor(workspace).workerLifecycle(worker, running), ledgerDir: path.join(root, 'ledger'), setTimer: () => () => {}, spawner: () => {
        child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => true; return child;
    } });
    const run = runtime.start({ workspacePath: root, profile: 'verify', dispatchTurnId: 'turn', baseRevision: 'abc123', objective: 'Verify presence', allowedFiles: ['fixture.js'], acceptance: 'presence lifecycle', expected: 'PASS', command: 'node fixture.js' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.snapshot().members.some(item => item.id === run.workerId && item.presence === 'joined'), false, 'a started worker is not a participant');
    const question = api.roomFor(root).workerPost(run.workerId, 'Which fixture?').message;
    const worker = () => store.snapshot().members.find(item => item.id === run.workerId);
    assert.equal(worker().presence, 'joined'); assert.match(worker().displayName, /verify · /);
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false, 'provider CRLF preserved');
    const polling = provider.slice(provider.indexOf("            case 'requestAITalk':"), provider.indexOf("            case 'requestAITalk':") + 4000);
    const pollingBlock = polling.slice(0, polling.indexOf('\n            case ', polling.indexOf("case 'aitalkReact':")));
    const poll = require('typescript').transpileModule(`async function poll(message) { switch(message.type) { ${pollingBlock} } }`, { compilerOptions: { target: 9 } }).outputText;
    let delivered;
    const pollingContext = { roomFor: api.roomFor, vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: () => '' }) }, extensions: { getExtension: () => undefined } }, os, path, fs };
    const invokePoll = vm.runInNewContext(poll + ';poll', pollingContext);
    await invokePoll.call({ _broadcast: message => { delivered = message.data; } }, { type: 'requestAITalk' });
    assert.equal(delivered.members.find(item => item.id === run.workerId).presence, 'joined', 'polling keeps the registered worker');
    child.stdout.write(JSON.stringify({ type: 'text', sessionID: 'fixture', part: { text: 'Result: PASS' } }) + '\n');
    await new Promise(resolve => setImmediate(resolve)); child.emit('exit', 0, null);
    assert.equal(worker().presence, 'joined', 'an unanswered worker question keeps it in the room');
    await invokePoll.call({ _broadcast: message => { delivered = message.data; } }, { type: 'aitalkReply', text: 'Use fixture.js', replyTo: question.id });
    assert.equal(worker().presence, 'left', 'the worker leaves once all its messages are answered');
    const notices = store.snapshot().messages.filter(item => item.kind === 'system').map(item => item.text);
    assert.ok(notices.includes('Agent joined') && notices.includes('Agent left'));
    assert.ok(notices.some(text => /^verify · .* joined$/.test(text)) && notices.some(text => /^verify · .* left$/.test(text)));
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
    assert.equal(member('validator').presence, 'joined', 'Validator registers at activation');
    const asked = api.roomFor(root).userPost('@Validator choose a colour').message;
    assert.equal(store.snapshot().messages.find(item => item.id === asked.id).tick, 'sent');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); assert.equal(store.snapshot().messages.find(item => item.id === asked.id).tick, 'delivered');
    assert.match(api.roomFor(root).typingText(), /Validator is typing/);
    release(); await routing.flush();
    const snapshot = store.snapshot();
    assert.equal(snapshot.messages.find(item => item.id === asked.id).tick, 'read');
    assert.ok(snapshot.messages.some(item => item.author === member('validator').id && item.replyTo === asked.id && item.text === 'Use green'));
    assert.equal(api.roomFor(root).typingText(), '');
    routing.dispose(); assert.equal(member('validator').presence, 'left');
    console.log('PASS EV-AITALK-PRESENCE activation clears stale actors; Agent registers at turn start/leaves at end; worker joins on post, leaves when answered; Validator @ reply with sent → delivered → read and typing');
})().catch(error => { console.error(error); process.exitCode = 1; });
