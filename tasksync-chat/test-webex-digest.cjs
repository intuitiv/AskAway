// EV-WEBEX-DIGEST (T058, R-CATHY-09..14, FR-046..050): `webex_inbox mode: digest` from the in-memory index, with a fake Webex API (no network).
// Fake API assumptions: GET /rooms items {id,title,type,lastActivity}; GET /messages?roomId items {id,roomId,personId,created,text,parentId?,mentionedPeople?: [personId]}
// (also for direct rooms); GET /people/me {id,displayName}; GET /people?id=a,b items {id,displayName}.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const code = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexSuite'; export * from './src/services/assistant/webexIndex';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
const api = mod.exports;

const enc = (kind, n) => Buffer.from(`ciscospark://us/${kind}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`).toString('base64url');
const ROOM = n => enc('ROOM', n), PEOPLE = n => enc('PEOPLE', n), MESSAGE = n => enc('MESSAGE', n);
const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const H = 3_600_000, D = 24 * H;
const MARK = 'zqmark';
const ME = PEOPLE(1), ALICE = PEOPLE(2), BOB = PEOPLE(3), CARL = PEOPLE(4);
const people = [{ id: ME, displayName: 'Reviewer Me' }, { id: ALICE, displayName: 'Alice Jones' }, { id: BOB, displayName: 'Bob Smith' }, { id: CARL, displayName: 'Carl Spam' }];
const rooms = [
    { id: ROOM(1), title: 'Release plan', type: 'group', lastActivity: ago(H) },
    { id: ROOM(2), title: 'Alice Jones', type: 'direct', lastActivity: ago(3 * H) },
    { id: ROOM(3), title: 'Bob Smith', type: 'direct', lastActivity: ago(D) },
    { id: ROOM(4), title: 'Old announcements', type: 'group', lastActivity: ago(240 * D) },
    { id: ROOM(5), title: 'Newsletter', type: 'group', lastActivity: ago(2 * H) },
    { id: ROOM(6), title: 'Mentioned in quiet', type: 'group', lastActivity: ago(H) },
    { id: ROOM(7), title: 'Replied in quiet', type: 'group', lastActivity: ago(H) },
    { id: ROOM(8), title: 'Carl Spam', type: 'direct', lastActivity: ago(2 * H) },
];
const msg = (n, room, person, age, text, extra = {}) => ({ id: MESSAGE(n), roomId: ROOM(room), personId: person, created: ago(age), text: `${text} ${MARK}`, ...extra });
const messages = [
    msg(1, 1, ME, 10 * D, 'Posted by Cathy for me: ship plan?'),
    msg(2, 1, ALICE, 2 * H, 'Reply to your ship plan question', { parentId: MESSAGE(1) }),
    msg(3, 1, BOB, H, 'Please review @Reviewer Me', { mentionedPeople: [ME] }),
    msg(4, 2, ME, 2 * D, 'Hi Alice'), msg(5, 2, ALICE, 3 * H, 'Can you send the numbers?'),
    msg(6, 3, BOB, 2 * D, 'ping'), msg(7, 3, ME, D, 'Done, Bob'),
    msg(8, 4, ALICE, 240 * D, 'Old news'),
    msg(9, 5, ALICE, 2 * H, 'Weekly newsletter'),
    msg(10, 6, ALICE, H, 'Hey @Reviewer Me look', { mentionedPeople: [ME] }),
    msg(11, 7, ME, 210 * D, 'An old question of mine'), msg(12, 7, BOB, H, 'Late answer to your question', { parentId: MESSAGE(11) }),
    msg(13, 8, CARL, 2 * H, 'Buy my stuff'),
];

function fakeWorkspace(label, options = {}) {
    const calls = [];
    const clock = options.clock ?? { now: NOW };
    const request = async (method, endpoint, body) => {
        calls.push({ method, endpoint, body });
        const reply = data => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } });
        if (method !== 'GET') { return reply({ id: MESSAGE(99) }); }
        const url = new URL(endpoint, 'https://x.test'), q = url.searchParams;
        if (url.pathname === '/rooms') { return reply({ items: rooms }); }
        if (url.pathname === '/people/me') { return reply(people[0]); }
        if (url.pathname === '/people') { return reply({ items: people.filter(x => (q.get('id') ?? '').split(',').includes(x.id)) }); }
        if (url.pathname === '/messages') { return reply({ items: messages.filter(x => x.roomId === q.get('roomId')) }); }
        return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    };
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `webex-digest-${label}-`)));
    const tools = api.webexSuiteTools({ request, download: async () => ({ name: 'x.txt', bytes: Buffer.alloc(0) }), cacheDir: path.join(root, 'cache'), stateFile: path.join(root, '.askaway/webex-seen.json'), now: () => clock.now, digest: { muteFile: options.muteFile ?? path.join(root, 'no-mute.json') } });
    return { calls, root, clock, tools, digest: args => tools.find(t => t.name === 'webex_inbox').run({ mode: 'digest', ...args }) };
}
const count = (calls, p) => calls.filter(c => c.endpoint.startsWith(p)).length;
const SHAPED = /Y2lzY29zcGFyazov\S{0,12}|ciscospark:\/\/\S{0,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const filesUnder = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]);

