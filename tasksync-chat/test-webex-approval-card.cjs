// Caller view of T045 (R-CATHY-05): every outbound action (send, reply, edit, delete, upload) is ONE generic approval card in AITalk
// (provider, action, target NAME, thread, full text, files); nothing is posted before the reviewer's 👍; 👍 runs it once, 👎 discards,
// an edit asks again, a reload keeps pending cards approvable; the modal exists only when the host supplies it; no card text carries an
// id even when the fake Webex API and resolver return ids; an Outlook-like provider uses the same card. Fakes only, no network.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/actors'; export * from './src/aitalk/webexDraftCards'; export * from './src/aitalk/delivery'; export * from './src/services/webexDrafts'; export * from './src/services/assistant/provider'; export * from './src/services/assistant/webexActions'; export * from './src/services/webexSuite';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
// Each load is a fresh extension host: new draft queue, new rooms, same workspace files.
const load = () => { const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports); return mod.exports; };
const flush = () => new Promise(resolve => setImmediate(resolve));

// Webex-shaped ids the fake API and resolver hand out; none may reach a card, a reply or a tool result.
const ROOM_ID = 'Y2lzY29zcGFyazovL3VzL1JPT00vNWE4YzFmMDAtMDAwMC0xMWVmLWI5ZTAtMDAwMDAwMDAwMDAx';
const PERSON_ID = 'Y2lzY29zcGFyazovL3VzL1BFT1BMRS85MTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTU';
const MSG_ROOT = 'Y2lzY29zcGFyazovL3VzL01FU1NBR0UvMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1';
const MSG_MINE = 'Y2lzY29zcGFyazovL3VzL01FU1NBR0UvYWFhYWFhYWEtYmJiYi1jY2NjLWRkZGQtZWVlZWVlZWVlZWVl';
const MSG_OTHER = 'Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOTk5OTk5OTktODg4OC03Nzc3LTY2NjYtNTU1NTU1NTU1NTU1';
const ok = (ref, label, id) => ({ status: 'ok', ref, label, _internal: { id } });
const fakeResolver = () => {
    const space = ok('s1', 'Build Team', ROOM_ID);
    const messages = {
        m1: { space, thread: ok('m1', 'Release plan', MSG_ROOT), message: ok('m1', 'Release plan', MSG_ROOT), mine: false },
        m2: { space, thread: ok('m1', 'Release plan', MSG_ROOT), message: ok('m2', 'Ship it', MSG_MINE), mine: true },
        m3: { space, message: ok('m3', 'Not mine', MSG_OTHER), mine: false },
    };
    return {
        async space(name) { return /^(build team|s1)$/i.test(name) ? space : /^team$/i.test(name) ? { status: 'ambiguous', candidates: [{ ref: 's1', label: 'Build Team', kind: 'space' }, { ref: 's2', label: 'Team Lunch', kind: 'space' }] } : { status: 'not_found', query: name }; },
        async person(name) { return /^ana/i.test(name) ? ok('p1', 'Ana Smith', PERSON_ID) : { status: 'not_found', query: name }; },
        async message(ref) { return messages[ref] ?? { status: 'stale_ref', hint: 'Call webex_inbox or webex_find again.' }; },
        async latestFrom(person, spaceName) { return /ana/i.test(person) && /build team/i.test(spaceName) ? ok('m1', 'Release plan', MSG_ROOT) : { status: 'not_found', query: `${person} in ${spaceName}` }; },
    };
};

