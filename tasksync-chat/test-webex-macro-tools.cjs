// EV-WEBEX-MACRO-TOOLS: Cathy's read macros (inbox, find, read, search, wait, meetings) against an in-process fake Webex API.
// One call by name replaces the old find_space -> read -> thread -> attachments chain; no raw Webex id ever reaches a result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const enc = (kind, n) => Buffer.from(`ciscospark://us/${kind}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`).toString('base64url');
const ROOM = n => enc('ROOM', n), PEOPLE = n => enc('PEOPLE', n), MESSAGE = n => enc('MESSAGE', n);
const T = hhmm => `2026-10-22T${hhmm}:00.000Z`;
const NOW = Date.parse('2026-10-22T10:00:00.000Z');
const MEETING_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SEEDED = [...Array(10)].flatMap((_, i) => [ROOM(i + 1), PEOPLE(i + 1), MESSAGE(i + 1)]).concat(MEETING_ID);

function makeFake() {
    const calls = [];
    const state = { meetings: 'ok', clock: NOW, extraMessages: [] };
    const people = [
        { id: PEOPLE(1), displayName: 'Reviewer Me', emails: ['me@example.test'] },
        { id: PEOPLE(2), displayName: 'Alice Jones', emails: ['alice@example.test'], title: 'Engineer', status: 'active' },
        { id: PEOPLE(3), displayName: 'Vinayak Chowsalkar', emails: ['vinayak@example.test'] },
        { id: PEOPLE(4), displayName: 'Alex Smith', emails: ['asmith@example.test'] },
        { id: PEOPLE(5), displayName: 'Alex Stone', emails: ['astone@example.test'] },
    ];
    const rooms = [
        { id: ROOM(1), title: 'Release plan', type: 'group', lastActivity: T('09:40') },
        { id: ROOM(2), title: 'Release plan archive', type: 'group', lastActivity: '2026-09-01T08:00:00.000Z' },
        { id: ROOM(3), title: 'Build Team', type: 'group', lastActivity: T('08:00') },
        { id: ROOM(4), title: 'Build Alerts', type: 'group', lastActivity: '2026-10-20T08:00:00.000Z' },
        { id: ROOM(5), title: 'Vinayak Chowsalkar', type: 'direct', lastActivity: T('09:50') },
    ];
    const msg = (n, roomId, p, text, created, extra = {}) => ({ id: MESSAGE(n), roomId, personId: people[p - 1].id, personEmail: people[p - 1].emails[0], text, created: T(created), ...extra });
    const content = n => `https://webexapis.com/v1/contents/${n}`;
    const messages = () => [
        msg(1, ROOM(1), 2, 'Release notes attached', '09:00', { files: [content('n1')] }),
        msg(2, ROOM(1), 3, 'Looks fine, can you check?', '09:10', { parentId: MESSAGE(1), mentionedPeople: [PEOPLE(1)] }),
        msg(3, ROOM(1), 2, 'Second doc', '09:20', { files: [content('n2')] }),
        msg(6, ROOM(1), 2, 'thanks', '09:25', { parentId: MESSAGE(3) }),
        msg(4, ROOM(1), 1, 'Will do', '09:30', { parentId: MESSAGE(1) }),
        msg(5, ROOM(1), 3, `Any update? (internal ${ROOM(1)})`, '09:40'),
        msg(7, ROOM(3), 2, 'Build is green', '08:00'),
        { id: MESSAGE(9), roomId: ROOM(4), personId: PEOPLE(2), personEmail: 'alice@example.test', text: 'Old alert', created: '2026-10-20T08:00:00.000Z' },
        { id: MESSAGE(8), roomId: ROOM(5), personId: PEOPLE(1), personEmail: 'me@example.test', text: 'Thanks', created: T('09:50') },
    ].concat(state.extraMessages);
    const reply = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, headers: { get: () => null } });
    const request = async (method, endpoint) => {
        calls.push({ method, endpoint });
        if (method !== 'GET') { throw new Error('read tools must never write'); }
        const url = new URL(endpoint, 'https://x.test');
        const q = url.searchParams;
        const p = url.pathname;
        if (p === '/rooms') { return reply({ items: [...rooms].sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity)) }); }
        if (p === '/people/me') { return reply(people[0]); }
        if (p === '/people') {
            let items = people;
            if (q.get('id')) { items = people.filter(x => q.get('id').split(',').includes(x.id)); }
            else if (q.get('displayName')) { items = people.filter(x => x.displayName.toLowerCase().startsWith(q.get('displayName').toLowerCase())); }
            else if (q.get('email')) { items = people.filter(x => x.emails.includes(q.get('email'))); }
            return reply({ items });
        }
        if (p === '/messages/direct') { return reply({ items: messages().filter(x => x.roomId === ROOM(5)).sort((a, b) => Date.parse(b.created) - Date.parse(a.created)) }); }
        if (p === '/messages') {
            let items = messages().filter(x => x.roomId === q.get('roomId'));
            if (q.get('parentId')) { items = items.filter(x => x.parentId === q.get('parentId')); }
            return reply({ items: items.sort((a, b) => Date.parse(b.created) - Date.parse(a.created)).slice(0, Number(q.get('max') ?? 50)) });
        }
        if (p.startsWith('/messages/')) {
            const found = messages().find(x => x.id === decodeURIComponent(p.slice('/messages/'.length)));
            return found ? reply(found) : reply({}, 404);
        }
        if (p === '/meetings') {
            if (state.meetings !== 'ok') { return reply({}, state.meetings); }
            return reply({ items: [
                { id: MEETING_ID, title: 'Release sync', start: T('11:00'), end: T('11:30'), hostDisplayName: 'Alice Jones', hostEmail: 'alice@example.test' },
                { id: `${MEETING_ID}ff`, title: 'Retro', start: T('15:00'), end: T('15:30'), hostDisplayName: 'Reviewer Me', hostEmail: 'me@example.test' },
            ] });
        }
        if (p === '/meetingInvitees') {
            return reply({ items: q.get('meetingId') === MEETING_ID ? [{ displayName: 'Vinayak Chowsalkar' }, { displayName: 'Reviewer Me' }] : [{ displayName: 'Reviewer Me' }] });
        }
        return reply({}, 404);
    };
    const download = async url => url.endsWith('n1') ? { name: 'notes.txt', bytes: Buffer.from('Release notes: ship Friday') } : { name: 'plan.pdf', bytes: Buffer.from('%PDF') };
    return { calls, state, request, download };
}
const assertNoIds = (label, value) => {
    const text = JSON.stringify(value);
    assert.ok(!/Y2lzY29zcGFyazov/.test(text), `${label}: base64 ciscospark id leaked`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), `${label}: uuid leaked`);
    for (const id of SEEDED) { assert.ok(!text.includes(id), `${label}: seeded id leaked`); }
};

