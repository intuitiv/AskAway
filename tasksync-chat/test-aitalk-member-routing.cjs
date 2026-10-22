// EV-AITALK-MEMBER-ROUTING: an @member mention reaches the running task(s) of that Team member by stable id (R-TEAM-09, R-TEAM-15).
// Caller view: the reviewer posts in the room, the worker's next MCP tool call pops the message (double tick); nothing is delivered
// to a stale worker or guessed between two members that share a name. Fakes only, no model calls. Run: node test-aitalk-member-routing.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors';", resolveDir: __dirname, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { AITalkStore, configureAITalkDelivery, withAITalkMcpDelivery, roomFor, AITALK_QUEUE_LABEL } = mod.exports;
    const root = path.join(__dirname, '.test-fixtures', `aitalk-member-routing-${process.pid}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    configureAITalkDelivery(root);
    const room = roomFor(root), store = new AITalkStore(root);
    // The Team roster as the reviewer left it: Tara and Anika renamed in Team Edit, two members that share the name Sam, Pavel idle.
    const worker = (id, name, role, profile, extra = {}) => ({ id, name, role, kind: 'worker', profiles: [profile], ...extra });
    room.setRoster(() => [
        worker('diego', 'Diego', 'Developer', 'build-lite', { profiles: ['build-lite', 'code'] }),
        worker('tara', 'Tara Singh', 'Test Engineer', 'verify', { baseName: 'Tara' }),
        worker('anika', 'Asha', 'Architect', 'build', { baseName: 'Anika' }),
        worker('sam-a', 'Sam', 'Developer', 'sam-a'),
        worker('sam-b', 'Sam', 'Reviewer', 'sam-b'),
        worker('pavel', 'Pavel', 'Performance Analyst', 'perf'),
        { id: 'priya', name: 'Priya', role: 'Product Owner', kind: 'validator', profiles: ['validator'] },
    ]);
    const start = (id, profile) => room.workerLifecycle({ id, displayName: profile }, true);
    const find = text => store.snapshot(true).messages.find(message => message.text === text);
    const notices = () => store.snapshot(true).messages.filter(message => message.kind === 'system' && message.author === 'system');
    const popped = result => { const [, tail] = result.split(`\n\n${AITALK_QUEUE_LABEL}\n`); return tail ? JSON.parse(tail) : []; };
    // A worker's next tool call, delivered through the real MCP wrapper.
    const nextCall = async id => {
        const mcp = withAITalkMcpDelivery(async () => ({ content: [{ type: 'text', text: 'tool result' }] }), root);
        const result = await mcp({}, { _meta: { workerId: id, workspacePath: root } });
        return result.content[1] ? popped(result.content[1].text) : [];
    };
    const texts = items => items.map(item => item.text);
    start('w-diego-1', 'build-lite'); start('w-tara-1', 'verify'); start('w-asha-1', 'build');

    // 1. @Diego reaches Diego's running task once, double tick, and nobody else.
    room.userPost('@Diego please rebase');
    assert.deepEqual([find('@Diego please rebase').tick, find('@Diego please rebase').recipients], ['sent', ['w-diego-1']]);
    assert.deepEqual(await nextCall('w-tara-1'), [], 'another member gets nothing');
    assert.deepEqual(texts(await nextCall('w-diego-1')), ['@Diego please rebase']);
    assert.equal(find('@Diego please rebase').tick, 'delivered', 'popped = double tick');
    assert.deepEqual(await nextCall('w-diego-1'), [], 'exactly once');
    assert.deepEqual(notices(), [], 'a delivered mention needs no notice');
    console.log('PASS EV-AITALK-MEMBER-ROUTING @Diego reaches only Diego once');

    // 2. Short alias, lower case, id, renamed label and the label from before the rename all name the same member.
    for (const text of ['@diego quick one', '@Tara run the suite', '@Singh not an alias, @Tara-Singh neither, @tara again', '@Asha review the plan', '@Anika (old name) review the plan', '@anika by id']) room.userPost(text);
    assert.deepEqual(find('@diego quick one').recipients, ['w-diego-1']);
    assert.deepEqual(find('@Tara run the suite').recipients, ['w-tara-1'], 'first name of the renamed Tara Singh');
    assert.deepEqual(find('@Singh not an alias, @Tara-Singh neither, @tara again').recipients, ['w-tara-1'], 'only real aliases route');
    for (const text of ['@Asha review the plan', '@Anika (old name) review the plan', '@anika by id']) assert.deepEqual(find(text).recipients, ['w-asha-1'], text);
    assert.deepEqual(texts(await nextCall('w-asha-1')), ['@Asha review the plan', '@Anika (old name) review the plan', '@anika by id']);
    assert.deepEqual(texts(await nextCall('w-tara-1')), ['@Tara run the suite', '@Singh not an alias, @Tara-Singh neither, @tara again']);
    assert.deepEqual(texts(await nextCall('w-diego-1')), ['@diego quick one']);
    console.log('PASS EV-AITALK-MEMBER-ROUTING short alias, id, renamed label and old label route the same');

    // 3. Two members called Sam: nobody is guessed, the reviewer is told, the message stays in the room (unaddressed rule: Priya gets it).
    start('w-sama', 'sam-a'); start('w-samb', 'sam-b');
    const sam = room.userPost('@Sam are you there?').message;
    assert.ok(!find('@Sam are you there?').recipients.some(id => id.startsWith('w-sam')), 'no guess between the two Sams');
    assert.deepEqual([await nextCall('w-sama'), await nextCall('w-samb')], [[], []]);
    const refusal = notices().at(-1);
    assert.equal(refusal.replyTo, sam.id);
    assert.match(refusal.text, /@sam fits Sam \(Developer\) and Sam \(Reviewer\): the message was not delivered to either/);
    assert.equal(find('@Sam are you there?').delivery, 'posted', 'nothing lost: the message is stored');
    console.log('PASS EV-AITALK-MEMBER-ROUTING duplicate name refused with a notice naming both');

    // 4. A member with no running task (never started, or stopped) gets nothing; the reviewer is told; the message is kept.
    room.userPost('@Pavel profile the build');
    assert.match(notices().at(-1).text, /^Pavel has no running task right now, so this message did not reach Pavel\.$/);
    start('w-pavel-1', 'perf'); room.workerLifecycle({ id: 'w-pavel-1', displayName: 'perf' }, false);
    const stale = room.userPost('@Pavel and now?').message;
    assert.ok(!find('@Pavel and now?').recipients.includes('w-pavel-1'), 'a stopped worker is not a ghost target');
    assert.deepEqual(await nextCall('w-pavel-1'), []);
    assert.match(notices().at(-1).text, /Pavel has no running task/);
    assert.equal(notices().at(-1).replyTo, stale.id);
    assert.ok(find('@Pavel profile the build') && find('@Pavel and now?'), 'nothing lost');
    console.log('PASS EV-AITALK-MEMBER-ROUTING inactive member: notice, no stale delivery, message kept');

    // 5. Two running tasks of one member: a mention reaches every running task of that member (the existing rule: all matches).
    start('w-diego-2', 'code');
    room.userPost('@Diego both of you, status please');
    assert.deepEqual([...find('@Diego both of you, status please').recipients].sort(), ['w-diego-1', 'w-diego-2']);
    assert.deepEqual(texts(await nextCall('w-diego-1')), ['@Diego both of you, status please']);
    assert.deepEqual(texts(await nextCall('w-diego-2')), ['@Diego both of you, status please']);
    console.log('PASS EV-AITALK-MEMBER-ROUTING two tasks of one member both get the mention');

    // 6. A mention inside a reply keeps priority: the reply goes to the task that asked (task correlation), the mention adds other members only.
    const question = room.workerPost('w-diego-1', 'Which branch should I use?').message;
    const answer = room.userPost('@Diego use main, @Tara fyi', question.id).message;
    assert.deepEqual([...find(answer.text).recipients].sort(), ['w-diego-1', 'w-tara-1'], 'the asking Diego task and Tara, not Diego\'s second task');
    const items = await nextCall('w-diego-1');
    assert.deepEqual(texts(items), ['@Diego use main, @Tara fyi']);
    assert.deepEqual(items[0].inReplyTo, { id: question.id, from: items[0].inReplyTo.from, text: 'Which branch should I use?' });
    assert.deepEqual(await nextCall('w-diego-2'), [], 'the other Diego task is not interrupted by a reply to its sibling');
    assert.deepEqual(texts(await nextCall('w-tara-1')), ['@Diego use main, @Tara fyi']);
    console.log('PASS EV-AITALK-MEMBER-ROUTING a mention inside a reply keeps reply priority and task correlation');
    console.log('PASS EV-AITALK-MEMBER-ROUTING: @Name, short alias, renamed label, duplicate name and inactive member are routed or refused as specified');
})().catch(error => { console.error(error); process.exitCode = 1; });
