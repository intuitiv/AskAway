const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
async function main() {
    const root = path.join(__dirname, 'build', 'incoming-' + process.pid);
    fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
    fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace', generalRoomId: 'general' }, teams: [{ rooms: [{ id: 'built-in', title: 'self' }, { id: 'workspace', title: 'Fixture Space' }, { id: 'general', title: 'AskAway General' }] }] }));
    const secrets = new Map([['askaway.webex.accessToken', 'fixture-token']]);
    const notices = [], clipboard = [], opened = [], security = [], requests = [], timers = new Map(), replies = [];
    let selected = 0, input = 'https://webexapis.com/v1/webhooks/incoming/fixture-canary', action = 'Configure', enabled = true;
    const storage = { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value) };
    const state = new Map(); const memento = { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) };
    const vscode = { Uri: { parse: value => value }, workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => ({ enabled, 'webex.enabled': enabled, 'webex.roomId': 'workspace' })[key] ?? fallback }) },
        env: { clipboard: { writeText: async text => clipboard.push(text) }, openExternal: async url => { opened.push(url); return true; } },
        window: { showInformationMessage: async message => { notices.push(message); return action; }, showErrorMessage: async message => notices.push(message),
            showQuickPick: async choices => { assert.ok(choices.every(choice => /configured/.test(choice.description))); return choices[selected]; },
            showInputBox: async options => { assert.equal(options.password, true); assert.equal(options.title, selected ? 'AskAway General' : 'Fixture Space'); assert.ok(options.validateInput('http://evil.test')); return input; } } };
    let items = [], sequence = 0;
    const server = http.createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        requests.push({ url: req.url, method: req.method, body, auth: req.headers.authorization });
        res.setHeader('Content-Type', 'application/json');
        if (req.url.startsWith('/incoming/')) res.end(JSON.stringify({ id: 'webhook-' + ++sequence }));
        else if (req.method === 'GET') res.end(JSON.stringify({ items: new URL(req.url, 'http://fixture').searchParams.has('parentId') ? [] : items }));
        else res.end(JSON.stringify({ id: 'token-' + ++sequence }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexIncomingWebhook'; export * from './src/services/webexService';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports, (cb, delay) => { const id = {}; timers.set(id, cb); return id; }, id => timers.delete(id));
    const hook = new loaded.exports.WebexIncomingWebhook(storage, async (file, args) => security.push({ file, args }), 'darwin', base + '/incoming');
    let service;
    try {
        action = 'Later'; await hook.prompt(root, memento);
        assert.match(notices[0], /Fixture Space/);
        assert.ok(notices.some(message => message.includes('Configure Webex notifications for AskAway General')));
        action = 'Configure'; await hook.configure(root);
        assert.deepEqual(clipboard, ['Fixture Space']);
        assert.equal(opened[0], loaded.exports.WEBEX_WEBHOOK_APP);
        assert.equal(secrets.get('askaway.webex.incomingWebhook.workspace'), input);
        action = 'Later'; const count = notices.length; await hook.prompt(root, memento); assert.equal(notices.length, count + 1);
        selected = 1; await hook.configure(root);
        assert.deepEqual(security[0].args, ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-general-webhook-url', '-w', input]);
        input = 'https://evil.test/incoming/x'; await hook.configure(root); assert.equal(secrets.get('askaway.webex.incomingWebhook.general'), 'https://webexapis.com/v1/webhooks/incoming/fixture-canary');
        service = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture-token' }) }, path.join(root, 'absent'), { baseUrl: base + '/v1' }, hook);
        await service.reloadConfig(); service.onReply((task, text) => replies.push({ task, text }));
        assert.ok(await service.sendText('Heads-up', 'Heads-up'));
        assert.equal(await service.finishLive('live', 'Final', 'Handoff', 'handoff'), true);
        assert.equal(await service.postText('Turn handoff', 'Turn handoff'), true);
        fs.writeFileSync(path.join(root, 'document.md'), 'Full response');
        assert.equal(await service.sendDocument(path.join(root, 'document.md'), 'Document'), true);
        assert.ok(requests.some(req => req.url.startsWith('/incoming/') && JSON.parse(req.body).markdown.includes('Final')));
        assert.ok(requests.some(req => req.url.startsWith('/incoming/') && JSON.parse(req.body).markdown.includes('Turn handoff')), 'turn-end handoff must notify through the incoming webhook');
        assert.ok(requests.some(req => req.url === '/v1/messages' && req.auth === 'Bearer fixture-token' && req.body.includes('Full response')));
        assert.ok(requests.filter(req => req.url.startsWith('/incoming/')).every(req => !req.auth && Object.keys(JSON.parse(req.body)).join() === 'markdown'));
        items = [{ id: 'sender-post', personEmail: 'incoming-webhooks@webex.bot', text: 'Not a reply', created: new Date().toISOString() }];
        let [id, cb] = timers.entries().next().value; timers.delete(id); await cb(); assert.deepEqual(replies, []);
        items.push({ id: 'thread-answer', parentId: 'sender-post', personEmail: 'reviewer@example.test', text: 'Answer', created: new Date().toISOString() });
        [id, cb] = timers.entries().next().value; timers.delete(id); await cb(); assert.deepEqual(replies, [{ task: 'handoff', text: 'Answer' }]);
        secrets.delete('askaway.webex.incomingWebhook.workspace');
        assert.ok(await service.sendText('Fallback', 'Fallback'));
        assert.ok(requests.some(req => req.url === '/v1/messages' && req.body.includes('Fallback')));
        action = "Don't ask in this workspace"; await hook.prompt(root, memento); const dismissed = notices.length; await hook.prompt(root, memento); assert.equal(notices.length, dismissed);
        enabled = false; await service.reloadConfig(); const before = requests.length; assert.equal(await service.sendText('Disabled', 'Disabled'), undefined); assert.equal(requests.length, before);
        assert.ok(!notices.join().includes('fixture-canary'));
        assert.ok(require('./package.json').contributes.commands.some(command => command.command === 'askaway.configureWebexNotifications'));
    } finally { service?.dispose(); await new Promise(resolve => server.close(resolve)); }
    console.log('PASS Webex webhook setup: named startup prompt, clipboard/apphub, masked validation, SecretStorage and General Keychain');
    console.log('PASS Webex webhook routing: notifying text via incoming, token files/fallback, sender excluded and threaded handoff reply');
}
main().catch(error => { console.error('FAIL Webex incoming acceptance:', error.message); process.exitCode = 1; });
