// EV-WEBEX-NAME-RESOLVER: names to short opaque refs to internal ids, against an in-process fake Webex API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const enc = (kind, n) => Buffer.from(`ciscospark://us/${kind}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`).toString('base64url');
const ROOM = n => enc('ROOM', n), PEOPLE = n => enc('PEOPLE', n), MESSAGE = n => enc('MESSAGE', n);
const people = [
    { id: PEOPLE(1), displayName: 'Reviewer Me', emails: ['me@example.test'] },
    { id: PEOPLE(2), displayName: 'Alice Jones', emails: ['alice@example.test'] },
    { id: PEOPLE(3), displayName: 'Alex Smith', emails: ['asmith@example.test'] },
    { id: PEOPLE(4), displayName: 'Alex Stone', emails: ['astone@example.test'] },
    { id: PEOPLE(5), displayName: 'P4 Support', emails: ['support@example.test'] },
];
const rooms = [
    { id: ROOM(1), title: 'Release plan', type: 'group', lastActivity: '2026-10-22T09:40:00.000Z' },
    { id: ROOM(2), title: 'Release plan archive', type: 'group', lastActivity: '2026-09-01T08:00:00.000Z' },
    { id: ROOM(3), title: 'Build Team', type: 'group', lastActivity: '2026-10-22T08:00:00.000Z' },
    { id: ROOM(4), title: 'Build Alerts', type: 'group', lastActivity: '2026-10-20T08:00:00.000Z' },
    { id: ROOM(5), title: 'Ops3 team', type: 'group', lastActivity: '2026-10-19T08:00:00.000Z' },
];
const messages = [
    { id: MESSAGE(1), roomId: ROOM(1), personId: PEOPLE(2), personEmail: 'alice@example.test', text: 'First', created: '2026-10-22T09:00:00.000Z' },
    { id: MESSAGE(2), roomId: ROOM(1), personId: PEOPLE(3), personEmail: 'asmith@example.test', text: 'Alex here', created: '2026-10-22T09:10:00.000Z', parentId: MESSAGE(1) },
    { id: MESSAGE(3), roomId: ROOM(1), personId: PEOPLE(1), personEmail: 'me@example.test', text: 'Mine', created: '2026-10-22T09:20:00.000Z', parentId: MESSAGE(1) },
    { id: MESSAGE(4), roomId: ROOM(1), personId: PEOPLE(2), personEmail: 'alice@example.test', text: 'Latest from Alice', created: '2026-10-22T09:30:00.000Z' },
    { id: MESSAGE(5), roomId: ROOM(1), personId: PEOPLE(4), personEmail: 'astone@example.test', text: 'Alex again', created: '2026-10-22T09:35:00.000Z' },
];
const SEEDED = [...rooms.map(r => r.id), ...people.map(p => p.id), ...messages.map(m => m.id)];
const calls = [];
const request = async (method, endpoint) => {
    calls.push(`${method} ${endpoint}`);
    const url = new URL(endpoint, 'https://x.test'); const q = url.searchParams; const p = url.pathname;
    const reply = data => ({ ok: true, status: 200, json: async () => data });
    if (p === '/rooms') { return reply({ items: rooms }); }
    if (p === '/people/me') { return reply(people[0]); }
    if (p === '/people') {
        if (q.get('id')) { return reply({ items: people.filter(x => q.get('id').split(',').includes(x.id)) }); }
        if (q.get('email')) { return reply({ items: people.filter(x => x.emails.includes(q.get('email'))) }); }
        return reply({ items: people.filter(x => x.displayName.toLowerCase().startsWith((q.get('displayName') ?? '').toLowerCase())) });
    }
    if (p === '/messages') { return reply({ items: messages.filter(x => x.roomId === q.get('roomId')).sort((a, b) => Date.parse(b.created) - Date.parse(a.created)) }); }
    return { ok: false, status: 404, json: async () => ({}) };
};
const noIds = (label, value) => {
    const text = JSON.stringify(value);
    for (const id of SEEDED) { assert.ok(!text.includes(id), `${label}: raw id leaked`); }
    assert.ok(!/Y2lzY29zcGFyazov/.test(text), `${label}: base64 id leaked`);
};