async function main() {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/assistant/webexRead'; export * from './src/services/assistant/webexResolver'; export * from './src/services/webexSuite';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { webexReadTools } = mod.exports;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webex-macro-'));
    const kinds = calls => calls.map(c => c.endpoint.split('?')[0]).sort();
    const tools = (fake, extra = {}) => {
        const cacheDir = fs.mkdtempSync(path.join(root, 'cache-'));
        const list = webexReadTools({ request: fake.request, download: fake.download, extract: async () => 'PDF text of the plan', cacheDir, now: () => fake.state.clock, ...extra });
        return { cacheDir, run: (name, args) => list.find(tool => tool.name === name).run(args) };
    };
    const outputs = [];
    const keep = (label, value) => { outputs.push([label, value]); return value; };

    // (a) one read by name vs the old chain on the same fake API.
    // The retired chain, replayed as the raw requests the nine old tools made: find_space, read, two thread reads, two attachment lookups.
    const oldFake = makeFake();
    const get = endpoint => oldFake.request('GET', endpoint).then(response => response.json());
    const found = await get('/rooms?sortBy=lastactivity&max=100');
    const roomId = found.items.find(room => room.title === 'Release plan').id;
    await get(`/messages?roomId=${encodeURIComponent(roomId)}&max=50`);
    for (const parentId of [MESSAGE(1), MESSAGE(3)]) { await get(`/messages?roomId=${encodeURIComponent(roomId)}&parentId=${encodeURIComponent(parentId)}&max=50`); }
    for (const messageId of [MESSAGE(1), MESSAGE(3)]) { await get(`/messages/${encodeURIComponent(messageId)}`); }
    assert.equal(oldFake.calls.length, 6, 'old chain: find_space, read, 2 threads, 2 attachment lookups');

    const fake = makeFake();
    const t = tools(fake);
    const read = keep('read', await t.run('webex_read', { space: 'Release plan' }));
    assert.equal(read.status, 'ok');
    assert.equal(fake.calls.length, 4, 'one webex_read by name: rooms, me, messages, author names');
    assert.deepEqual(kinds(fake.calls), ['/messages', '/people', '/people/me', '/rooms']);
    assert.ok(fake.calls.length < oldFake.calls.length, 'the macro makes fewer calls than the old chain');
    assert.equal(read.conversation, 'Release plan');
    assert.deepEqual(read.messages.map(m => m.author), ['Alice Jones', 'Vinayak Chowsalkar', 'Alice Jones', 'Alice Jones', 'Reviewer Me', 'Vinayak Chowsalkar'], 'authors are names, oldest first');
    assert.deepEqual(read.messages.map(m => m.time), [T('09:00'), T('09:10'), T('09:20'), T('09:25'), T('09:30'), T('09:40')]);
    const [first, replyToFirst] = read.messages;
    assert.equal(replyToFirst.threadOf, first.ref, 'thread marker points at the root by ref');
    assert.equal(read.messages[4].fromMe, true);
    assert.equal(replyToFirst.mentionsMe, true);
    assert.equal(first.files[0].text, 'Release notes: ship Friday', 'attachment text arrives in the same call');
    assert.equal(read.messages[2].files[0].text, 'PDF text of the plan');
    assert.match(read.messages[5].text, /Any update\? \(internal \[id removed\]\)/, 'an id inside message text is scrubbed');
    assert.deepEqual(fs.readdirSync(t.cacheDir).filter(n => !n.startsWith('att-')), [], 'only attachment files are written');
    const before = fake.calls.length;
    await t.run('webex_read', { space: 'Release plan' });
    assert.equal(fake.calls.length - before, 1, 'a second read reuses the cached spaces, owner and names');
    const mark = fake.calls.length;
    const thread = keep('thread', await t.run('webex_read', { thread: first.ref }));
    assert.deepEqual(fake.calls.slice(mark).map(c => c.endpoint.startsWith('/messages/') ? 'root' : c.endpoint.split('?')[0]).sort(), ['/messages', 'root'], 'thread by ref: replies and the root, no space lookup');
    assert.deepEqual(thread.messages.map(m => m.text), ['Release notes attached', 'Looks fine, can you check?', 'Will do']);
    const direct = keep('direct', await t.run('webex_read', { person: 'Vinayak Chowsalkar' }));
    assert.equal(direct.conversation, 'Vinayak Chowsalkar');
    assert.deepEqual(direct.messages.map(m => m.text), ['Thanks']);
    console.log('PASS EV-WEBEX-MACRO-TOOLS one webex_read by space name = 4 calls (old chain = 6), names, threads and attachment text in one result');

    // (b) ambiguity never guesses.
    const mark2 = fake.calls.length;
    const ambiguous = keep('ambiguous', await t.run('webex_read', { space: 'Build' }));
    assert.equal(ambiguous.status, 'ambiguous');
    assert.deepEqual(ambiguous.candidates.map(c => c.label).sort(), ['Build Alerts', 'Build Team']);
    assert.ok(ambiguous.candidates.every(c => /^s\d+$/.test(c.ref)));
    assert.ok(!fake.calls.slice(mark2).some(c => c.endpoint.startsWith('/messages')), 'no messages were read for an ambiguous name');
    const picked = await t.run('webex_read', { space: ambiguous.candidates.find(c => c.label === 'Build Team').ref });
    assert.equal(picked.conversation, 'Build Team');
    assert.equal((await t.run('webex_read', { person: 'Alex' })).candidates.length, 2);
    const searchHit = keep('search', await t.run('webex_search', { query: 'update', space: 'Release plan' }));
    assert.deepEqual(searchHit.matches.map(m => [m.author, m.space]), [['Vinayak Chowsalkar', 'Release plan']]);
    const find = keep('find', await t.run('webex_find', { query: 'Alice' }));
    assert.deepEqual(find.people.map(p => [p.label, p.title, p.presence]), [['Alice Jones', 'Engineer', 'active']]);
    assert.equal((await t.run('webex_find', { query: 'Build', kind: 'space' })).spaces.length, 2);
    assert.equal((await t.run('webex_find', { query: 'nobody-here' })).status, 'not_found');
    console.log('PASS EV-WEBEX-MACRO-TOOLS ambiguous names return candidates with refs, find returns profile and presence, search names authors');

    // inbox with the seen watermark, persisted across instances.
    const stateFile = path.join(root, '.askaway', 'webex-seen.json');
    const inboxFake = makeFake();
    const inbox = tools(inboxFake, { stateFile });
    const unread = keep('inbox', await inbox.run('webex_inbox', { unreadOnly: true }));
    assert.equal(inboxFake.calls.length, 6, 'inbox: rooms, me, one messages call for each of 3 active spaces, names');
    assert.deepEqual(unread.spaces.map(s => [s.space, s.unseen, s.waitingOnMe, s.mentionsMe]), [['Release plan', 5, true, true], ['Build Team', 1, true, false]]);
    assert.equal(unread.spaces[0].lastMessage.author, 'Vinayak Chowsalkar');
    assert.deepEqual((await inbox.run('webex_inbox', { mentionsOnly: true })).spaces.map(s => s.space), ['Release plan']);
    await inbox.run('webex_read', { space: 'Release plan' });
    assert.ok(fs.existsSync(stateFile), 'the watermark is persisted');
    const reopened = tools(makeFake(), { stateFile });
    assert.deepEqual((await reopened.run('webex_inbox', { unreadOnly: true })).spaces.map(s => s.space), ['Build Team'], 'a space read by webex_read is no longer unseen after a reload');
    const all = await reopened.run('webex_inbox', {});
    assert.equal(all.spaces.find(s => s.space === 'Vinayak Chowsalkar').waitingOnMe, false, 'my own last message is not waiting on me');
    console.log('PASS EV-WEBEX-MACRO-TOOLS inbox: unread, mentions, waiting-on-me, persisted seen watermark');

    // wait: backoff, new message from someone else.
    const waitFake = makeFake();
    const sleeps = [];
    const waiter = tools(waitFake, { sleep: async ms => { sleeps.push(ms); waitFake.state.clock += ms; if (sleeps.length === 1) { waitFake.state.extraMessages.push({ id: MESSAGE(10), roomId: ROOM(1), personId: PEOPLE(2), personEmail: 'alice@example.test', text: 'Fresh reply', created: new Date(waitFake.state.clock - 500).toISOString() }); } } });
    const arrived = keep('wait', await waiter.run('webex_wait', { space: 'Release plan', timeoutSeconds: 30 }));
    assert.equal(arrived.status, 'ok');
    assert.deepEqual(arrived.messages.map(m => [m.author, m.text]), [['Alice Jones', 'Fresh reply']]);
    assert.deepEqual(sleeps, [2000]);
    const timeoutFake = makeFake(); const timeoutSleeps = [];
    const timeout = tools(timeoutFake, { sleep: async ms => { timeoutSleeps.push(ms); timeoutFake.state.clock += ms; } });
    assert.equal((await timeout.run('webex_wait', { space: 'Release plan', timeoutSeconds: 5 })).status, 'timeout');
    assert.deepEqual(timeoutSleeps, [2000, 3000], 'backoff grows and never overshoots the deadline');
    const sinceTools = tools(makeFake());
    const sinceRead = await sinceTools.run('webex_read', { space: 'Release plan' });
    const ownRef = sinceRead.messages.find(m => m.fromMe).ref;
    assert.deepEqual((await sinceTools.run('webex_wait', { space: 'Release plan', sinceRef: ownRef, timeoutSeconds: 1 })).messages.map(m => m.text), ['Any update? (internal [id removed])'], 'sinceRef starts after that message and skips my own');
    console.log('PASS EV-WEBEX-MACRO-TOOLS wait returns the new message from others, backs off, times out in plain words');

    // (e) stale ref.
    const stale = keep('stale', await tools(makeFake()).run('webex_read', { thread: 'm99' }));
    assert.equal(stale.status, 'stale_ref');
    assert.match(stale.hint, /webex_inbox or webex_find/);
    assert.equal((await tools(makeFake()).run('webex_read', { space: 's7' })).status, 'stale_ref');
    assert.equal((await t.run('webex_read', {})).status, 'invalid');
    assert.equal((await t.run('webex_read', { space: 'x', person: 'y' })).status, 'invalid');
    assert.equal((await t.run('webex_read', { roomId: ROOM(1) })).status, 'invalid', 'ids are not an accepted argument');
    console.log('PASS EV-WEBEX-MACRO-TOOLS stale ref says to look the thing up again; id arguments are refused');

    // (f) meetings: read-only, plain-words refusals.
    const meetFake = makeFake();
    const meet = tools(meetFake);
    const meetings = keep('meetings', await meet.run('webex_meetings', {}));
    assert.deepEqual(meetings.meetings.map(m => [m.title, m.host, m.participants]), [['Release sync', 'Alice Jones', ['Vinayak Chowsalkar', 'Reviewer Me']], ['Retro', 'Reviewer Me', ['Reviewer Me']]]);
    assert.deepEqual(kinds(meetFake.calls), ['/meetingInvitees', '/meetingInvitees', '/meetings']);
    assert.ok(meetFake.calls[0].endpoint.includes('from=2026-10-22T10%3A00%3A00.000Z'), 'defaults to now');
    assert.deepEqual((await meet.run('webex_meetings', { person: 'Vinayak Chowsalkar' })).meetings.map(m => m.title), ['Release sync']);
    meetFake.state.meetings = 403;
    const refused = keep('refused', await meet.run('webex_meetings', {}));
    assert.equal(refused.status, 'unauthorized');
    assert.match(refused.message, /not allowed to read your meetings \(it needs the meeting:schedules_read permission\)/);
    meetFake.state.meetings = 401;
    assert.match((await meet.run('webex_meetings', {})).message, /sign-in is missing or expired/);
    meetFake.state.meetings = 429;
    assert.equal((await meet.run('webex_meetings', {})).status, 'busy');
    console.log('PASS EV-WEBEX-MACRO-TOOLS meetings are read-only; 403/401/429 become plain-words results, not exceptions');

    // (c) nothing is created; (d) no raw ids anywhere.
    for (const f of [fake, inboxFake, waitFake, meetFake]) { assert.ok(f.calls.every(c => c.method === 'GET'), 'reads only GET'); }
    for (const [label, value] of outputs) { assertNoIds(label, value); }
    const failing = webexReadTools({ request: async () => { throw new Error(`boom ${ROOM(1)}`); }, download: fake.download, cacheDir: root });
    assertNoIds('error', await failing.find(tool => tool.name === 'webex_inbox').run({}));
    assert.equal(failing.length, 6);
    console.log(`PASS EV-WEBEX-MACRO-TOOLS reads create nothing (GET only) and ${outputs.length} results carry no raw Webex id`);
    fs.rmSync(root, { recursive: true, force: true });
}
main().catch(error => { console.error(error); process.exit(1); });
