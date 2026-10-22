process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
process.env.ASKAWAY_AVAILABILITY_MODE = 'away';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), esbuild = require('esbuild');
const root = path.join(__dirname, 'build', 'reply-after-idle-' + process.pid);
fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace' } }));
const messages = [], conversation = [];
let seq = 0;
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => ({ 'webex.enabled': true, 'webex.notifyOnTurnEnd': true })[key] ?? fallback }) }, commands: { executeCommand: async (id, args) => conversation.push({ id, args }) } };
const build = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexService'; export * from './src/services/telegramConversationReply';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', build.outputFiles[0].text)(id => id === 'vscode' ? vscode : require(id), loaded, loaded.exports, setTimeout, clearTimeout, setInterval, clearInterval);
const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://fixture');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { const parent = url.searchParams.get('parentId'); res.end(JSON.stringify({ items: messages.filter(m => parent ? m.parentId === parent : !m.parentId) })); return; }
    const message = { ...JSON.parse(raw || '{}'), id: 'token-' + ++seq, personId: 'owner', created: new Date().toISOString() };
    if (req.method === 'POST') messages.push(message);
    res.end(JSON.stringify(message));
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
    const service = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture' }) }, path.join(root, 'absent'), { baseUrl: base + '/v1', wait: async () => {} });
    await service.reloadConfig();
    service.onReply(async (task, text) => loaded.exports.submitTelegramConversationReply(text));
    try {
        // The reviewer edited a file while the turn ran, so the idle timer has a start time; he answers long after the turn ended.
        service.notifyCopilotActivity();
        assert.equal(await service.postText('Finished. Next: continue?', 'Finished', 'handoff:idle'), true);
        const handoff = messages.at(-1).id;
        service._lastCopilotActivity = Date.now() - 60 * 60 * 1000;
        messages.push({ id: 'answer-1', text: 'continue please', parentId: handoff, personId: 'reviewer', created: new Date(Date.now() + 1000).toISOString() });
        const before = conversation.length; await service._poll();
        assert.equal(conversation.length, before + 2, 'a reply to the handoff one hour after the last activity still reaches the conversation');
        assert.equal(conversation.at(-2).args.query, 'continue please');
        console.log('PASS EV-WEBEX-REPLY-AFTER-IDLE a handoff reply is delivered after the turn has been idle for an hour');
    } finally { service.dispose(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error('FAIL EV-WEBEX-REPLY-AFTER-IDLE:', error.message); process.exitCode = 1; });