(async () => {
    // 1. Coverage: group, 1:1, tagged and replied threads; names only; read-only.
    api.resetWebexIndex();
    const a = fakeWorkspace('a');
    const result = await a.digest({});
    assert.equal(result.status, 'ok');
    assert.equal(result.mode, 'digest');
    const text = JSON.stringify(result);
    assert.ok(!SHAPED.test(text), 'no id-shaped text in the digest');
    for (const n of [1, 2, 3, 4]) { for (const id of [ROOM(n), PEOPLE(n), MESSAGE(n)]) { assert.ok(!text.includes(id)); } }
    assert.deepEqual(result.mentions.map(m => m.space).sort(), ['Mentioned in quiet', 'Release plan']);
    assert.ok(result.mentions.every(m => /^m\d+$/.test(m.ref)), 'short refs');
    const reply = result.replies.find(r => r.space === 'Release plan');
    assert.ok(reply && reply.author === 'Alice Jones' && /Posted by Cathy/.test(reply.yourMessage), 'reply to a thread posted for him (by Cathy) shows');
    assert.ok(result.replies.some(r => r.space === 'Replied in quiet'), 'a reply to his message shows even in a quiet space');
    assert.ok(result.mentions.some(m => m.space === 'Mentioned in quiet'), 'a mention shows in a quiet space');
    assert.deepEqual(result.unansweredDirect.map(m => m.space).sort(), ['Alice Jones', 'Carl Spam'], 'unanswered DMs only; Bob was answered');
    assert.equal(result.skipped, '2 quiet spaces skipped', 'old announcements and newsletter');
    assert.equal(a.calls.filter(c => c.method !== 'GET').length, 0, 'no send call');
    console.log('PASS digest covers group, 1:1, mentions and replies by name, read-only');

    // 2. One sync for two workspaces; freshness limit.
    assert.equal(count(a.calls, '/rooms'), 1);
    const b = fakeWorkspace('b');
    const again = await b.digest({});
    assert.equal(again.status, 'ok');
    assert.equal(count(b.calls, '/rooms') + count(b.calls, '/messages'), 0, 'the second workspace reads the shared index');
    assert.equal(again.mentions.length, result.mentions.length);
    a.clock.now += 9 * 60_000;
    await a.digest({});
    assert.equal(count(a.calls, '/rooms'), 1, 'inside the freshness limit: no new sync');
    a.clock.now += 2 * 60_000;
    await a.digest({});
    assert.equal(count(a.calls, '/rooms'), 2, 'past ten minutes: one new sync');
    // Concurrent callers share one sync.
    api.resetWebexIndex();
    const c = fakeWorkspace('c'), d = fakeWorkspace('d');
    await Promise.all([c.digest({}), d.digest({})]);
    assert.equal(count(c.calls, '/rooms') + count(d.calls, '/rooms'), 1, 'two workspaces at once: one sync');
    console.log('PASS one sync shared by workspaces; refreshed only after the freshness limit');

    // 3. Mute list.
    api.resetWebexIndex();
    const muteFile = path.join(a.root, 'webex-mute.json');
    fs.writeFileSync(muteFile, JSON.stringify({ spaces: ['carl spam'] }));
    const m = fakeWorkspace('m', { muteFile });
    const muted = await m.digest({});
    assert.deepEqual(muted.unansweredDirect.map(x => x.space), ['Alice Jones']);
    assert.equal(muted.skipped, '3 quiet spaces skipped');
    assert.ok(muted.mentions.length === 2 && muted.replies.length === 2, 'mentions and replies still show');
    console.log('PASS mute list skips a space; the count line names it');

    // 4. No message text on disk.
    for (const ws of [a, b, c, d, m]) { for (const file of filesUnder(ws.root)) { assert.ok(!fs.readFileSync(file, 'utf8').includes(MARK), `message text written to ${file}`); } }
    assert.equal(fs.readFileSync(muteFile, 'utf8').includes(MARK), false);
    console.log('PASS no message text on disk');

    // 5. Shape of the tool set.
    assert.ok(a.tools.length <= 12 && !a.tools.some(t => /digest/.test(t.name)), 'digest is a mode of inbox, not a tool');
    assert.equal((await a.tools.find(t => t.name === 'webex_inbox').run({ mode: 'bogus' })).status, 'invalid');
    for (const ws of [a, b, c, d, m]) { fs.rmSync(ws.root, { recursive: true, force: true }); }
    console.log('PASS EV-WEBEX-DIGEST');
})().catch(error => { console.error(error); process.exitCode = 1; });
