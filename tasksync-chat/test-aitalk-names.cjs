const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

(async () => {
    const compiled = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/aitalk/actors.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports);
    const { Room } = loaded.exports;
    const { talkHtml } = await import('./media/aitalk/talkRender.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-names-'));
    const room = new Room(root, 'AA.Orchestrator');
    fs.mkdirSync(path.dirname(room.store.file), { recursive: true });
    const oldMembers = [
        { id: 'you', kind: 'user', displayName: 'Sam', rank: 400 },
        { id: 'validator', kind: 'validator', displayName: 'Validator', rank: 300 },
        { id: 'agent', kind: 'agent', memberId: 'mahesh', displayName: 'Agent', rank: 200 },
        { id: 'worker-abcd', kind: 'worker', displayName: 'verify · worker-abcd', rank: 100 },
        { id: 'webex', kind: 'worker', displayName: 'webex', rank: 100 },
    ];
    fs.writeFileSync(room.store.presenceFile, oldMembers.map((member, i) => JSON.stringify({ id: 'join' + i, presenceEvent: 'joined', member, ts: i + 1 })).join('\n') + '\n');
    fs.writeFileSync(room.store.file, oldMembers.map((member, i) => JSON.stringify({ id: 'old' + i, author: member.id, text: 'Hello @Validator', ts: i + 10 })).join('\n') + '\n');
    room.registerAgent('AA.Orchestrator').post('Current message');
    room.register({ id: 'validator', displayName: 'Validator', kind: 'validator', rank: 300 }).typing(true);
    const state = room.snapshot();
    const html = talkHtml(state.messages, { ...state, draft: '@', presence: { mode: 'awayValidator' } });
    const visible = html.replace(/<[^>]+>/g, '');
    for (const name of ['Sam', 'Priya', 'Mahesh', 'Tara', 'Cathy']) assert.ok(visible.includes(name), name);
    assert.doesNotMatch(visible, /\b(Build|Validator|Agent|Worker|You)\b|worker-|\bverify\b/);
    assert.match(html, /aria-label="Priya is typing/);
    assert.match(html, /data-mention="Tara"/);
    assert.match(visible, /Tara joined/);
    room.registerAgent('AskAway Build').post('Changed selection');
    const next = room.snapshot();
    assert.match(talkHtml(next.messages, next).replace(/<[^>]+>/g, ''), /Bhaskar/);
    console.log('PASS EV-AITALK-NAMES persisted and current room names resolve through the roster');
})().catch(error => { console.error(error); process.exitCode = 1; });
