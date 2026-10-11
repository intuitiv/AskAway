process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
process.env.ASKAWAY_AVAILABILITY_MODE = 'away';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const root = path.join(__dirname, 'build', 'webex-live-reply-' + process.pid);
fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace', generalRoomId: 'general' } }));
const timers = new Map(), commands = [], requests = [], messages = [];
let next = 0, service;
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => ({ 'webex.enabled': true, 'webex.roomId': 'workspace', 'webex.notifyOnTurnEnd': true })[key] ?? fallback }) }, commands: { executeCommand: async (id, args) => commands.push({ id, args }) } };
const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/services/handoffNotifier'; export * from './src/services/webexService'; export * from './src/services/webexIncomingWebhook'; export * from './src/services/telegramConversationReply';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(id => id === 'vscode' ? vscode : require(id), loaded, loaded.exports, (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; }, id => timers.delete(id));
const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://fixture'); requests.push({ method: req.method, path: url.pathname, parent: url.searchParams.get('parentId') });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/incoming/')) {
        messages.push({ id: 'summary-' + ++next, text: JSON.parse(raw).markdown, personId: 'webhook-bot', personEmail: 'incoming-webhooks@webex.bot', created: new Date().toISOString() });
        res.end('{}'); // Successful Incoming Webhooks responses need not contain a message ID.
    } else if (req.method === 'GET') {
        const parent = url.searchParams.get('parentId');
        res.end(JSON.stringify({ items: messages.filter(message => parent ? message.parentId === parent : !message.parentId).slice().reverse() }));
    } else {
        const message = { id: 'own-' + ++next, text: 'AskAway document', personId: 'token-owner', created: new Date().toISOString() };
        if (req.method === 'POST') messages.push(message);
        res.end(JSON.stringify(message));
    }
});
async function tick() {
    assert.equal(timers.size, 1, 'one outbound poll timer must be active');
    const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.callback();
}
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const hook = new loaded.exports.WebexIncomingWebhook({ get: async () => 'https://webexapis.com/v1/webhooks/incoming/fixture' }, undefined, 'linux', base + '/incoming');
    const create = async () => {
        const result = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture' }) }, path.join(root, 'absent'), { baseUrl: base + '/v1' }, hook);
        await result.reloadConfig();
        result.onReply(async (task, text) => { assert.match(task, /^handoff:/); await loaded.exports.submitTelegramConversationReply(text); });
        return result;
    };
    const ledger = () => JSON.parse(fs.readFileSync(path.join(root, '.askaway/webex-messages.json')));
    try {
        service = await create();
        for (const [index, threaded] of [false, true].entries()) {
            const notifier = new loaded.exports.HandoffNotifier(loaded.exports.createHandoffTargets(() => service, () => undefined), undefined, () => {});
            notifier._readStamp = () => 1234 + index;
            notifier._findHandoff = () => ({ handoff: `Next: continue ${index}?`, details: '' });
            await notifier._onTurnEnd();
            assert.equal(ledger().tasks.length, 1, 'no-ID webhook handoff must persist exactly one reply task');
            assert.equal(ledger().tasks[0].handoff, true);
            const parent = messages.at(-1).id;
            fs.writeFileSync(path.join(root, 'response.md'), 'Full response'); await service.sendDocument(path.join(root, 'response.md'), 'Document');
            service.dispose(); service = await create();
            assert.equal(service.getActiveTaskCount(), 1, 'reload must restore the handoff task');
            await tick(); assert.equal(commands.length, index * 2, 'neither webhook sender nor recorded token-owner post is a reply');
            messages.push({ id: 'reviewer-' + index, text: 'yes', personId: 'token-owner', personEmail: 'reviewer', created: new Date().toISOString(), ...(threaded ? { parentId: parent } : {}) });
            await tick();
            assert.equal(commands.length, (index + 1) * 2, `${threaded ? 'threaded' : 'top-level'} yes must reach conversation once`);
            assert.equal(commands.at(-2).args.query, 'yes');
            assert.equal(ledger().tasks.length, 0);
            service.dispose(); service = await create(); await service._poll();
            assert.equal(commands.length, (index + 1) * 2, 'reload/re-poll must not redeliver');
        }
        assert.ok(requests.some(request => request.parent?.startsWith('summary-')), 'poll the real webhook summary thread');
        await service.postText('Local continuation', 'Local continuation', 'handoff:local'); service.resolveTask('handoff:local');
        assert.equal(ledger().tasks.length, 0); assert.equal(timers.size, 0);
        console.log('PASS Webex live reply: no-ID webhook tracks/persists, reload polls real summary threads, top-level and threaded yes reach conversation once, own posts excluded, local resolve stops polling');
    } finally { service?.dispose(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error('FAIL Webex live reply:', error.message); process.exitCode = 1; });
