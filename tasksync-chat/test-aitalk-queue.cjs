// Messages the user posts for a running agent are queued; the agent's next tool call pops all of them together with the
// tool result, clearly marked as additional user messages (spec 003 A3; R-AITALK-13/14/34).
// Ticks: sent = queued, delivered = popped by a tool call, read = the agent responded (posted to AITalk) or its turn/run ended.
// Run: node test-aitalk-queue.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors'; export * from './src/aitalk/validatorDelivery'; export * from './src/workers/workerTools'; export * from './src/commentary/commentary';", resolveDir: __dirname, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { AITalkStore, configureAITalkDelivery, appendAITalkDelivery, withAITalkMcpDelivery, setToolResultDelivery, invokeDefinition, commentaryToolDefinitions,
        roomFor, registerAITalkValidator, AITALK_QUEUE_LABEL } = mod.exports;
    const root = path.join(__dirname, '.test-fixtures', `aitalk-queue-${process.pid}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    const store = new AITalkStore(root), room = roomFor(root);
    configureAITalkDelivery(root); setToolResultDelivery(appendAITalkDelivery);
    const [commentary] = commentaryToolDefinitions(() => { throw Error('not commentary'); }, root);
    const { z } = require('zod'); const tool = { name: 'any-tool', inputSchema: z.object({}), run: () => ({ status: 'ok' }) };
    const members = () => store.snapshot(true).members;
    const nameOf = id => { const member = members().find(item => item.id === id); return member.name || member.displayName || member.id; };
    const find = text => store.snapshot(true).messages.find(message => message.text === text);
    const state = text => find(text).delivery;
    const user = members().find(member => member.kind === 'user');
    const popped = result => { const [head, tail] = result.split(`\n\n${AITALK_QUEUE_LABEL}\n`); return { head, items: tail ? JSON.parse(tail) : [] }; };
    let seen = [];
    const validatorHandle = registerAITalkValidator(root, async (text, id) => { seen.push(text); room.handle('validator').reply(id, `Noted: ${text}`); });
    const agentActor = room.registerAgent(); const agent = members().find(member => member.kind === 'agent');

    // The label says plainly these are not part of the tool result.
    assert.match(AITALK_QUEUE_LABEL, /ADDITIONAL MESSAGES FROM THE USER/);
    assert.match(AITALK_QUEUE_LABEL, /NOT part of the tool result/);
    assert.match(AITALK_QUEUE_LABEL, /replyTo/);

    // 1. Main agent: a direction change, an answer to its question and a question are queued together, popped once, in rank order.
    await invokeDefinition(commentary, { action: 'aitalk', kind: 'heads-up', text: 'Which colour?', waitSeconds: 0 });
    const question = find('Which colour?');
    room.workerPost('worker-q', `@${agent.id} FYI tests are flaky`);
    room.handle('validator').post(`@${agent.id} Priya note`);
    room.userPost(`@${agent.id} switch to dark mode`);
    room.userPost('blue', question.id);
    room.userPost(`@${agent.id} why so slow?`);
    const userTexts = [`@${agent.id} switch to dark mode`, 'blue', `@${agent.id} why so slow?`];
    for (const text of userTexts) assert.deepEqual([find(text).delivery, find(text).tick], ['posted', 'sent'], 'queued = single tick');
    assert.equal(find(`@${agent.id} Priya note`)?.tick, undefined, 'ticks never appear on Validator messages');
    assert.equal(find(`@${agent.id} FYI tests are flaky`).tick, undefined, 'ticks never appear on worker messages');
    const first = popped(await invokeDefinition(tool, {}));
    assert.match(first.head, /ok/);
    assert.deepEqual(first.items.map(item => item.text), [...userTexts, `@${agent.id} Priya note`, `@${agent.id} FYI tests are flaky`], 'rank order: user, Validator, worker');
    assert.deepEqual(first.items.map(item => item.from), [user.id, user.id, user.id, 'validator', 'worker-q'].map(nameOf));
    assert.deepEqual(first.items[1], { id: find('blue').id, from: nameOf(user.id), text: 'blue', replyTo: question.id, inReplyTo: { id: question.id, from: nameOf(agent.id), text: 'Which colour?' } }, 'an answer carries the question it answers');
    assert.equal('inReplyTo' in first.items[0], false);
    for (const text of userTexts) assert.deepEqual([find(text).delivery, find(text).tick], ['delivered', 'delivered'], 'popped = double tick');
    assert.equal(state(`@${agent.id} Priya note`), 'delivered');

    // 2. Exactly once: later tool calls return nothing and are not a response, so nothing turns blue.
    assert.doesNotMatch(await invokeDefinition(tool, {}), /ADDITIONAL MESSAGES/, 'second call returns only the tool result');
    assert.deepEqual(popped(await invokeDefinition(tool, {})).items, []);
    for (const text of userTexts) assert.equal(find(text).tick, 'delivered');
    // 3. Read only when the agent responds in AITalk.
    await invokeDefinition(commentary, { action: 'aitalk', text: 'Switching to dark mode now.' });
    for (const text of userTexts) assert.equal(find(text).tick, 'read', 'agent posted → blue');
    // A long question is shortened to 500 characters in the delivered original.
    const longQuestion = room.handle('agent').post('Q'.repeat(800)).message;
    room.userPost('short answer', longQuestion.id);
    assert.equal(popped(await invokeDefinition(tool, {})).items[0].inReplyTo.text.length, 500);

    // 4. Turn end marks delivered messages read without any post.
    room.userPost(`@${agent.id} one more thing`);
    assert.equal(find(`@${agent.id} one more thing`).tick, 'sent');
    assert.equal(popped(await invokeDefinition(tool, {})).items.length, 1);
    assert.equal(find(`@${agent.id} one more thing`).tick, 'delivered');
    room.unregisterAgent();
    assert.equal(find(`@${agent.id} one more thing`).tick, 'read', 'turn ended → blue');
    // An agent that is not in the room receives nothing until it calls a tool again.
    room.userPost(`@${agent.id} while you were away`);
    assert.equal(find(`@${agent.id} while you were away`).tick, 'sent');
    assert.equal(appendAITalkDelivery('plain', { recipient: 'ghost', workspace: root }), 'plain', 'nobody to deliver to');
    assert.equal(find(`@${agent.id} while you were away`).tick, 'sent');
    assert.equal(popped(await invokeDefinition(tool, {})).items[0].text, `@${agent.id} while you were away`);
    room.registerAgent();

    // 5. Worker (MCP caller): same queue, ticks and original question.
    const workerId = 'worker-q';
    const workerQuestion = room.workerPost(workerId, 'Which branch should I use?').message;
    room.userPost(`@${workerId} rebase first`);
    room.userPost('main', workerQuestion.id);
    assert.equal(find('main').tick, 'sent');
    const mcp = withAITalkMcpDelivery(async () => ({ content: [{ type: 'text', text: 'worker result' }] }), root);
    const extra = { _meta: { workerId, workspacePath: root } };
    const call = await mcp({}, extra);
    assert.equal(call.content[0].text, 'worker result');
    const worker = popped(call.content[1].text);
    assert.deepEqual(worker.items.map(item => item.text), [`@${workerId} rebase first`, 'main']);
    assert.deepEqual(worker.items[1].inReplyTo, { id: workerQuestion.id, from: nameOf(workerId), text: 'Which branch should I use?' });
    assert.equal(find('main').tick, 'delivered');
    assert.equal((await mcp({}, extra)).content.length, 1, 'worker second call returns nothing');
    assert.equal(find('main').tick, 'delivered', 'a later tool call is not a response');
    room.workerPost(workerId, 'Rebasing on main.', { replyTo: find('main').id });
    assert.equal(find('main').tick, 'read', 'worker posted → blue');
    // Run end marks the worker's delivered messages read.
    room.userPost(`@${workerId} and run the tests`);
    assert.equal((await mcp({}, extra)).content.length, 2);
    assert.equal(find(`@${workerId} and run the tests`).tick, 'delivered');
    room.workerLifecycle({ id: workerId, displayName: 'Worker Q' }, false);
    assert.equal(find(`@${workerId} and run the tests`).tick, 'read', 'run ended → blue');

    // 6. Validator is always live: it receives the message and its answer lands in the room with no tool call.
    seen = [];
    room.userPost('Is the cache layer stale?');
    await validatorHandle.flush();
    assert.deepEqual(seen, ['Is the cache layer stale?']);
    const asked = find('Is the cache layer stale?');
    const answer = store.snapshot(true).messages.find(message => message.text === 'Noted: Is the cache layer stale?');
    assert.ok(answer, 'the answer is posted straight into the chat');
    assert.equal(answer.replyTo, asked.id); assert.equal(members().find(member => member.id === answer.author).kind, 'validator');
    assert.equal(asked.tick, 'read', 'Validator drives sent → delivered → read itself');
    assert.deepEqual(store.takeForTool(answer.author), [], 'nothing waits in the Validator queue');
    assert.deepEqual(popped(await invokeDefinition(tool, {})).items, [], 'the agent is not handed the Validator exchange');
    validatorHandle.dispose();
    void agentActor;
    console.log('PASS EV-AITALK-QUEUE queued sent → popped together once as additional user messages (delivered) → read on response or turn/run end; main agent, worker, Validator; inReplyTo');
})().catch(error => { console.error(error); process.exitCode = 1; });
