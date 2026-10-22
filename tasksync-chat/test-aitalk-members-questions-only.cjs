// EV-AITALK-MEMBERS-QUESTIONS-ONLY (R-AITALK-45): workers post only questions on AITalk; the main agent still posts updates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors'; export * from './src/workers/workerTools'; export * from './src/commentary/commentary';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { AITalkStore, configureAITalkDelivery, commentaryToolDefinitions, registerToolDefinitions, roomFor } = mod.exports;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-questions-only-'));
    const store = new AITalkStore(root);
    roomFor(root).registerAgent();
    configureAITalkDelivery(root);
    roomFor(root).workerLifecycle({ id: 'q-worker', displayName: 'Quinn' }, true);
    const [commentary] = commentaryToolDefinitions(() => { throw Error('not commentary'); }, root);
    let call; registerToolDefinitions((name, config, handler) => { call = handler; }, [commentary]);
    const asWorker = async (args) => JSON.parse((await call(args, { _meta: { recipient: 'q-worker', workspacePath: root } })).content[0].text);
    const texts = () => store.snapshot().messages.map(m => m.text);

    const refused = await asWorker({ action: 'aitalk', kind: 'update', text: 'Halfway through the edit' });
    assert.equal(refused.status, 'REJECTED'); assert.match(refused.reason, /only questions/); assert.match(refused.reason, /heads-up/);
    assert.ok(!texts().includes('Halfway through the edit'), 'a worker update is not posted');
    console.log('PASS worker update refused with a clear message');

    const question = await asWorker({ action: 'aitalk', kind: 'heads-up', waitSeconds: 0, text: 'May I send this Webex message to Vinayak?' });
    assert.notEqual(question.status, 'REJECTED');
    assert.ok(texts().includes('May I send this Webex message to Vinayak?'), 'a worker question is posted');
    console.log('PASS worker question posted');

    const bare = await asWorker({ action: 'aitalk', text: 'Bare status with no kind and no reply' });
    assert.equal(bare.status, 'REJECTED');
    assert.ok(!texts().includes('Bare status with no kind and no reply'), 'a kind-less worker post is not posted');
    const reply = await asWorker({ action: 'aitalk', text: 'Answering your question', replyTo: store.snapshot().messages.find(m => m.text.startsWith('May I send')).id });
    assert.notEqual(reply.status, 'REJECTED');
    assert.ok(texts().includes('Answering your question'), 'a direct reply is posted');
    console.log('PASS kind-less post refused, direct reply allowed');

    const main = await commentary.run({ action: 'aitalk', kind: 'update', text: 'Main agent is editing the config now', workspacePath: root });
    assert.notEqual(main?.status, 'REJECTED');
    assert.ok(texts().includes('Main agent is editing the config now'), 'the main agent update is posted');
    console.log('PASS main agent update posted');
    console.log('PASS EV-AITALK-MEMBERS-QUESTIONS-ONLY');
})().catch(e => { console.error(e); process.exit(1); });
