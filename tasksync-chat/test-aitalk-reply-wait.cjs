// An agent's AITalk question waits briefly for a reply, then carries on; a late reply arrives with the next tool call, once (spec 003 A3).
// Also: the four actor kinds are concrete implementations of the one Actor interface.
// Run: node test-aitalk-reply-wait.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors'; export * from './src/aitalk/validatorDelivery'; export * from './src/workers/workerTools'; export * from './src/commentary/commentary';", resolveDir: __dirname, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { AITalkStore, configureAITalkDelivery, appendAITalkDelivery, setToolResultDelivery, invokeDefinition, commentaryToolDefinitions, roomFor,
        MainAgentActor, WorkerActor, UserActor, ValidatorActor, registerAITalkValidator } = mod.exports;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-wait-'));
    const store = new AITalkStore(root);
    const room = roomFor(root);
    configureAITalkDelivery(root); setToolResultDelivery(appendAITalkDelivery);
    const [commentary] = commentaryToolDefinitions(() => { throw Error('not commentary'); }, root);
    const { z } = require('zod'); const tool = { name: 'any-tool', inputSchema: z.object({}), run: () => ({ status: 'ok' }) };
    const user = store.snapshot().members.find(member => member.kind === 'user');
    room.registerAgent();
    const agent = store.snapshot().members.find(member => member.kind === 'agent');

    // 1. The user replies while the agent waits: the answer is in the question's result and is not delivered twice.
    let asked = invokeDefinition(commentary, { action: 'aitalk', kind: 'heads-up', text: 'Should the export include archived rows?', waitSeconds: 5 });
    await new Promise(resolve => setTimeout(resolve, 50));
    const question = store.snapshot(true).messages.find(message => message.text.startsWith('Should the export'));
    assert.ok(question, 'the question is in the room at once');
    room.userPost('Yes, include them.', question.id);
    let result = JSON.parse(await asked);
    assert.equal(result.reply.text, 'Yes, include them.');
    assert.equal(result.reply.author, user.id);
    assert.equal(result.reply.from, store.nameOf(store.snapshot().members, user.id), 'the wait path names the sender like the queued path');
    assert.notEqual(result.reply.from, user.id);
    assert.equal(result.reply.inReplyTo.id, question.id);
    assert.equal(result.reply.inReplyTo.text, 'Should the export include archived rows?', 'the answer carries the question it answers');
    assert.doesNotMatch(await invokeDefinition(tool, {}), /Yes, include them/, 'a reply handed over in the wait is not delivered again');

    // 2. Nobody replies in time: the agent carries on and the reply comes with its next tool call, once.
    const started = Date.now();
    asked = invokeDefinition(commentary, { action: 'aitalk', kind: 'heads-up', text: 'Which database should the report use?', waitSeconds: 0.2 });
    result = JSON.parse(await asked);
    assert.equal(result.pending, true);
    assert.ok(Date.now() - started >= 190 && Date.now() - started < 3000, 'it waited the asked time, not longer');
    const second = store.snapshot(true).messages.find(message => message.text.startsWith('Which database'));
    room.userPost('Use the replica.', second.id);
    const next = await invokeDefinition(tool, {});
    assert.match(next, /Use the replica\./);
    assert.match(next, /"inReplyTo":\{"id":"[^"]+","from":"[^"]+","text":"Which database should the report use\?"\}/, 'the late answer carries the question too');
    assert.doesNotMatch(await invokeDefinition(tool, {}), /Use the replica\./, 'delivered once');

    // 3. A plain update never waits, and a reply is never waited on.
    const quick = Date.now();
    await invokeDefinition(commentary, { action: 'aitalk', kind: 'update', text: 'Build is running now' });
    assert.ok(Date.now() - quick < 1000);

    // 4. The Validator answers immediately, through the same callback path.
    let seen;
    const handle = registerAITalkValidator(root, async (text, id) => { seen = text; room.handle('validator').reply(id, 'Yes, offline.'); });
    asked = invokeDefinition(commentary, { action: 'aitalk', kind: 'heads-up', text: '@Validator should tests run offline?', waitSeconds: 5 });
    result = JSON.parse(await asked);
    assert.equal(result.reply.text, 'Yes, offline.');
    assert.match(seen, /should tests run offline/);
    await handle.flush();

    // 5. onReply: a callback runs for a reply by someone else and can be cancelled.
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-callback-'));
    const room2 = roomFor(root2); room2.registerAgent();
    const posted = room2.handle('agent').post('Ready?').message;
    const calls = []; const off = room2.onReply(posted.id, reply => calls.push(reply.text));
    room2.userPost('Ready.', posted.id); off(); room2.userPost('Again.', posted.id);
    assert.deepEqual(calls, ['Ready.']);
    assert.equal(await room2.awaitReply(posted.id, 10) !== undefined, true, 'an existing reply resolves at once');

    // 6. Each kind is a concrete Actor; the room keeps its instance and never writes private state into the registry.
    assert.ok(room.actors.get(user.id) instanceof UserActor);
    assert.ok(room.actors.get(agent.id) instanceof MainAgentActor);
    assert.ok(room.actors.get('validator') instanceof ValidatorActor);
    room.workerPost('worker-x', 'Need a hand?');
    assert.ok(room.actors.get('worker-x') instanceof WorkerActor);
    assert.equal(room.actors.get('worker-x').leaveWhenAnswered, true);
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.askaway', 'aitalk', 'presence.jsonl'), 'utf8'), /pending|answer|typing/);
    console.log('PASS test-aitalk-reply-wait (EV-AITALK-REPLY-WAIT)');
})().catch(error => { console.error(error); process.exitCode = 1; });
