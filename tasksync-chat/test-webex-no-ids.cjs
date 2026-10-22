// EV-WEBEX-NO-IDS (T046, R-CATHY-02): seed Webex-shaped ids into every fake API response and assert none reaches anything the reviewer
// or the model relays: tool results (incl. errors), approval cards (text, HTML, outcome replies), the AITalk room text, the status
// file, the Output channel lines and the Settings text. Fake Webex API, no network.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const bundle = (contents, external = []) => esbuild.buildSync({ stdin: { contents, resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external }).outputFiles[0].text;
const run = (code, shims = {}) => { const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(name => shims[name] ?? require(name), mod, mod.exports); return mod.exports; };
const api = run(bundle("export * from './src/aitalk/actors'; export * from './src/aitalk/webexDraftCards'; export * from './src/aitalk/delivery'; export * from './src/services/webexDrafts'; export * from './src/services/webexSuite';"));
const flush = () => new Promise(resolve => setImmediate(resolve));
const enc = (kind, n) => Buffer.from(`ciscospark://us/${kind}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`).toString('base64url');
const ROOM = n => enc('ROOM', n), PEOPLE = n => enc('PEOPLE', n), MESSAGE = n => enc('MESSAGE', n);
const MEETING = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', TRACKING = 'ROUTER_6a1b2c3d-1111-2222-3333-444455556666';
const SEEDED = [...Array(10)].flatMap((_, i) => [ROOM(i + 1), PEOPLE(i + 1), MESSAGE(i + 1)]).concat([MEETING], [...Array(100)].map((_, i) => MESSAGE(90 + i)));
const T = hhmm => `2026-10-22T${hhmm}:00.000Z`;

