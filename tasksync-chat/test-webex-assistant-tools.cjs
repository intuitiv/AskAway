// EV-WEBEX-ASSISTANT-TOOLS (T046, R-CATHY-01/05/07): Cathy's Webex tools are exactly twelve strict tools registered through the assistant
// provider seam; the nine old tools and the LM askaway_webex are gone; every outbound tool returns a pending draft and nothing is posted
// before the reviewer's 👍 in AITalk; without AITalk nothing is sent unless the host supplied a modal fallback. Fake Webex API, no network.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/actors'; export * from './src/aitalk/webexDraftCards'; export * from './src/aitalk/delivery'; export * from './src/services/webexDrafts'; export * from './src/services/assistant/provider'; export * from './src/services/webexSuite';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const load = () => { const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports); return mod.exports; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const enc = (kind, n) => Buffer.from(`ciscospark://us/${kind}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`).toString('base64url');
const ROOM = n => enc('ROOM', n), PEOPLE = n => enc('PEOPLE', n), MESSAGE = n => enc('MESSAGE', n);
const T = hhmm => `2026-10-22T${hhmm}:00.000Z`;

const makeFake = () => {
    const calls = [];
    const people = [{ id: PEOPLE(1), displayName: 'Reviewer Me', emails: ['me@example.test'] }, { id: PEOPLE(2), displayName: 'Alice Jones', emails: ['alice@example.test'] }];
    const rooms = [{ id: ROOM(1), title: 'Release plan', type: 'group', lastActivity: T('09:40') }, { id: ROOM(2), title: 'Build Team', type: 'group', lastActivity: T('08:00') }];
    const messages = [
        { id: MESSAGE(1), roomId: ROOM(1), personId: PEOPLE(2), personEmail: 'alice@example.test', text: 'Can you deploy today?', created: T('09:00') },
        { id: MESSAGE(2), roomId: ROOM(1), personId: PEOPLE(1), personEmail: 'me@example.test', text: 'On it', created: T('09:10'), parentId: MESSAGE(1) },
    ];
    const reply = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, headers: { get: () => null } });
    const request = async (method, endpoint, body) => {
        calls.push({ method, endpoint, body });
        const url = new URL(endpoint, 'https://x.test'), q = url.searchParams, p = url.pathname;
        if (method === 'POST' && p === '/messages') { return reply({ id: MESSAGE(90 + calls.length) }); }
        if (method === 'PUT' || method === 'DELETE') { return reply({ id: MESSAGE(2) }); }
        if (p === '/rooms') { return reply({ items: rooms }); }
        if (p === '/people/me') { return reply(people[0]); }
        if (p === '/people') { return reply({ items: q.get('id') ? people.filter(x => q.get('id').split(',').includes(x.id)) : people.filter(x => x.displayName.toLowerCase().startsWith((q.get('displayName') ?? '').toLowerCase())) }); }
        if (p === '/messages') { return reply({ items: messages.filter(x => x.roomId === q.get('roomId')) }); }
        return reply({}, 404);
    };
    return { calls, request, writes: () => calls.filter(call => call.method !== 'GET') };
};

