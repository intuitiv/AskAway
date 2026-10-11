process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
process.env.ASKAWAY_AVAILABILITY_MODE = 'away';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');

async function main() {
    const root = path.join(__dirname, 'build', 'webex-ask-user-' + process.pid);
    fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
    fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace' } }));
    const calls = [], messages = [], answers = [];
    let seq = 0;
    const server = http.createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const url = new URL(req.url, 'http://fixture');
        calls.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
            const parent = url.searchParams.get('parentId');
            res.end(JSON.stringify({ items: messages.filter(m => parent ? m.parentId === parent : !m.parentId) }));
        } else {
            const message = { ...JSON.parse(raw), id: 'post-' + ++seq, personId: 'owner', created: new Date().toISOString() };
            if (req.method === 'POST') messages.push(message);
            res.end(JSON.stringify(message));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => key === 'webex.enabled' ? true : fallback }) } };
    const build = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexService'; export * from './src/services/remoteChannel';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports, () => ({}), () => {});
    const service = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture' }) }, path.join(root, 'absent'), { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, wait: async () => {} });
    const telegram = { isConfigured: () => true, postQuestion: async () => assert.fail('configured Webex must not duplicate to Telegram') };
    try {
        await service.reloadConfig();
        service.onReply((id, text) => answers.push({ id, text }));
        await service.beginTurn('Fixture', 'Build', 'Working');
        const turnRoot = messages[0].id;
        await loaded.exports.postRemoteQuestion(service, telegram, 'ask-1', 'Which API?', ['A', 'B']);
        const posted = calls.findLast(call => call.method === 'POST');
        assert.equal(posted.body.parentId, turnRoot); assert.equal(posted.body.text, 'Which API?\nA\nB');
        assert.equal(service.getActiveTaskCount(), 1);
        messages.push({ id: 'unrelated', text: 'Wrong room conversation', created: new Date(Date.now() + 1).toISOString() });
        await service._poll(); assert.equal(answers.length, 0);
        messages.push({ id: 'reply-1', parentId: turnRoot, text: 'Use A', personId: 'owner', personEmail: 'reviewer@example.test', created: new Date(Date.now() + 2).toISOString() });
        await service._poll(); await service._poll();
        assert.equal(JSON.stringify(answers), JSON.stringify([{ id: 'ask-1', text: 'Use A' }]));
        assert.equal(service.getActiveTaskCount(), 0);
        console.log('PASS EV-WEBEX-ASK-USER Away posts question in current turn thread; thread reply resolves matching ask exactly once; unrelated reply ignored');
        for (const mode of ['here', 'offline']) {
            process.env.ASKAWAY_AVAILABILITY_MODE = mode;
            const before = calls.length;
            await loaded.exports.postRemoteQuestion(service, telegram, 'ask-' + mode, 'Should not post');
            assert.equal(calls.length, before); assert.equal(service.getActiveTaskCount(), 0);
        }
        console.log('PASS EV-WEBEX-ASK-USER Here/Offline post nothing');
        process.env.ASKAWAY_AVAILABILITY_MODE = 'awayValidator';
        await loaded.exports.postRemoteQuestion(service, telegram, 'ask-local', 'Local answer?');
        service.resolveTask('ask-local');
        messages.push({ id: 'reply-local', parentId: turnRoot, text: 'Late', created: new Date(Date.now() + 3).toISOString() });
        await service._poll(); assert.equal(answers.length, 1);
        const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
        assert.ok(provider.includes('postRemoteQuestion(this._webexService, this._telegramService, toolCallId, question'));
        assert.ok(provider.includes('taskId !== this._currentToolCallId'));
        console.log('PASS EV-WEBEX-ASK-USER local resolution cancels polling; production provider uses shared question contract and exact task identity');
    } finally { service.dispose(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