const SHAPED = /Y2lzY29zcGFyazov\S{0,12}|ciscospark:\/\/\S{0,12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const leaks = text => SEEDED.filter(id => text.includes(id)).concat(SHAPED.test(text) ? [`id-shaped text near "${text.slice(Math.max(0, text.search(SHAPED) - 30), text.search(SHAPED) + 40)}"`] : []);
const surfaces = [];
const see = (label, value) => { surfaces.push(label); const text = typeof value === 'string' ? value : JSON.stringify(value); assert.deepEqual(leaks(text), [], `${label} carries a Webex id`); };

(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'webex-no-ids-')));
    const calls = [];
    const people = [{ id: PEOPLE(1), displayName: 'Reviewer Me', emails: ['me@example.test'] }, { id: PEOPLE(2), displayName: 'Alice Jones', emails: ['alice@example.test'] }];
    const rooms = [{ id: ROOM(1), title: 'Release plan', type: 'group', lastActivity: T('09:40') }, { id: ROOM(2), title: 'Build Team', type: 'group', lastActivity: T('08:00') }];
    const messages = [
        { id: MESSAGE(1), roomId: ROOM(1), personId: PEOPLE(2), personEmail: 'alice@example.test', text: `Deploy today? (room ${ROOM(1)})`, created: T('09:00'), files: ['https://webexapis.com/v1/contents/' + MESSAGE(5)] },
        { id: MESSAGE(2), roomId: ROOM(1), personId: PEOPLE(1), personEmail: 'me@example.test', text: `On it, ticket ${MESSAGE(3)}`, created: T('09:10'), parentId: MESSAGE(1) },
    ];
    const reply = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, headers: { get: () => null } });
    const failing = { on: false };
    const request = async (method, endpoint, body) => {
        calls.push({ method, endpoint, body });
        if (failing.on) { throw new Error(`boom ${ROOM(1)} ${endpoint}`); }
        const url = new URL(endpoint, 'https://x.test'), q = url.searchParams, p = url.pathname;
        if (method === 'POST') { return reply({ id: MESSAGE(95) }); }
        if (method !== 'GET') { return reply({ id: MESSAGE(2) }); }
        if (p === '/rooms') { return reply({ items: rooms }); }
        if (p === '/people/me') { return reply(people[0]); }
        if (p === '/people') { return reply({ items: q.get('id') ? people.filter(x => q.get('id').split(',').includes(x.id)) : people.filter(x => x.displayName.toLowerCase().startsWith((q.get('displayName') ?? '').toLowerCase())) }); }
        if (p === '/messages') { return reply({ items: messages.filter(x => x.roomId === q.get('roomId')) }); }
        if (p === '/meetings') { return reply({ items: [{ id: MEETING, title: 'Release sync', start: T('11:00'), end: T('11:30'), hostDisplayName: 'Alice Jones' }] }); }
        if (p === '/meetingInvitees') { return reply({ items: [{ displayName: 'Alice Jones' }] }); }
        return reply({}, 404);
    };
    const tools = api.webexSuiteTools({ request, download: async () => ({ name: 'notes.txt', bytes: Buffer.from(`notes for ${ROOM(2)}`) }), cacheDir: path.join(root, 'cache'), stateFile: path.join(root, '.askaway/webex-seen.json') });
    const tool = (name, args) => tools.find(item => item.name === name).run(args);
    const room = api.roomFor(root); room.activate();
    api.connectWebexDrafts(room, () => 'cathy');

    // 1. Tool results: every read tool and every outbound tool, including refusals and failures.
    const read = await tool('webex_read', { space: 'Release plan' });
    see('webex_read', read);
    see('webex_inbox', await tool('webex_inbox', {}));
    see('webex_find', await tool('webex_find', { query: 'Alice' }));
    see('webex_inbox digest', await tool('webex_inbox', { mode: 'digest' }));
    see('webex_search', await tool('webex_search', { query: 'Deploy' }));
    see('webex_meetings', await tool('webex_meetings', {}));
    see('webex_wait', await tool('webex_wait', { space: 'Release plan', sinceRef: read.messages[1].ref, timeoutSeconds: 1 }));
    see('ambiguous', await tool('webex_read', { space: 'e' }));
    see('stale ref', await tool('webex_read', { thread: 'm99' }));
    const mine = read.messages.find(message => message.fromMe).ref;
    const outbound = {
        send: await tool('webex_send', { to: 'Build Team', text: 'Standup moved to 10.' }),
        reply: await tool('webex_reply', { to: read.messages[0].ref, text: 'Thank you!' }),
        edit: await tool('webex_edit_message', { ref: mine, text: 'On it, done by noon' }),
        del: await tool('webex_delete_message', { ref: mine }),
    };
    for (const [name, result] of Object.entries(outbound)) { assert.equal(result.status, 'pending', name); see(`webex_${name} result`, { ...result, draftId: undefined }); }
    see('webex_edit_message refusal', await tool('webex_edit_message', { ref: read.messages[0].ref, text: 'x' }));
    failing.on = true;
    for (const name of ['webex_inbox', 'webex_read', 'webex_find', 'webex_search']) { see(`${name} error`, await tool(name, name === 'webex_find' || name === 'webex_search' ? { query: 'x' } : name === 'webex_read' ? { space: 's1' } : {})); }
    failing.on = false;
    console.log('PASS tool results (reads, outbound, refusals, errors) carry no Webex id');

    // 2. Approval cards: text, HTML and the outcome replies, before and after 👍.
    const render = await import('./media/aitalk/talkRender.js');
    const cards = () => room.store.snapshot(true).messages.filter(message => message.webexDraft);
    // data-msg is AITalk's own message id, not a Webex id.
    const view = () => cards().map(card => ({ text: card.text, html: render.draftCardHtml(card).replace(/data-msg="[^"]*"/g, ''), shown: (({ internal, ...rest }) => rest)(card.webexDraft) }));
    see('pending cards', view());
    for (const card of view()) { assert.match(card.html, /Release plan|Build Team/); }
    const user = room.store.snapshot().members.find(member => member.kind === 'user').id;
    for (const result of Object.values(outbound)) { const card = cards().find(item => item.draftId === result.draftId); room.react(user, card.id, '👍'); await flush(); await flush(); }
    assert.equal(calls.filter(call => call.method !== 'GET').length, 4, 'the four approved actions ran');
    see('settled cards', view());
    see('outcome replies', room.store.takeForTool('cathy').map(message => message.text));
    see('AITalk room text', room.store.snapshot(true).messages.map(message => message.text));
    // A draft queued with an id-shaped label shows a placeholder and cannot be sent.
    const legacy = await api.queueWebexDraft({ recipientLabel: ROOM(1), roomId: ROOM(1), text: 'Hello' }, async () => ({ status: 'sent' }));
    see('unnamed draft card', view().map(card => [card.text, card.html]));
    assert.equal((await api.approveDraft(legacy)).status, 'unresolved');
    // The stored room (the webview snapshot and the log file) holds human fields only: no id field, no id-shaped string.
    // AskAway's own uuids (message ids, draft ids, decision keys) are not Webex ids, so they are masked before the scan.
    const ownUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const storedSnapshot = JSON.stringify(room.store.snapshot(true)), storedLog = fs.readFileSync(room.store.file, 'utf8');
    see('stored room snapshot', storedSnapshot.replace(ownUuid, '<askaway-id>')); see('stored room log file', storedLog.replace(ownUuid, '<askaway-id>'));
    for (const card of cards()) { for (const key of ['internal', 'roomId', 'parentId', 'messageId', 'toPersonId']) { assert.ok(!(key in card.webexDraft), `a stored card never holds ${key}`); } }
    assert.ok(cards().length >= 5, 'the scan covered the cards');
    console.log('PASS approval cards, their HTML and the outcome replies carry names only');

    // 3. Status file and Output channel: the workspace space by name; request paths and details scrubbed.
    fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
    fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { teamId: 'team', workspaceRoomId: ROOM(1) }, teams: [{ id: 'team', name: 'self', rooms: [{ id: ROOM(1), title: 'Release plan' }] }] }));
    const lines = [];
    const vscodeShim = { workspace: { getConfiguration: () => ({ get: () => true, inspect: () => ({ globalValue: true }) }) } };
    const status = run(bundle("export { WebexStatus } from './src/services/webexStatus';", ['vscode', './webexAuth']), { vscode: vscodeShim, './webexAuth': { WebexAuth: class {} } });
    const recorder = new status.WebexStatus(root, { tokens: async () => ({ accessToken: 'tok-secret', refreshToken: 'ref-secret' }) }, { appendLine: line => lines.push(line) }, () => ({ hasToken: true }));
    await recorder.record('discover', { room: ROOM(2), note: `posting to ${ROOM(1)}` });
    await recorder.http('messages', 'POST', `https://webexapis.com/v1/messages/${MESSAGE(1)}`, { clone: () => ({ json: async () => ({ message: `no such room ${ROOM(3)}`, trackingId: TRACKING }) }), status: 404, headers: { get: () => null } });
    const statusFile = fs.readFileSync(path.join(root, '.askaway/webex-status.json'), 'utf8');
    see('status file', statusFile.split(TRACKING).join('[support tracking id]')); see('Output channel lines', lines);
    assert.match(statusFile, /"workspaceSpace": "Release plan"/); assert.doesNotMatch(statusFile, /workspaceRoomId/);
    assert.ok(statusFile.includes(TRACKING), 'the support tracking id is kept in the file for diagnostics'); assert.ok(!lines.join('').includes(TRACKING), 'but not in the Output channel');
    assert.doesNotMatch(statusFile + lines.join(''), /tok-secret|ref-secret/);
    console.log('PASS the status file and Output channel name the space and carry no Webex id');

    // 4. Settings text: the roomId setting and the missing-space hint do not ask for or show an id.
    const pkg = require('./package.json');
    const setting = pkg.contributes.configuration.properties['askaway.webex.roomId'];
    see('Settings description', setting.description); assert.doesNotMatch(setting.description, /\bID\b|GET \/rooms/);
    const service = fs.readFileSync(path.join(__dirname, 'src/services/webexService.ts'), 'utf8');
    assert.match(service, /No Webex space is chosen for this workspace\./); assert.doesNotMatch(service, /Missing Webex Room ID|room\/space ID/);
    console.log('PASS Settings text and the missing-space hint describe a space by name');

    console.log(`PASS EV-WEBEX-NO-IDS ${surfaces.length} surfaces checked against ${SEEDED.length} seeded ids`);
    fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