(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'webex-assistant-tools-')));
    let api = load();
    const fake = makeFake();
    const deps = (extra = {}) => ({ request: fake.request, download: async () => ({ name: 'a.txt', bytes: Buffer.from('x') }), cacheDir: path.join(root, 'cache'), stateFile: path.join(root, '.askaway/webex-seen.json'), ...extra });

    // 1. The set: exactly twelve, the contract's names, none of the nine old tools.
    const tools = api.webexSuiteTools(deps());
    const names = tools.map(tool => tool.name);
    const twelve = ['webex_inbox', 'webex_find', 'webex_read', 'webex_search', 'webex_wait', 'webex_meetings', 'webex_send', 'webex_reply', 'webex_edit_message', 'webex_delete_message', 'webex_edit_draft', 'webex_style_card'];
    assert.deepEqual([...names].sort(), [...twelve].sort()); assert.ok(names.length <= 12);
    for (const old of ['webex_find_space', 'webex_thread', 'webex_attachments', 'webex_wait_reply']) { assert.ok(!names.includes(old), `${old} is gone`); }
    assert.ok(!names.includes('askaway_webex'));
    const workerTools = fs.readFileSync(path.join(__dirname, 'src/workers/workerTools.ts'), 'utf8');
    assert.doesNotMatch(workerTools, /askaway_webex|function webexTool/);
    const suiteSource = fs.readFileSync(path.join(__dirname, 'src/services/webexSuite.ts'), 'utf8');
    assert.doesNotMatch(suiteSource, /deps\.approve|hasWebexDraftHook/, 'no send fallback beside the card');
    for (const file of ['src/services/webexSuite.ts', 'src/services/webexToolsHost.ts', 'src/workers/workerTools.ts', 'src/extension.ts', 'src/mcp/mcpServer.ts']) { assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /from '\.\/webexTools'|services\/webexTools'|runWebexTool/, `${file} no longer uses webexTools`); }
    console.log('PASS the tool set is exactly the twelve contract tools; the nine old tools and the LM askaway_webex are gone');

    // 2. Registered through the provider seam: one provider, twelve tools, duplicates refused, unregister removes them.
    const unregister = api.registerAssistantProvider(api.createWebexProvider(deps()));
    assert.deepEqual(api.assistantTools().map(tool => tool.name).sort(), [...twelve].sort());
    assert.throws(() => api.registerAssistantProvider(api.createWebexProvider(deps())), /already registered/);
    unregister(); assert.deepEqual(api.assistantTools(), []);
    console.log('PASS the tools register through the assistant provider registry');

    // 3. Strict schemas: an extra key, or an id-style argument, is refused for every tool.
    const sample = { webex_inbox: {}, webex_find: { query: 'x' }, webex_read: { space: 'x' }, webex_search: { query: 'x' }, webex_wait: { space: 'x', timeoutSeconds: 1 }, webex_meetings: {},
        webex_send: { to: 'x', text: 'y' }, webex_reply: { to: 'm1', text: 'y' }, webex_edit_message: { ref: 'm1', text: 'y' }, webex_delete_message: { ref: 'm1' }, webex_edit_draft: { draftId: 'd', text: 'y' }, webex_style_card: {} };
    for (const tool of tools) {
        assert.equal(tool.inputSchema.safeParse(sample[tool.name]).success, true, `${tool.name} accepts its sample`);
        for (const extra of [{ extra: 1 }, { roomId: ROOM(1) }, { personEmail: 'a@example.test' }, { messageId: MESSAGE(1) }]) {
            assert.equal(tool.inputSchema.safeParse({ ...sample[tool.name], ...extra }).success, false, `${tool.name} rejects ${Object.keys(extra)[0]}`);
            assert.equal((await tool.run({ ...sample[tool.name], ...extra })).status, 'invalid');
        }
    }
    // A raw Webex id as a name or ref argument is refused with a plain message (R-CATHY-03); short refs and names still pass.
    const idArgs = { webex_find: ['query'], webex_read: ['space', 'person', 'thread'], webex_search: ['query', 'space', 'person'], webex_wait: ['space', 'person', 'thread', 'sinceRef'], webex_meetings: ['person'],
        webex_send: ['to', 'thread'], webex_reply: ['to'], webex_edit_message: ['ref'], webex_delete_message: ['ref'] };
    for (const tool of tools) {
        for (const field of idArgs[tool.name] ?? []) {
            for (const id of [ROOM(1), PEOPLE(2), MESSAGE(3), '123e4567-e89b-12d3-a456-426614174000']) {
                const args = { ...sample[tool.name], [field]: id };
                assert.equal(tool.inputSchema.safeParse(args).success, false, `${tool.name}.${field} refuses an id`);
                const result = await tool.run(args);
                assert.equal(result.status, 'invalid'); assert.match(result.message, /looks like an id\. Use the space or person name, or a short ref such as s3\./);
                assert.ok(!JSON.stringify(result).includes(id), 'the refusal never echoes the id');
            }
            assert.equal(tool.inputSchema.safeParse({ ...sample[tool.name], [field]: 's3' }).success, true, `${tool.name}.${field} accepts a short ref`);
            assert.equal(tool.inputSchema.safeParse({ ...sample[tool.name], [field]: 'Build Team' }).success, true, `${tool.name}.${field} accepts a name`);
        }
    }
    assert.deepEqual(fake.writes(), [], 'invalid calls post nothing');
    console.log('PASS every tool schema is strict and refuses id arguments');

    // 4. Outbound tools return pending drafts; nothing posts before 👍; each runs once after it.
    const room = api.roomFor(root); room.activate();
    api.connectWebexDrafts(room, () => 'cathy');
    const run = (name, args) => tools.find(tool => tool.name === name).run(args);
    const read = await run('webex_read', { space: 'Release plan' });
    const [root1, mine] = read.messages;
    assert.equal(mine.fromMe, true);
    const queued = {
        send: await run('webex_send', { to: 'Build Team', text: 'Standup moved to 10.' }),
        reply: await run('webex_reply', { to: 'latest from Alice in Release plan', text: 'Thank you!' }),
        edit: await run('webex_edit_message', { ref: mine.ref, text: 'On it, done by noon' }),
        del: await run('webex_delete_message', { ref: mine.ref }),
    };
    for (const [name, result] of Object.entries(queued)) { assert.equal(result.status, 'pending', name); assert.ok(result.draftId && result.target && result.text !== undefined, name); }
    assert.deepEqual(fake.writes(), [], 'nothing is posted while the cards wait');
    assert.equal((await run('webex_edit_message', { ref: root1.ref, text: 'Hijack' })).status, 'refused');
    assert.equal((await run('webex_delete_message', { ref: root1.ref })).status, 'refused');
    const cards = () => room.store.snapshot(true).messages.filter(message => message.webexDraft);
    assert.equal(cards().length, 4); assert.ok(cards().every(card => card.author === 'cathy' && card.webexDraft.provider === 'webex'));
    const edited = await run('webex_edit_draft', { draftId: queued.send.draftId, text: 'Standup moved to 11.' });
    assert.equal(edited.status, 'pending'); assert.notEqual(edited.draftId, queued.send.draftId);
    const user = room.store.snapshot().members.find(member => member.kind === 'user').id;
    const approve = async draftId => { const card = cards().find(item => item.draftId === draftId); room.react(user, card.id, '👍'); room.react(user, card.id, '👍'); await flush(); await flush(); };
    // A bare 👍 after an edit is refused (it cannot prove the edited text was read); the card's Send button carries the draftId.
    await approve(edited.draftId); assert.deepEqual(fake.writes(), [], 'a 👍 on an edited card sends nothing');
    assert.equal((await api.approveDraft(edited.draftId)).status, 'sent');
    await approve(queued.reply.draftId); await approve(queued.edit.draftId);
    assert.deepEqual(fake.writes().map(call => [call.method, call.body?.text]), [['POST', 'Standup moved to 11.'], ['POST', 'Thank you!'], ['PUT', 'On it, done by noon']]);
    assert.equal(fake.writes()[1].body.parentId, MESSAGE(1), 'the reply goes into the thread of the message it answers');
    assert.equal((await api.approveDraft(queued.send.draftId)).status, 'unavailable', 'the voided id sends nothing');
    console.log('PASS send, reply, edit message and delete message return pending drafts; 👍 runs each once; edit_draft voids the old approval');

    // 5. No card sink, no modal: unavailable and nothing posted. A modal runs only when the host supplied it.
    api = load();
    const before = fake.writes().length;
    const bare = api.webexSuiteTools(deps());
    const sent = await bare.find(tool => tool.name === 'webex_send').run({ to: 'Build Team', text: 'Hello' });
    assert.equal(sent.status, 'unavailable'); assert.equal(fake.writes().length, before);
    const asked = [];
    const withModal = api.webexSuiteTools(deps({ modalFallback: async req => { asked.push(req); return 'approved'; } }));
    const viaModal = await withModal.find(tool => tool.name === 'webex_send').run({ to: 'Build Team', text: 'Hello again' });
    assert.equal(viaModal.status, 'sent'); assert.equal(asked.length, 1); assert.equal(asked[0].targetLabel, 'Build Team');
    assert.equal(fake.writes().length, before + 1);
    console.log('PASS without AITalk nothing is sent; the modal fallback runs only when supplied');

    // 6. Style card unchanged.
    fs.mkdirSync(path.join(root, 'cache'), { recursive: true });
    assert.equal((await run('webex_style_card', {})).text, '');
    fs.writeFileSync(path.join(root, 'cache/style-card.md'), 'plain short replies');
    assert.equal((await run('webex_style_card', {})).text, 'plain short replies');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS EV-WEBEX-ASSISTANT-TOOLS');
})().catch(error => { console.error(error); process.exitCode = 1; });