(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'webex-approval-card-')));
    const calls = [], uploads = [];
    const request = async (method, endpoint, body) => { calls.push({ method, endpoint, body }); return { ok: true, json: async () => ({ id: `${MSG_ROOT}-${calls.length}` }) }; };
    const uploadFiles = async (target, files, text) => { uploads.push({ target, files, text }); return { id: 'uploaded' }; };
    const userOf = room => room.store.snapshot().members.find(member => member.kind === 'user').id;
    const render = await import('./media/aitalk/talkRender.js');
    const withIds = [ROOM_ID, PERSON_ID, MSG_ROOT, MSG_MINE, MSG_OTHER];
    const noIds = (label, value) => { const text = typeof value === 'string' ? value : JSON.stringify(value); for (const id of withIds) { assert.ok(!text.includes(id), `${label} must not carry a Webex id`); } };
    // The reviewer's side: the card in the room (text, stored fields minus internal ids, rendered HTML).
    const cards = room => room.store.snapshot(true).messages.filter(message => message.webexDraft);
    const cardFor = (room, draftId) => cards(room).find(message => message.draftId === draftId);
    const visible = card => { const { internal, ...shown } = card.webexDraft; return { text: card.text, shown, html: render.draftCardHtml(card) }; };
    const thumbs = (room, card, emoji = '👍') => room.react(userOf(room), card.id, emoji);

    let api = load();
    let room = api.roomFor(root);
    room.activate();
    api.connectWebexDrafts(room, () => 'cathy');
    let actions = api.createWebexActions({ resolver: fakeResolver(), request, uploadFiles });
    const settled = () => cards(room).filter(card => card.webexDraft.state !== 'pending');
    const unsent = () => { assert.deepEqual(calls, [], 'nothing posted to Webex'); assert.deepEqual(uploads, [], 'nothing uploaded'); };

    // 1. Every action queues a card and posts nothing. The card shows provider, action, target NAME, thread, files and the full text; no ids.
    const long = `Plan <b>v2</b>:\n${'step and check '.repeat(30)}\nend`;
    const queued = {
        send: await actions.send({ to: 'Build Team', text: long }),
        sendPerson: await actions.send({ to: 'Ana Smith', text: 'Can you review?' }),
        reply: await actions.reply({ to: 'latest from Ana in Build Team', text: 'Thank you!' }),
        edit: await actions.editMessage({ ref: 'm2', text: 'Ship it at 3pm' }),
        del: await actions.deleteMessage({ ref: 'm2' }),
        upload: await actions.upload({ to: 'Build Team', files: ['/tmp/notes/design-notes.pdf', '/tmp/notes/budget.xlsx'], text: 'Files for the review', thread: 'm1' }),
    };
    for (const [name, result] of Object.entries(queued)) { assert.equal(result.status, 'pending', `${name} is pending`); assert.ok(result.draftId); noIds(`${name} result`, { ...result, draftId: undefined }); }
    unsent();
    assert.equal(cards(room).length, 6);
    assert.equal(cardFor(room, queued.send.draftId).author, 'cathy', 'the worker posts its own card');
    for (const [name, result] of Object.entries(queued)) { const view = visible(cardFor(room, result.draftId)); noIds(`${name} card`, view); }
    const view = name => visible(cardFor(room, queued[name].draftId));
    assert.match(view('send').text, /^Draft · Webex send · Build Team\n\n/); assert.ok(view('send').text.endsWith(long), 'full text, never collapsed');
    assert.match(view('sendPerson').text, /Webex send · Ana Smith/);
    assert.match(view('reply').text, /Webex reply · Build Team\nThread: Release plan\n\nThank you!/);
    assert.match(view('edit').text, /Webex edit · Build Team/); assert.match(view('edit').text, /Ship it at 3pm$/);
    assert.match(view('del').text, /Webex delete · Build Team/);
    assert.match(view('upload').text, /Webex upload · Build Team\nThread: Release plan\nFiles: design-notes\.pdf, budget\.xlsx\n\nFiles for the review/);
    assert.match(view('send').html, /Build Team/); assert.match(view('send').html, /Approve and send/);
    console.log('PASS every action is a pending card with provider, action, name, thread, files and the full text; nothing posted');

    // 2. 👍 runs the action once (double click included); the card settles; the worker gets the outcome with the name, no id.
    const sendCard = cardFor(room, queued.send.draftId);
    thumbs(room, sendCard); thumbs(room, sendCard); await flush(); await flush();
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], { method: 'POST', endpoint: '/messages', body: { roomId: ROOM_ID, text: long } });
    assert.equal(room.store.snapshot(true).messages.find(m => m.id === sendCard.id).webexDraft.state, 'sent');
    let inbox = room.store.takeForTool('cathy');
    const sentNote = inbox.find(message => message.replyTo === sendCard.id && /Approved/.test(message.text));
    assert.match(sentNote.text, /Approved: sent to Build Team\./); noIds('outcome reply', sentNote.text);
    console.log('PASS 👍 posts exactly once and the worker gets the outcome by name');

    // 3. Each other action executes the right Webex call only after its own 👍.
    const approve = async name => { thumbs(room, cardFor(room, queued[name].draftId)); await flush(); await flush(); };
    await approve('sendPerson'); await approve('reply'); await approve('edit'); await approve('del'); await approve('upload');
    assert.deepEqual(calls.slice(1), [
        { method: 'POST', endpoint: '/messages', body: { toPersonId: PERSON_ID, text: 'Can you review?' } },
        { method: 'POST', endpoint: '/messages', body: { roomId: ROOM_ID, text: 'Thank you!', parentId: MSG_ROOT } },
        { method: 'PUT', endpoint: `/messages/${encodeURIComponent(MSG_MINE)}`, body: { roomId: ROOM_ID, text: 'Ship it at 3pm' } },
        { method: 'DELETE', endpoint: `/messages/${encodeURIComponent(MSG_MINE)}`, body: undefined },
    ]);
    assert.deepEqual(uploads, [{ target: { roomId: ROOM_ID, parentId: MSG_ROOT }, files: ['/tmp/notes/design-notes.pdf', '/tmp/notes/budget.xlsx'], text: 'Files for the review' }]);
    assert.equal(cards(room).filter(card => card.webexDraft.state === 'sent').length, 6);
    inbox = room.store.takeForTool('cathy');
    inbox = inbox.filter(message => /Approved/.test(message.text));
    assert.equal(inbox.length, 5); noIds('outcome replies', inbox.map(message => message.text));
    assert.ok(inbox.some(message => /edited your message in Build Team/.test(message.text)) && inbox.some(message => /deleted your message in Build Team/.test(message.text)));
    console.log('PASS send, person send, reply in thread, edit, delete and upload each execute once after their own 👍');

    // 4. 👎 discards (nothing posted; a later approval does nothing); another actor's 👍 is not permission.
    const before = calls.length;
    const no = await actions.send({ to: 'Build Team', text: 'Not this one' });
    const noCard = cardFor(room, no.draftId);
    room.registerAgent(); room.react('agent', noCard.id, '👍'); await flush();
    assert.equal(calls.length, before, 'only the reviewer is permission');
    thumbs(room, noCard, '👎'); await flush();
    assert.equal(calls.length, before); assert.equal(room.store.snapshot(true).messages.find(m => m.id === noCard.id).webexDraft.state, 'rejected');
    assert.equal((await api.approveDraft(no.draftId)).status, 'unavailable');
    assert.match(room.store.takeForTool('cathy').find(message => message.replyTo === noCard.id && /Rejected/.test(message.text)).text, /Rejected: nothing was done for Build Team\./);
    console.log('PASS 👎 discards; only the reviewer\'s 👍 is permission');

    // 5. Edit voids the old approval: the old id sends nothing, the new id runs the edited text once (the webex_edit_draft store path).
    const draft = await actions.send({ to: 'Build Team', text: 'First wording' });
    const first = cardFor(room, draft.draftId);
    const edited = api.editDraft(draft.draftId, 'Second wording');
    assert.equal(edited.status, 'pending'); assert.notEqual(edited.draftId, draft.draftId);
    assert.equal((await api.approveDraft(draft.draftId)).status, 'unavailable'); assert.equal(calls.length, before);
    assert.match(cardFor(room, edited.draftId).text, /Second wording$/); assert.equal(cardFor(room, edited.draftId).webexDraft.edited, 1);
    // A bare 👍 carries no draftId: an edit that landed just before the click is never sent unread. It is refused and the card shows the new text.
    thumbs(room, first); thumbs(room, first); await flush(); await flush();
    assert.equal(calls.length, before, 'a 👍 after an edit sends nothing');
    assert.equal(cardFor(room, edited.draftId).webexDraft.state, 'pending'); assert.match(cardFor(room, edited.draftId).text, /Second wording$/);
    // The card's own Send button carries the draftId it shows; only the current id runs, and only once.
    const sends = [api.approveDraft(draft.draftId), api.approveDraft(edited.draftId), api.approveDraft(edited.draftId)];
    assert.deepEqual((await Promise.all(sends)).map(result => result.status), ['unavailable', 'sent', 'unavailable']);
    await flush();
    assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).body.text, 'Second wording');
    assert.equal(cardFor(room, edited.draftId), undefined, 'the settled card no longer holds a draft id');
    assert.equal(api.editDraft(edited.draftId, 'Too late').status, 'unavailable');
    console.log('PASS an edit voids the old approval and the card asks again; the edited text runs once');

    // 6. Own messages only: edit and delete of someone else's message queue no card.
    const cardsBefore = cards(room).length;
    for (const result of [await actions.editMessage({ ref: 'm3', text: 'Hijack' }), await actions.deleteMessage({ ref: 'm3' })]) { assert.equal(result.status, 'refused'); }
    assert.equal(cards(room).length, cardsBefore);
    assert.equal((await actions.deleteMessage({ ref: 'm9' })).status, 'stale_ref');
    const ambiguous = await actions.send({ to: 'Team', text: 'Hi' });
    assert.equal(ambiguous.status, 'ambiguous'); assert.deepEqual(ambiguous.candidates.map(candidate => candidate.label), ['Build Team', 'Team Lunch']);
    assert.equal((await actions.send({ to: 'Nobody', text: 'Hi' })).status, 'not_found');
    assert.equal(cards(room).length, cardsBefore); assert.equal(calls.length, before + 1);
    console.log('PASS own-message check and unresolved names queue nothing');

    // 7. A resolver label that looks like an id is refused: no card, no send.
    const idLabel = { ...fakeResolver(), space: async () => ok('s9', ROOM_ID, ROOM_ID) };
    const bad = api.createWebexActions({ resolver: idLabel, request, uploadFiles });
    const refused = await bad.send({ to: ROOM_ID, text: 'Hi' });
    assert.equal(refused.status, 'unresolved'); noIds('refusal', refused); assert.equal(cards(room).length, cardsBefore);
    // The old queue path with a Webex-id label becomes a placeholder and refuses to send until the name resolves.
    const legacyId = await api.queueWebexDraft({ recipientLabel: ROOM_ID, roomId: ROOM_ID, text: 'Legacy text' }, async () => { calls.push({ legacy: true }); return { status: 'sent', id: 'x' }; });
    const legacyCard = cardFor(room, legacyId);
    noIds('legacy card text', legacyCard.text); noIds('legacy card html', visible(legacyCard).html); assert.match(legacyCard.text, /^Draft · Webex to a space/);
    assert.equal((await api.approveDraft(legacyId)).status, 'unresolved'); assert.equal(calls.some(call => call.legacy), false);
    thumbs(room, legacyCard); await flush(); assert.equal(calls.some(call => call.legacy), false, '👍 on an unnamed draft sends nothing');
    const named = api.resolveDraftLabel(legacyId, 'Build Team');
    assert.equal(named.status, 'pending'); assert.match(cardFor(room, named.draftId).text, /^Draft · Webex to Build Team/);
    assert.equal(api.resolveDraftLabel(named.draftId, ROOM_ID).status, 'invalid');
    thumbs(room, legacyCard); await flush(); assert.equal(calls.some(call => call.legacy), false, 'a bare 👍 after the name was supplied is refused: the card changed');
    assert.equal((await api.approveDraft(named.draftId)).status, 'sent'); assert.equal(calls.filter(call => call.legacy).length, 1, 'sends once the name resolves');
    bad.dispose();
    actions.dispose(); actions = api.createWebexActions({ resolver: fakeResolver(), request, uploadFiles });
    console.log('PASS an id-shaped label is refused or shown as a placeholder; no send until the name resolves');

    // 8. Reload: a pending card is restored, 👍 after the reload runs the action once with the right private ids.
    const pendingReply = await actions.reply({ to: 'm2', text: 'Survives reload' });
    const replyCardId = cardFor(room, pendingReply.draftId).id;
    const callsBeforeReload = calls.length;
    api = load(); room = api.roomFor(root); room.activate();
    api.connectWebexDrafts(room, () => undefined);
    actions = api.createWebexActions({ resolver: fakeResolver(), request, uploadFiles });
    const restoredCard = room.store.snapshot(true).messages.find(m => m.id === replyCardId);
    assert.equal(restoredCard.webexDraft.state, 'pending'); assert.match(restoredCard.text, /Survives reload$/);
    thumbs(room, restoredCard); thumbs(room, restoredCard); await flush(); await flush();
    assert.equal(calls.length, callsBeforeReload + 1); assert.deepEqual(calls.at(-1), { method: 'POST', endpoint: '/messages', body: { roomId: ROOM_ID, text: 'Survives reload', parentId: MSG_ROOT } });
    assert.equal(room.store.snapshot(true).messages.find(m => m.id === replyCardId).webexDraft.state, 'sent');
    console.log('PASS a pending card survives a reload and runs once');

    // 9. No handler, no modal: AITalk unavailable means unavailable and nothing is posted. The modal is used only when the host supplies it.
    api = load(); room = api.roomFor(root); room.activate();   // no connectWebexDrafts: no approval handler
    const total = calls.length, totalCards = cards(room).length;
    actions = api.createWebexActions({ resolver: fakeResolver(), request, uploadFiles });
    const all = [() => actions.send({ to: 'Build Team', text: 'x' }), () => actions.reply({ to: 'm1', text: 'x' }), () => actions.editMessage({ ref: 'm2', text: 'x' }),
        () => actions.deleteMessage({ ref: 'm2' }), () => actions.upload({ to: 'Build Team', files: ['/tmp/a.pdf'] })];
    for (const run of all) { assert.equal((await run()).status, 'unavailable'); }
    assert.equal(calls.length, total); assert.equal(uploads.length, 1); assert.equal(cards(room).length, totalCards);
    assert.equal((await api.requestApproval({ provider: 'webex', action: 'send', targetLabel: 'Build Team', body: 'x' })).status, 'unavailable', 'requestApproval fails closed');
    const asked = [];
    actions.dispose();
    actions = api.createWebexActions({ resolver: fakeResolver(), request, uploadFiles, modalFallback: async req => { asked.push(req); return asked.length === 2 ? 'rejected' : 'approved'; } });
    assert.equal((await actions.send({ to: 'Build Team', text: 'via modal' })).status, 'sent');
    assert.equal((await actions.send({ to: 'Build Team', text: 'declined' })).status, 'rejected');
    assert.equal((await actions.deleteMessage({ ref: 'm2' })).status, 'done');
    assert.deepEqual(asked.map(req => [req.provider, req.action, req.targetLabel]), [['webex', 'send', 'Build Team'], ['webex', 'send', 'Build Team'], ['webex', 'delete', 'Build Team']]);
    assert.deepEqual(calls.slice(total).map(call => call.method), ['POST', 'DELETE']); noIds('modal request', asked);
    // With a card handler registered the modal is never asked.
    api.connectWebexDrafts(room, () => 'cathy');
    const viaCard = await actions.send({ to: 'Build Team', text: 'card, not modal' });
    assert.equal(viaCard.status, 'pending'); assert.equal(asked.length, 3);
    console.log('PASS without AITalk nothing is sent; the modal runs only when supplied and never beside a card');

    // 10. The seam: an Outlook-like provider's action uses the same card with no Webex code.
    const sent = [];
    api.setDraftExecutor('outlook', async draft => { sent.push(draft); return { status: 'sent', id: 'mail-1' }; });
    const outcome = api.requestApproval({ provider: 'outlook', action: 'create_event', targetLabel: 'Ana Smith', body: 'Sync on the release, Friday 10:00', details: { When: 'Friday 10:00', Thread: 'Release plan' }, files: ['agenda.pdf'] });
    await flush(); await flush();
    const outlookCard = cards(room).find(card => card.webexDraft.provider === 'outlook');
    assert.match(outlookCard.text, /^Draft · Outlook create_event · Ana Smith\nWhen: Friday 10:00\nThread: Release plan\nFiles: agenda\.pdf\n\nSync on the release, Friday 10:00$/);
    assert.match(render.draftCardHtml(outlookCard), /Ana Smith/); assert.deepEqual(sent, []);
    thumbs(room, outlookCard); thumbs(room, outlookCard); await flush(); await flush();
    assert.equal(sent.length, 1); assert.equal((await outcome).status, 'approved');
    assert.match(room.store.takeForTool('cathy').find(message => message.replyTo === outlookCard.id && /Approved/.test(message.text)).text, /Approved: create_event done for Ana Smith\./);
    const rejectedOutcome = api.requestApproval({ provider: 'outlook', action: 'send', targetLabel: 'Ana Smith', body: 'Hello' });
    await flush(); await flush();
    thumbs(room, cards(room).find(card => card.webexDraft.provider === 'outlook' && card.webexDraft.state === 'pending'), '👎');
    assert.equal((await rejectedOutcome).status, 'rejected'); assert.equal(sent.length, 1);
    console.log('PASS an Outlook-like provider renders the same card and settles through requestApproval');

    // 11. The stored card (room store, webview snapshot, log file) holds human fields only; raw ids live in the host-only side store.
    const storedReply = await actions.reply({ to: 'm2', text: 'Stored without ids' });
    const storedCard = cardFor(room, storedReply.draftId);
    const logText = fs.readFileSync(room.store.file, 'utf8');
    for (const card of cards(room)) {
        for (const key of ['internal', 'roomId', 'parentId', 'messageId', 'toPersonId']) { assert.ok(!(key in card.webexDraft), `a stored card never holds ${key}`); }
    }
    noIds('stored room snapshot', room.store.snapshot(true).messages); noIds('stored room log', logText);
    const sideFile = path.join(root, '.askaway', 'aitalk', 'webex-draft-private.json');
    assert.ok(JSON.parse(fs.readFileSync(sideFile, 'utf8'))[storedReply.draftId].internal.parentId === MSG_ROOT, 'the ids are kept host-side, keyed by draft id');
    thumbs(room, storedCard, '👎'); await flush();
    assert.equal(JSON.parse(fs.readFileSync(sideFile, 'utf8'))[storedReply.draftId], undefined, 'a settled draft leaves the side store');
    console.log('PASS the stored card holds names and text only; raw ids stay in the host-only side store');

    // 12. Cross-process double send: two handlers (two windows) on one store; the decision is claimed in the shared log before the draft runs.
    const apiA = load(), apiB = load();
    const roomA = apiA.roomFor(root); roomA.activate(); apiA.connectWebexDrafts(roomA, () => 'cathy');
    const actionsA = apiA.createWebexActions({ resolver: fakeResolver(), request, uploadFiles });
    const twice = await actionsA.send({ to: 'Build Team', text: 'Once across two windows' });
    const roomB = apiB.roomFor(root); roomB.activate(); apiB.connectWebexDrafts(roomB, () => undefined);
    const actionsB = apiB.createWebexActions({ resolver: fakeResolver(), request, uploadFiles });
    const sharedCard = cardFor(roomA, twice.draftId);
    assert.ok(cardFor(roomB, twice.draftId), 'the second window sees the same pending card');
    const beforeTwice = calls.length;
    thumbs(roomA, sharedCard); thumbs(roomB, sharedCard);
    await flush(); await flush(); await flush();
    assert.equal(calls.length, beforeTwice + 1, 'two handlers on one store send exactly once');
    assert.equal(calls.at(-1).body.text, 'Once across two windows');
    assert.equal(roomA.store.snapshot(true).messages.find(m => m.id === sharedCard.id).webexDraft.state, 'sent');
    const claims = Object.keys(roomA.store.snapshot(true).messages.find(m => m.id === sharedCard.id)).filter(key => key.startsWith('decision:'));
    assert.equal(claims.length, 2, 'both handlers claimed in the log');
    assert.equal(Object.values(roomA.store.snapshot(true).messages.find(m => m.id === sharedCard.id)).filter(value => value === '👍').length, 2);
    actionsA.dispose(); actionsB.dispose();
    console.log('PASS two handlers on the same store run a decided draft once');

    // 13. Send target: an exact match across spaces and people wins; two exact matches or only partial matches return candidates.
    const dualOk = (ref, label, id) => ok(ref, label, id);
    const dual = { ...fakeResolver(),
        space: async name => /^ana smith$/i.test(name) ? dualOk('s5', 'Ana Smith', ROOM_ID) : /^ana$/i.test(name) ? dualOk('s7', 'Ana Smith Fans', ROOM_ID) : /^lunch$/i.test(name) ? dualOk('s6', 'Team Lunch', ROOM_ID) : /^bob$/i.test(name) ? dualOk('s8', 'Bob Sled Club', ROOM_ID) : { status: 'not_found', query: name },
        person: async name => /^ana( smith)?$/i.test(name) ? dualOk('p1', 'Ana Smith', PERSON_ID) : /^bob$/i.test(name) ? dualOk('p2', 'Bob', PERSON_ID) : { status: 'not_found', query: name } };
    const picker = api.createWebexActions({ resolver: dual, request, uploadFiles });
    const cardsNow = cards(room).length;
    const both = await picker.send({ to: 'Ana Smith', text: 'Hi' });
    assert.equal(both.status, 'ambiguous'); assert.deepEqual(both.candidates.map(item => [item.kind, item.label]), [['space', 'Ana Smith'], ['person', 'Ana Smith']], 'an exact space and an exact person: ask');
    const partial = await picker.send({ to: 'Ana', text: 'Hi' });
    assert.equal(partial.status, 'ambiguous'); assert.deepEqual(partial.candidates.map(item => item.label), ['Ana Smith Fans', 'Ana Smith'], 'only partial matches: ask, never guess');
    const lonely = await picker.send({ to: 'Lunch', text: 'Hi' });
    assert.equal(lonely.status, 'ambiguous'); assert.deepEqual(lonely.candidates.map(item => item.label), ['Team Lunch'], 'one partial match is still only a candidate');
    assert.equal(cards(room).length, cardsNow, 'no card for an unclear target');
    const bob = await picker.send({ to: 'Bob', text: 'Hi Bob' });
    assert.equal(bob.status, 'pending', 'an exact person beats a partial space');
    assert.match(cardFor(room, bob.draftId).text, /^Draft · Webex send · Bob\n/);
    thumbs(room, cardFor(room, bob.draftId), '👎'); await flush();
    picker.dispose();
    console.log('PASS send target: exact match wins across spaces and people; ties and partial matches return candidates');

    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS EV-WEBEX-APPROVAL-CARD');
})().catch(error => { console.error(error); process.exitCode = 1; });