async function main() {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/assistant/webexResolver';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { WebexResolver, scrubIds, scrubText, plainWords, WebexHttpError } = mod.exports;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webex-resolver-'));
    const resolver = new WebexResolver({ request, now: () => Date.parse('2026-10-22T10:00:00.000Z') });

    // Names resolve to short refs; the id stays inside and never serialises.
    const plan = await resolver.space('Release plan');
    assert.equal(plan.status, 'ok');
    assert.equal(plan.label, 'Release plan', 'an exact name wins over a longer name that contains it');
    assert.match(plan.ref, /^s\d+$/);
    assert.equal(plan._internal.id, ROOM(1), 'the host can still reach the id');
    noIds('resolved space', plan);
    assert.equal((await resolver.space('release PLAN')).ref, plan.ref, 'case-insensitive, and the same space keeps its ref');
    assert.equal((await resolver.space(plan.ref))._internal.id, ROOM(1), 'a ref resolves back to the space');
    assert.equal((await resolver.space('Release plan arch')).label, 'Release plan archive', 'a unique partial name resolves');
    assert.deepEqual(await resolver.space('No such space'), { status: 'not_found', query: 'No such space' });
    const alice = await resolver.person('Alice Jones');
    assert.match(alice.ref, /^p\d+$/);
    assert.equal((await resolver.person('alice@example.test')).ref, alice.ref, 'a person by email and by name share one ref');
    noIds('resolved person', alice);
    console.log('PASS EV-WEBEX-NAME-RESOLVER names resolve to short refs, exact beats partial, raw ids stay inside');

    // Ambiguity returns candidates, never a guess.
    const build2 = await resolver.space('Build');
    assert.equal(build2.status, 'ambiguous');
    assert.deepEqual(build2.candidates.map(c => c.label).sort(), ['Build Alerts', 'Build Team']);
    assert.ok(build2.candidates.every(c => c.kind === 'space' && /^s\d+$/.test(c.ref) && c.detail));
    noIds('space candidates', build2);
    assert.equal((await resolver.space(build2.candidates[0].ref)).status, 'ok', 'a candidate ref picks it');
    const alex = await resolver.person('Alex');
    assert.equal(alex.status, 'ambiguous');
    assert.deepEqual(alex.candidates.map(c => [c.label, c.detail]).sort(), [['Alex Smith', 'asmith@example.test'], ['Alex Stone', 'astone@example.test']]);
    noIds('person candidates', alex);
    console.log('PASS EV-WEBEX-NAME-RESOLVER ambiguous space and person names return candidates with refs');

    // Messages: refs, "latest from <person> in <space>", mine flag, thread root.
    const latest = await resolver.latestFrom('Alice Jones', 'Release plan');
    assert.equal(latest.status, 'ok');
    assert.match(latest.ref, /^m\d+$/);
    const found = await resolver.message(latest.ref);
    assert.equal(found.status, 'ok');
    assert.equal(found.space.label, 'Release plan');
    assert.equal(found.mine, false);
    assert.equal(found.messageId, MESSAGE(4));
    assert.equal(found.thread, undefined, 'a top-level message has no thread');
    const mine = await resolver.message((await resolver.latestFrom('Reviewer Me', 'Release plan')).ref);
    assert.equal(mine.mine, true);
    assert.equal(mine.rootId, MESSAGE(1), 'a reply points at its thread root');
    assert.equal(mine.thread.label, 'Thread in Release plan');
    noIds('message refs', [latest, found.space, mine.thread]);
    assert.equal((await resolver.latestFrom('Alex', 'Release plan')).status, 'ambiguous', 'two Alexes in the space: ask, do not guess');
    assert.equal((await resolver.latestFrom('Carol', 'Release plan')).status, 'not_found');
    assert.equal((await resolver.latestFrom('Alice', 'Build')).status, 'ambiguous', 'an ambiguous space is reported before any message is read');
    console.log('PASS EV-WEBEX-NAME-RESOLVER message refs, latest-from-person, mine flag and thread root resolve inside the host');

    // (e) stale refs.
    const fresh = new WebexResolver({ request });
    assert.deepEqual(await fresh.space('s9'), { status: 'stale_ref', ref: 's9', hint: 'Call webex_inbox or webex_find again.' });
    assert.equal((await fresh.person('p9')).status, 'stale_ref');
    assert.equal((await fresh.message('m9')).status, 'stale_ref');
    assert.equal((await fresh.space(plan.ref)).status, 'stale_ref', 'a ref from another session is stale, not a guess');
    // An opaque ref that misses the table is stale at once: no name fallback, whatever else matches ("s3" is not a name like "Ops3 team").
    assert.equal((await fresh.space('s3')).status, 'stale_ref', 'a missed space ref never falls back to a name containing it');
    assert.equal((await fresh.person('p4')).status, 'stale_ref', 'a missed person ref never falls back to a name starting with it');
    assert.equal((await fresh.space('Ops3 team')).status, 'ok', 'the real name still resolves');
    assert.equal((await fresh.space('Ops3')).status, 'ok', 'and so does a longer partial name');
    assert.equal((await fresh.message('m3')).status, 'stale_ref');
    console.log('PASS EV-WEBEX-NAME-RESOLVER a ref this session never issued is stale and says to look it up again');

    // Seen watermark: monotonic, persisted, only in the state file.
    const stateFile = path.join(root, '.askaway', 'webex-seen.json');
    const one = new WebexResolver({ request, stateFile });
    assert.equal(one.seen(ROOM(1)), undefined);
    one.markSeen(ROOM(1), '2026-10-22T09:00:00.000Z');
    one.markSeen(ROOM(1), '2026-10-22T08:00:00.000Z');
    assert.equal(one.seen(ROOM(1)), '2026-10-22T09:00:00.000Z', 'an older time never moves the watermark back');
    assert.equal(new WebexResolver({ request, stateFile }).seen(ROOM(1)), '2026-10-22T09:00:00.000Z', 'persisted across a reload');
    fs.writeFileSync(stateFile, '{broken');
    assert.equal(new WebexResolver({ request, stateFile }).seen(ROOM(1)), undefined, 'a damaged state file starts fresh');
    console.log('PASS EV-WEBEX-NAME-RESOLVER seen watermark is monotonic, persisted and survives a damaged file');

    // The scrubber and plain-words errors.
    assert.equal(scrubText(`room ${ROOM(1)} and ciscospark://us/ROOM/abc and 123e4567-e89b-12d3-a456-426614174000 and ${'a1b2c3d4'.repeat(4)}`), 'room [id removed] and [id removed] and [id removed] and [id removed]');
    assert.equal(scrubText('see docs/specs/009-webex-remote-channel/contracts and release-notes-for-the-big-friday-launch'), 'see docs/specs/009-webex-remote-channel/contracts and release-notes-for-the-big-friday-launch', 'ordinary long words are kept');
    const b64 = Buffer.from('ciscospark://us/ROOM/>>>???~~~>>>???').toString('base64');
    assert.ok(/[+/]/.test(b64), 'the fixture is standard base64 with + or /');
    assert.equal(scrubText(`room ${b64} ok`), 'room [id removed] ok', 'a standard base64 id is removed whole, not left half-scrubbed');
    assert.equal(scrubText(`token ${'AbCd1234+/'.repeat(4)} end`), 'token [id removed] end', 'a long + and / token is removed');
    assert.deepEqual(scrubIds({ a: [`x ${PEOPLE(2)}`, { b: MESSAGE(1) }], n: 3 }), { a: ['x [id removed]', { b: '[id removed]' }], n: 3 });
    assert.equal(plainWords(new WebexHttpError(403), 'read your meetings', 'meeting:schedules_read').status, 'unauthorized');
    assert.equal(plainWords(new Error(`boom ${ROOM(1)}`), 'do it').message, 'Webex could not do it.', 'an unknown error never echoes its text');
    console.log('PASS EV-WEBEX-NAME-RESOLVER scrubber removes ids, keeps ordinary words; errors become plain words');
    fs.rmSync(root, { recursive: true, force: true });
}
main().catch(error => { console.error(error); process.exit(1); });
