// Caller view of the Cathy bug (2026-10-21): the MCP server is shared by every VS Code window, so a Webex draft queued by a worker
// of workspace 2 must be a card in workspace 2's AITalk room, never in the room of the window that owns the server.
// Worker A (workspace 1) -> room 1 only; worker B (workspace 2) -> room 2 only; an unidentified caller -> the server owner's room;
// 👍 in the room that holds the card sends it once, from that room's window too. Fakes only, no network.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/actors'; export * from './src/aitalk/webexDraftCards'; export * from './src/aitalk/delivery'; export { registerToolDefinitions } from './src/workers/workerTools'; export * from './src/services/webexSuite'; export * from './src/services/webexDrafts';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
// Each load is one VS Code window's extension host: its own draft queue and rooms, the same workspace files.
const load = () => { const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports); return mod.exports; };
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'webex-draft-workspace-')));
    const ws1 = path.join(base, 'workspace-1'), ws2 = path.join(base, 'workspace-2');
    fs.mkdirSync(ws1); fs.mkdirSync(ws2);
    const posts = [];
    const tools = api => api.webexSuiteTools({ cacheDir: path.join(base, 'cache'), approve: async () => 'approved',
        request: async (method, endpoint, body) => {
            if (method === 'POST') { posts.push(body); return { ok: true, json: async () => ({ id: `msg-${posts.length}` }) }; }
            return { ok: true, json: async () => endpoint.startsWith('/rooms/') ? { id: 'space', title: 'Build Team' } : { items: [] } };
        } });
    // The MCP server as the owner window builds it: tools registered once, every call carries the worker's identity in the transport _meta.
    const mcp = new Map();
    const owner = load();
    const ownerRoom = owner.roomFor(ws1);
    ownerRoom.activate();
    owner.roomFor(ws2).activate(); // window 2 activates its own room at startup; the files are shared
    owner.connectWebexDrafts(ownerRoom, () => owner.currentAITalkCaller()?.recipient);
    owner.registerToolDefinitions((name, config, handler) => mcp.set(name, handler), tools(owner));
    const draft = async (meta, text) => JSON.parse((await mcp.get('webex_send')({ roomId: 'space', text }, meta ? { _meta: meta } : undefined)).content[0].text);
    const cardsIn = root => owner.roomFor(root).store.snapshot(true).messages.filter(message => message.webexDraft);
    const only = (root, other, id) => {
        assert.equal(cardsIn(root).filter(message => message.draftId === id).length, 1, `the card is in ${path.basename(root)}`);
        assert.equal(cardsIn(other).filter(message => message.draftId === id).length, 0, `the card is not in ${path.basename(other)}`);
        return cardsIn(root).find(message => message.draftId === id);
    };

    // 1. Worker A of workspace 1 -> room 1 only.
    const a = await draft({ workerId: 'worker-a', workspacePath: ws1 }, 'Hello from workspace 1');
    assert.equal(a.status, 'pending');
    assert.equal(only(ws1, ws2, a.draftId).author, 'worker-a');
    console.log('PASS worker A of workspace 1: the draft card is in room 1 only');

    // 2. Worker B of workspace 2 asks the same (workspace 1) server -> room 2 only, authored by worker B.
    const b = await draft({ workerId: 'worker-b', workspacePath: ws2 }, 'Message to Vinayak');
    assert.equal(b.status, 'pending');
    assert.equal(only(ws2, ws1, b.draftId).author, 'worker-b');
    assert.equal(owner.currentAITalkCaller(), undefined, 'caller identity does not leak after the call');
    console.log('PASS worker B of workspace 2: the draft card is in room 2 only');

    // 3. A caller that names no workspace (an orchestrator probe) falls back to the server owner's room.
    const probe = await draft(undefined, 'Probe without a workspace');
    only(ws1, ws2, probe.draftId);
    const nameless = await draft({ workerId: 'worker-c' }, 'Worker without a workspace');
    assert.equal(only(ws1, ws2, nameless.draftId).author, 'worker-c');
    console.log('PASS an unidentified caller falls back to the server owner\'s room');

    // 4. 👍 in the room that holds the card sends it once and settles it there; the other room is untouched.
    const userOf = room => room.store.snapshot().members.find(member => member.kind === 'user').id;
    const react = (api, root, draftId) => { const room = api.roomFor(root); const card = room.store.snapshot(true).messages.find(message => message.draftId === draftId); room.react(userOf(room), card.id, '👍'); return card; };
    const bCard = react(owner, ws2, b.draftId); react(owner, ws2, b.draftId);
    await flush(); await flush();
    assert.deepEqual(posts, [{ roomId: 'space', text: 'Message to Vinayak' }], 'sent exactly once');
    assert.equal(owner.roomFor(ws2).store.snapshot(true).messages.find(message => message.id === bCard.id).webexDraft.state, 'sent');
    assert.ok(owner.roomFor(ws2).store.snapshot(true).messages.some(message => message.replyTo === bCard.id && /sent to Build Team/.test(message.text)), 'the outcome is a reply in room 2');
    assert.equal(cardsIn(ws1).filter(message => message.webexDraft.state !== 'pending').length, 0, 'room 1 cards are untouched');
    console.log('PASS 👍 in room 2 sends the room 2 draft once and settles the card in room 2');

    // 5. Window 2 is its own process: approving workspace 1's pending card there still sends it from the room that holds it.
    const window2 = load();
    const room1InWindow2 = window2.roomFor(ws1);
    window2.connectWebexDrafts(room1InWindow2, () => undefined);
    window2.registerToolDefinitions(() => undefined, tools(window2));
    room1InWindow2.react(userOf(room1InWindow2), cardsIn(ws1).find(message => message.draftId === a.draftId).id, '👍');
    await flush(); await flush();
    assert.equal(posts.length, 2); assert.deepEqual(posts[1], { roomId: 'space', text: 'Hello from workspace 1' });
    assert.equal(cardsIn(ws1).find(message => message.author === 'worker-a').webexDraft.state, 'sent');
    console.log('PASS approval is resolved against the room that holds the card, even from another window');
    fs.rmSync(base, { recursive: true, force: true });
    console.log('PASS EV-WEBEX-DRAFT-WORKSPACE');
})().catch(error => { console.error(error); process.exitCode = 1; });
