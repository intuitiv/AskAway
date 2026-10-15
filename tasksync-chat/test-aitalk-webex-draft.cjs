// Caller view of A6: a Webex worker's draft appears in AITalk as a card (recipient + full text); 👍 is the
// permission that sends it once through the Webex tool host; 👎 discards; an edit voids the old approval; the
// outcome is the reply to the worker's card; pending drafts survive a reload. Fakes only, no network.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const ts = require('typescript');
const providerSource = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const routing = providerSource.slice(providerSource.indexOf('    private _handleWebviewMessage('), providerSource.indexOf("            case 'requestSpecs':")) + '        }\n    }\n';
const routingJs = ts.transpileModule('class Provider { ' + routing + ' } exports.Provider = Provider;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/actors'; export * from './src/aitalk/webexDraftCards'; export * from './src/aitalk/delivery'; export { registerToolDefinitions } from './src/workers/workerTools'; export * from './src/services/webexSuite'; export * from './src/services/webexDrafts';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
// Each load is a fresh extension host: new draft queue, new rooms, same workspace files.
const load = () => { const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports); return mod.exports; };
(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-webex-draft-')));
    const posts = [];
    let modal = 0;
    // The Webex tool host as the extension builds it, with a fake HTTP request and a modal that would say yes.
    const host = api => api.webexSuiteTools({ cacheDir: path.join(root, 'cache'), approve: async () => { modal++; return 'approved'; },
        request: async (method, endpoint, body) => {
            if (method === 'POST') { posts.push(body); return { ok: true, json: async () => ({ id: `msg-${posts.length}` }) }; }
            return { ok: true, json: async () => endpoint.startsWith('/rooms/') ? { id: 'room-1', title: 'Build Team' } : { items: [] } };
        } });
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const flush = () => new Promise(resolve => setImmediate(resolve));
    // The widget with the extension's message routing (webviewProvider: aitalkApproveDraft → approveDraft, aitalkReact → room.react).
    const mount = (api, room) => {
        const handlers = [], intents = [];
        const panel = { innerHTML: '', querySelector: () => undefined };
        const providerModule = {};
        new Function('exports', 'approveDraft', 'roomFor', 'vscode', 'aitalkUserName', 'gitGlobalUserName', routingJs)(providerModule, api.approveDraft, () => room, { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => fallback }) } }, async () => 'Reviewer', () => 'Reviewer');
        const provider = new providerModule.Provider();
        const widget = createTalkController({ host: panel, events: { addEventListener: (name, fn) => { if (name === 'click') handlers.push(fn); } }, post: action => {
            intents.push(action);
            provider._handleWebviewMessage(action);
        } });
        provider._broadcast = message => { if (message.type === 'aitalkState') widget.render(message.data); };
        const click = dataset => { for (const fn of handlers) fn({ target: { closest: selector => selector === 'button' ? { dataset, hasAttribute: () => false } : null } }); };
        return { panel, intents, click, paint: () => widget.render(room.snapshot()) };
    };

    let api = load();
    let room = api.roomFor(root);
    room.activate();
    api.connectWebexDrafts(room, () => 'webex-worker-1');
    let tools = host(api);
    const run = (name, args) => tools.find(tool => tool.name === name).run(args);
    const card = id => room.store.snapshot(true).messages.find(message => message.id === id);
    const cardFor = draftId => room.store.snapshot(true).messages.find(message => message.draftId === draftId);
    let view = mount(api, room);

    // 1. The worker's draft is a card in AITalk: recipient (space, thread) and the full text, marked Draft; nothing is sent.
    const longText = `Deploy plan <b>v1</b>:\n${'step and check '.repeat(30)}\nend of message`;
    const first = await run('webex_send', { roomId: 'room-1', parentId: 'thread-7', text: longText });
    assert.equal(first.status, 'pending'); assert.equal(posts.length, 0); assert.equal(modal, 0, 'AITalk is the permission, not a modal');
    const firstCard = cardFor(first.draftId);
    assert.equal(firstCard.author, 'webex-worker-1', 'the worker posts its own draft card');
    assert.equal(room.isRegistered('webex-worker-1'), true);
    view.paint();
    assert.match(view.panel.innerHTML, /talk-draft-badge">Draft</);
    assert.match(view.panel.innerHTML, /<dt>Space<\/dt><dd>Build Team<\/dd>/);
    assert.match(view.panel.innerHTML, /<dt>Thread<\/dt><dd>reply to thread-7<\/dd>/);
    assert.ok(view.panel.innerHTML.includes(`<div class="talk-draft-text">${longText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`), 'full text, escaped, never collapsed');
    assert.match(view.panel.innerHTML, /data-react="👍" data-msg="[^"]+" aria-label="Approve and send"/);
    console.log('PASS draft card shows Draft, space, thread and the full escaped text; nothing sent');

    // 2. Edit voids the old approval: a 👍 from the stale card sends nothing; the card asks again.
    const edited = await run('webex_edit_draft', { draftId: first.draftId, text: 'Deploy at 3pm.' });
    assert.equal(edited.status, 'pending'); assert.notEqual(edited.draftId, first.draftId);
    view.click({ react: '👍', msg: firstCard.id });
    assert.equal(view.intents.at(-1).draftId, first.draftId, 'stale widget still holds the old draft');
    await flush(); assert.equal(posts.length, 0, 'old approval is void after an edit');
    assert.equal((await api.approveDraft(first.draftId)).status, 'unavailable');
    view.paint();
    assert.match(view.panel.innerHTML, /edited, approve again/);
    assert.match(view.panel.innerHTML, /<div class="talk-draft-text">Deploy at 3pm.<\/div>/);
    console.log('PASS edit voids the old approval and the card asks again');

    // 3. 👍 is the permission: double click sends exactly once; the card turns Sent with the id; the worker gets the reply.
    view.click({ react: '👍', msg: firstCard.id }); view.click({ react: '👍', msg: firstCard.id });
    await flush(); await flush();
    assert.deepEqual(view.intents.slice(-2).map(intent => intent.draftId), [edited.draftId, edited.draftId]);
    assert.deepEqual(posts, [{ roomId: 'room-1', text: 'Deploy at 3pm.', parentId: 'thread-7' }], 'sent exactly once, edited text, in thread');
    assert.equal(card(firstCard.id).webexDraft.state, 'sent'); assert.equal(card(firstCard.id).webexDraft.sentId, 'msg-1');
    assert.match(view.panel.innerHTML, /talk-draft-badge">Sent</); assert.match(view.panel.innerHTML, /Sent · id <code>msg-1<\/code>/);
    assert.doesNotMatch(view.panel.innerHTML.slice(view.panel.innerHTML.indexOf(`id="talk-${firstCard.id}"`)).split('talk-row')[0], /Approve and send/);
    let inbox = room.store.takeForTool('webex-worker-1');
    assert.equal(inbox.length, 1); assert.equal(inbox[0].replyTo, firstCard.id); assert.match(inbox[0].text, /sent to Build Team · id msg-1/);
    console.log('PASS 👍 double click sends once; card turns Sent with id; worker gets the outcome as the reply');

    // 4. 👎 / Reject discards: nothing sent, card Rejected, worker told; a later approval sends nothing.
    const second = await run('webex_send', { toPersonEmail: 'ana@example.test', text: 'Can you review?' });
    const secondCard = cardFor(second.draftId);
    view.paint();
    assert.match(view.panel.innerHTML, /<dt>Person<\/dt><dd>ana@example.test<\/dd>/);
    view.click({ react: '👎', msg: secondCard.id });
    assert.equal(view.intents.at(-1).type, 'aitalkReact');
    assert.equal(card(secondCard.id).webexDraft.state, 'rejected');
    assert.equal((await api.approveDraft(second.draftId)).status, 'unavailable');
    assert.equal(posts.length, 1, 'rejected draft is never sent');
    await flush(); assert.match(view.panel.innerHTML, /Rejected · nothing was sent/);
    inbox = room.store.takeForTool('webex-worker-1');
    const outcome = inbox.find(message => /Rejected/.test(message.text));
    assert.equal(outcome.replyTo, secondCard.id); assert.match(outcome.text, /Rejected: nothing was sent to ana@example.test/);
    console.log('PASS 👎 rejects: nothing sent; card Rejected; worker gets the outcome');

    // 5. Never without the user's approval: another actor's 👍 sends nothing.
    const third = await run('webex_send', { roomId: 'room-1', text: 'Survives reload' });
    const thirdCard = cardFor(third.draftId);
    room.registerAgent(); room.react('agent', thirdCard.id, '👍'); await flush();
    assert.equal(posts.length, 1); assert.equal(card(thirdCard.id).webexDraft.state, 'pending');
    console.log('PASS only the user\'s 👍 is permission; drafts never send without it');

    // 6. Reload: a fresh extension host maps the live pending card back into the draft queue; 👍 still sends once.
    api = load(); room = api.roomFor(root); room.activate();
    api.connectWebexDrafts(room, () => undefined);
    tools = host(api);
    view = mount(api, room); view.paint();
    assert.match(view.panel.innerHTML, /Survives reload/); assert.match(view.panel.innerHTML, new RegExp(`data-msg="${thirdCard.id}" aria-label="Approve and send"`));
    view.click({ react: '👍', msg: thirdCard.id }); view.click({ react: '👍', msg: thirdCard.id });
    await flush(); await flush();
    assert.equal(posts.length, 2); assert.deepEqual(posts[1], { roomId: 'room-1', text: 'Survives reload' });
    assert.equal(card(thirdCard.id).webexDraft.state, 'sent');
    assert.equal(card(firstCard.id).webexDraft.state, 'sent', 'settled cards stay settled after reload');
    console.log('PASS pending draft survives reload; approval after reload sends once');

    // 7. Storybook: the same widget fed by simulated actors shows the draft card and settles it once.
    const story = fs.readFileSync(path.join(__dirname, 'storybook/stories/Talk.stories.js'), 'utf8');
    assert.match(story, /export const WebexDraftApproval =/);
    const { createSimulatedRoom } = await import('./storybook/prototypes/simulatedActors.js');
    const render = await import('./media/aitalk/talkRender.js');
    let painted;
    const sim = createSimulatedRoom({ render: state => { painted = state; }, schedule: () => {} });
    sim.act({ do: 'add', message: { id: 'sim-draft', author: 'webex-worker', draftId: 'd1', text: 'Draft', webexDraft: { state: 'pending', recipientLabel: 'Build Team', space: 'Build Team', text: 'Hello team' } } });
    assert.match(render.threadHtml(painted.messages, painted.members), /Approve and send/);
    sim.intent({ type: 'aitalkApproveDraft', draftId: 'd1' }); sim.intent({ type: 'aitalkApproveDraft', draftId: 'd1' });
    assert.equal(painted.messages.filter(message => message.replyTo === 'sim-draft').length, 1);
    assert.match(render.threadHtml(painted.messages, painted.members), /Sent · id/);
    console.log('PASS Storybook simulated actors feed the same draft card; 👍 settles once');
    api.connectWebexDrafts(room, () => api.currentAITalkCaller()?.recipient);
    const mcp = new Map();
    const hostCode = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/services/webexToolsHost.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode', './webexAuth', '../webview/webviewProvider', '../workers/workerTools'] }).outputFiles[0].text;
    const hostModule = { exports: {} };
    new Function('require', 'module', 'exports', hostCode)(name => name === '../workers/workerTools' ? api : ['vscode', './webexAuth', '../webview/webviewProvider'].includes(name) ? {} : require(name), hostModule, hostModule.exports);
    hostModule.exports.registerWebexToolsHost((name, config, handler) => mcp.set(name, handler), tools);
    for (const location of ['transport', 'arguments']) {
        const meta = { workerId: `mcp-webex-${location}`, workspacePath: root };
        const args = { roomId: 'room-1', text: 'Can you review this draft?' };
        const result = await mcp.get('webex_send')(location === 'arguments' ? { ...args, _meta: meta } : args, location === 'transport' ? { _meta: meta } : undefined);
        const draft = JSON.parse(result.content[0].text);
        assert.equal(draft.status, 'pending');
        assert.equal(cardFor(draft.draftId).author, meta.workerId);
        assert.notEqual(cardFor(draft.draftId).author, 'webex');
        assert.equal(api.currentAITalkCaller(), undefined, 'caller identity does not leak after the call');
    }
    console.log('PASS EV-WEBEX-MCP-CALLER transport and argument metadata attribute drafts to the calling worker');
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS EV-AITALK-WEBEX-DRAFT');
})().catch(error => { console.error(error); process.exitCode = 1; });
