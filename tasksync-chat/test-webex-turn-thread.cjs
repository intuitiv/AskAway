process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
process.env.ASKAWAY_AVAILABILITY_MODE = 'away';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), esbuild = require('esbuild');
const root = path.join(__dirname, 'build', 'turn-thread-' + process.pid);
fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace' } }));
const calls = [], messages = [], conversation = [];
let seq = 0, webhook = true;
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => ({ 'webex.enabled': true, 'webex.notifyOnTurnEnd': true })[key] ?? fallback }) }, commands: { executeCommand: async (id, args) => conversation.push({ id, args }) } };
const build = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexService'; export * from './src/services/webexIncomingWebhook'; export * from './src/services/handoffNotifier'; export * from './src/services/telegramConversationReply'; export * from './src/commentary/telegramLive';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', build.outputFiles[0].text)(id => id === 'vscode' ? vscode : require(id), loaded, loaded.exports, () => ({}), () => {}, () => ({}), () => {});
const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://fixture'); calls.push({ method: req.method, url: req.url, raw });
    if (url.pathname.startsWith('/incoming/')) { messages.push({ id: 'hook-' + ++seq, markdown: JSON.parse(raw).markdown, personEmail: 'incoming-webhooks@webex.bot', created: new Date().toISOString() }); res.writeHead(204); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { const parent = url.searchParams.get('parentId'); res.end(JSON.stringify({ items: messages.filter(m => parent ? m.parentId === parent : !m.parentId) })); return; }
    const multipart = raw.includes('name="files"');
    const body = multipart ? { markdown: /name="markdown"\r\n\r\n([^]*?)\r\n--/.exec(raw)?.[1], parentId: /name="parentId"\r\n\r\n([^]*?)\r\n--/.exec(raw)?.[1] } : JSON.parse(raw || '{}');
    const message = { ...body, id: 'token-' + ++seq, personId: 'owner', created: new Date().toISOString() };
    if (req.method === 'POST') messages.push(message);
    res.end(JSON.stringify(message));
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    const hook = new loaded.exports.WebexIncomingWebhook({ get: async () => webhook ? 'https://webexapis.com/v1/webhooks/incoming/fixture' : undefined }, async () => assert.fail('no Keychain'), 'linux', base + '/incoming');
    const service = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture' }) }, path.join(root, 'absent'), { baseUrl: base + '/v1', wait: async () => {} }, hook);
    await service.reloadConfig(); service.onReply(async (task, text) => loaded.exports.submitTelegramConversationReply(text));
    try {
        for (const [index, route] of ['turn', 'alert', 'top', 'fallback'].entries()) {
            webhook = route !== 'fallback'; const before = calls.length;
            const relay = new loaded.exports.TelegramLiveCommentary(() => loaded.exports.webexLivePoster(service, 'TaskSync'), 'TaskSync', { minEditMs: 0, activity: () => ({ requests: 2, workers: 1, dollars: 1, lastIn: 1200, turnOut: 300, lastActivityAt: Date.now() }) });
            const view = { turnStarts: [Date.now()], currentPrompt: 'Build the feature', items: [] };
            await relay.update(view); const thread = messages.findLast(m => !m.parentId)?.id;
            view.items.push({ ts: Date.now(), kind: 'commentary', text: 'Working' }); await relay.update(view); await relay.tick();
            view.items.push({ ts: Date.now(), kind: 'heads-up', text: 'Need attention' }); await relay.update(view);
            const notifier = new loaded.exports.HandoffNotifier(loaded.exports.createHandoffTargets(() => service, () => undefined), undefined, () => {});
            notifier._readStamp = () => 100 + index; notifier._findHandoff = () => ({ handoff: 'Next: Continue?', details: 'Full response' });
            await notifier._onTurnEnd();
            const sent = calls.slice(before); assert.ok(sent.some(c => c.method === 'PUT' && c.raw.includes('Working')));
            const file = sent.find(c => c.raw.includes('name="files"')); assert.ok(file && file.raw.includes('Continue?') && file.raw.includes(thread));
            assert.equal(sent.filter(c => c.raw.includes('name="files"')).length, 1);
            if (webhook) { assert.ok(sent.some(c => c.url.startsWith('/incoming/') && c.raw.includes('💬 TaskSync:'))); assert.ok(sent.some(c => c.url.startsWith('/incoming/') && c.raw.includes('✅ TaskSync: finished'))); assert.ok(sent.some(c => c.url.startsWith('/incoming/') && c.raw.includes('Need attention'))); }
            const alert = messages.findLast(m => m.personEmail)?.id;
            messages.push({ id: 'answer-' + index, text: 'yes', personId: 'owner', created: new Date().toISOString(), ...(route === 'turn' ? { parentId: thread } : route === 'alert' ? { parentId: alert } : {}) });
            const count = conversation.length; await service._poll(); await service._poll(); assert.equal(conversation.length, count + 2); assert.equal(conversation.at(-2).args.query, 'yes');
            relay.dispose();
        }
        await service.postText('Local continuation', 'Local continuation', 'handoff:local');
        service.resolveHandoffs(); assert.equal(service.getActiveTaskCount(), 0);
        const delivered = conversation.length; await service._poll(); assert.equal(conversation.length, delivered);
        console.log('PASS Webex turn thread: notifying root, edited threaded status, combined final/document, finish alert, turn/alert/top-level replies once and token fallback');
    } finally { service.dispose(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error('FAIL Webex turn thread:', error.message); process.exitCode = 1; });
