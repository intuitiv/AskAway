// EV-AITALK-MEMBER-PRESENCE (R-AITALK-51): the reviewer and Priya are always in the room, the main agent joins for its turn, and every other
// member joins only to ask (a question or a Webex permission card), stays while any of its questions/cards is open, and leaves when all
// are answered, approved, rejected or discarded. Real Room, delivery tools and webexDraftCards; fake Webex HTTP, no network, no models.
// Run: node test-aitalk-member-presence.cjs
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/actors'; export * from './src/aitalk/webexDraftCards'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/commentary/commentary'; export { registerToolDefinitions } from './src/workers/workerTools'; export * from './src/services/webexSuite'; export * from './src/services/webexDrafts';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
// Each load is a separate extension host process: its own draft queue and rooms (actors), the same workspace files.
const load = () => { const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports); return mod.exports; };
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5)); };

(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-member-presence-')));
    const host = api => api.webexSuiteTools({ cacheDir: path.join(root, 'cache'), modalFallback: undefined, request: async (method, endpoint) => {
        const reply = data => ({ ok: true, status: 200, json: async () => data });
        if (method === 'POST') return reply({ id: 'msg-1' });
        const url = new URL(endpoint, 'https://x.test');
        if (url.pathname === '/rooms') return reply({ items: [{ id: 'room-1', title: 'Build Team', type: 'group', lastActivity: '2026-10-22T09:00:00.000Z' }] });
        if (url.pathname === '/people/me') return reply({ id: 'me', displayName: 'Reviewer' });
        return reply({ items: [] });
    } });

    const api = load();
    const room = api.roomFor(root);
    room.activate();
    api.connectWebexDrafts(room, () => 'cathy');
    api.registerAITalkValidator(root, async () => {});
    api.configureAITalkDelivery(root);
    const tools = host(api);
    const send = text => tools.find(tool => tool.name === 'webex_send').run({ to: 'Build Team', text });
    const members = (store = room.store) => store.snapshot().members;
    const present = (id, store) => members(store).find(member => member.id === id)?.presence === 'joined';
    const rows = (name, event) => room.store.snapshot().messages.filter(message => message.kind === 'system' && message.text.toLowerCase().startsWith(name.toLowerCase()) && message.text.endsWith(` ${event}`)).length;
    const card = draftId => room.store.snapshot(true).messages.find(message => message.draftId === draftId);
    const cardById = id => room.store.snapshot(true).messages.find(message => message.id === id);
    const [commentary] = api.commentaryToolDefinitions(() => { throw Error('not commentary'); }, root);
    let call; api.registerToolDefinitions((name, config, handler) => { call = handler; }, [commentary]);
    const ask = async (who, text) => { const result = JSON.parse((await call({ action: 'aitalk', kind: 'heads-up', waitSeconds: 0, text }, { _meta: { recipient: who, workspacePath: root } })).content[0].text.split('\n\n')[0]); assert.notEqual(result.status, 'REJECTED'); return room.store.snapshot(true).messages.find(message => message.text === text); };

    // Before anything: the reviewer and Priya are in, nobody else is.
    assert.ok(present('you') && present('validator'), 'the reviewer and Priya are always present');
    assert.deepEqual(members().filter(member => member.presence === 'joined').map(member => member.id).sort(), ['validator', 'you']);

    // The main agent joins for its turn and is untouched by anyone else's presence.
    room.registerAgent();
    assert.ok(present('agent'));

    // A worker that only reads and reports never appears.
    room.workerLifecycle({ id: 'diego-run', displayName: 'Diego' }, true);
    room.workerLifecycle({ id: 'diego-run', displayName: 'Diego' }, false);
    assert.ok(!present('diego-run') && !room.store.snapshot().messages.some(message => /Diego/.test(message.text)), 'a member that never asks never joins');

    // 1. A permission card: Cathy joins; the reviewer's 👍 sends it; Cathy leaves.
    const first = await send('Deploy at 3pm.');
    assert.equal(first.status, 'pending');
    assert.ok(present('cathy'), 'Cathy joins when she posts a permission card');
    const firstId = card(first.draftId).id;
    room.react('you', firstId, '👍'); await flush();
    assert.equal(cardById(firstId).webexDraft.state, 'sent');
    assert.ok(!present('cathy'), 'Cathy leaves once the card is approved and sent');
    assert.equal(rows('Cathy', 'joined'), 1); assert.equal(rows('Cathy', 'left'), 1);

    // 2. 👎 discards: Cathy joins and leaves again.
    const second = await send('Can you review?');
    assert.ok(present('cathy'));
    const secondId = card(second.draftId).id;
    room.react('you', secondId, '👎'); await flush();
    assert.equal(cardById(secondId).webexDraft.state, 'rejected');
    assert.ok(!present('cathy'), 'Cathy leaves once the card is rejected');

    // 3. A pending card holds her even if someone else reacts to it: only the draft being settled answers it.
    const third = await send('Wait for the reviewer');
    const thirdId = card(third.draftId).id;
    room.react('agent', thirdId, '👍'); await flush();
    assert.ok(present('cathy'), 'a reaction from another member does not settle an approval card');
    // An edited card is still open; approving the edited text settles it.
    const edited = await tools.find(tool => tool.name === 'webex_edit_draft').run({ draftId: third.draftId, text: 'Wait, edited.' });
    assert.equal(edited.status, 'pending'); assert.ok(present('cathy'), 'an edited card is still open');
    await api.approveDraft(edited.draftId); await flush();
    assert.equal(cardById(thirdId).webexDraft.state, 'sent'); assert.ok(!present('cathy'), 'Cathy leaves once the edited card is sent');

    // 4. Two open questions: Anika leaves only after both are answered (a reply, then a reaction).
    const q1 = await ask('anika', 'Which branch should I use?');
    const q2 = await ask('anika', 'Which fixture should I use?');
    assert.ok(present('anika'), 'a worker joins when it asks a question');
    room.userPost('Use main.', q1.id);
    assert.ok(present('anika'), 'one answered question is not enough while the other is open');
    room.react('you', q2.id, '👍');
    assert.ok(!present('anika'), 'Anika leaves when all her questions are answered');
    assert.equal(rows('Anika', 'joined'), 1); assert.equal(rows('Anika', 'left'), 1);

    // 5. A question and a card together: both must be settled.
    const q3 = await ask('cathy', 'May I message the Build Team?');
    const fourth = await send('Hello team');
    const fourthId = card(fourth.draftId).id;
    room.react('you', fourthId, '👍'); await flush();
    assert.ok(present('cathy'), 'the settled card does not release her while her question is open');
    room.userPost('Yes.', q3.id);
    assert.ok(!present('cathy'), 'she leaves when the question is answered too');

    // 6. The card is settled in another window's process (which never saw Cathy join): she still leaves.
    const fifth = await send('Settled elsewhere');
    const fifthId = card(fifth.draftId).id;
    assert.ok(present('cathy'));
    const other = load();
    const otherRoom = other.roomFor(root);
    other.connectWebexDrafts(otherRoom, () => undefined);
    host(other);
    otherRoom.react('you', fifthId, '👍'); await flush();
    assert.equal(cardById(fifthId).webexDraft.state, 'sent');
    assert.ok(!present('cathy'), 'the member leaves whichever process settles the last card');

    // 7. A card removed from the log (conversation cleared) leaves nobody behind.
    const sixth = await send('Will be cleared');
    assert.ok(present('cathy') && sixth.draftId);
    room.store.clear();
    const realNow = Date.now; Date.now = () => realNow() + 60000;
    try { room.releaseAnswered(); } finally { Date.now = realNow; }
    assert.ok(!present('cathy'), 'with no open question or card the member leaves');

    // Through all of it the reviewer, Priya and the main agent stayed.
    assert.ok(present('you') && present('validator') && present('agent'));
    console.log('PASS EV-AITALK-MEMBER-PRESENCE: a member that asks a question (or a Webex permission card) joins, stays while any of its questions/cards is open, and leaves when all are answered, approved, rejected or discarded');
    fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error('FAIL EV-AITALK-MEMBER-PRESENCE:', error); process.exitCode = 1; });
