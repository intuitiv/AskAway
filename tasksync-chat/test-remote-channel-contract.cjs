const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const root = path.join(__dirname, 'build/remote-contract-' + process.pid);
fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace', generalRoomId: 'general' } }));
fs.writeFileSync(path.join(root, 'response.pdf'), '%PDF-fixture');
fs.writeFileSync(path.join(root, 'response.md'), '# response');
const values = { 'telegram.enabled': true, 'telegram.botToken': 'fixture', 'telegram.chatId': 'chat', 'webex.enabled': true, 'webex.roomId': 'workspace' };
const vscode = { workspace: { name: 'Fixture', workspaceFolders: [{ name: 'Fixture', uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) }, window: {}, commands: { executeCommand: async () => {} } };
const build = esbuild.buildSync({ stdin: { contents: "export {TelegramService} from './src/services/telegramService'; export {WebexService} from './src/services/webexService';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', build.outputFiles[0].text)(id => id === 'vscode' ? vscode : require(id), loaded, loaded.exports);
const nativeFetch = global.fetch;
const calls = [];
let next = 0, updates = [], webexReplies = [], limited = true, rejectFormat = true;
const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        calls.push({ channel: 'webex', method: req.method, url: req.url, raw });
        res.setHeader('Content-Type', 'application/json');
        if (req.url.includes('people/me')) { res.end('{"id":"same-person"}'); return; }
        if (req.method === 'GET') { res.end(JSON.stringify({ items: webexReplies })); return; }
        if (limited) { limited = false; res.writeHead(429, { 'Retry-After': '0.01' }); res.end('{}'); return; }
        if (rejectFormat && raw.includes('markdown')) { rejectFormat = false; res.writeHead(400); res.end('{}'); return; }
        res.end(JSON.stringify({ id: 'w' + ++next }));
    });
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/v1`;
    global.fetch = async (url, options = {}) => {
        url = String(url);
        if (url.includes('webexapis.com')) return nativeFetch(url.replace('https://webexapis.com/v1', base), options);
        if (!url.includes('api.telegram.org')) return nativeFetch(url, options);
        const method = url.split('/').at(-1).split('?')[0];
        const raw = options.body ? String(options.body) : '';
        calls.push({ channel: 'telegram', method, raw });
        let result = { message_id: ++next };
        if (method === 'getChat') result = { is_forum: true };
        if (method === 'createForumTopic') result = { message_thread_id: 77 };
        if (method === 'getMe') result = { id: 123 };
        if (method === 'getUpdates') result = updates;
        return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    };
    const waits = [];
    const auth = { tokens: async () => ({ accessToken: 'fixture' }) };
    for (const [name, service] of [
        ['telegram', new loaded.exports.TelegramService()],
        ['webex', new loaded.exports.WebexService(undefined, auth, path.join(root, 'absent'), { baseUrl: base, wait: async ms => { waits.push(ms); } })]
    ]) {
        const replies = [];
        try {
            if (name === 'webex') await service.reloadConfig();
            assert.equal(service.isConfigured(), true);
            const destination = await service.destination(root);
            const general = await service.destination(root, true);
            assert.ok(destination); assert.equal(general.general, true); assert.notEqual(destination.id, general.id);
            const live = await service.sendText('Live formatted', 'Live plain', destination); assert.ok(live);
            assert.equal(await service.editLive(live, 'Updated live'), true);
            assert.equal(await service.finishLive(live, 'Banner', 'Final', 'telegram-handoff:contract'), true);
            assert.equal(await service.sendDocument(path.join(root, 'response.pdf'), 'PDF'), true);
            assert.equal(await service.sendDocument(path.join(root, 'response.md'), 'MD'), true);
            service.onReply((taskId, text) => replies.push({ taskId, text }));
            await service.postQuestion('question', 'Choose', ['Yes']);
            const sends = calls.filter(c => c.channel === name);
            if (name === 'webex') {
                const own = sends.filter(c => c.method === 'POST').at(-1);
                assert.ok(own.raw.includes('Choose'));
                webexReplies = [{ id: 'w' + next, text: 'own', personId: 'same-person' }, { id: 'reviewer', text: 'Yes', personId: 'same-person', personEmail: 'reviewer' }];
            } else {
                const question = sends.filter(c => c.method === 'sendMessage').at(-1);
                assert.ok(question.raw.includes('Choose'));
                updates = [{ update_id: 1, message: { message_id: 999, chat: { id: 'chat' }, from: { id: 1, first_name: 'Reviewer' }, text: 'Yes', message_thread_id: 77 } }];
            }
            await service._poll();
            assert.equal(replies.length, 1); assert.equal(replies[0].text, 'Yes'); assert.equal(replies[0].taskId, 'question');
            service.resolveTask('question'); await service._poll(); assert.equal(replies.length, 1);
            const before = calls.length;
            service._enabled = false;
            assert.equal(await service.sendText('disabled', 'disabled'), undefined);
            assert.equal(await service.editLive(live, 'disabled'), false);
            assert.equal(await service.sendDocument(path.join(root, 'response.pdf'), 'disabled'), false);
            await service.postQuestion('disabled', 'disabled'); assert.equal(calls.length, before);
            console.log(`PASS ${name} RemoteChannel: destinations, text/edit/new final, PDF/MD, question/reply/resolve, disabled gating`);
        } finally { service.dispose(); }
    }
    assert.deepEqual(waits, [10]);
    assert.ok(calls.some(c => c.channel === 'webex' && c.method === 'DELETE'));
    assert.ok(calls.some(c => c.channel === 'webex' && c.raw.includes('name="files"') && c.raw.includes('%PDF-fixture')));
    assert.ok(calls.some(c => c.channel === 'webex' && c.method === 'POST' && c.raw.includes('Live plain') && !c.raw.includes('markdown')));
    console.log('PASS Webex REST multipart, format fallback, Retry-After and same-person own-post exclusion');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { global.fetch = nativeFetch; await new Promise(resolve => server.close(resolve)); });
