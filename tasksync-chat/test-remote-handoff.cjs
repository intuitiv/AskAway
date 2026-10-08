const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const root = path.join(__dirname, 'build', 'remote-handoff-' + process.pid);
fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace', generalRoomId: 'general' } }));
const settings = { 'telegram.enabled': true, 'telegram.botToken': 'fixture', 'telegram.chatId': 'chat', 'webex.enabled': true, 'webex.roomId': 'workspace', 'telegram.notifyOnTurnEnd': true, 'webex.notifyOnTurnEnd': true };
const conversation = [], calls = [];
const vscode = { workspace: { name: 'Fixture', workspaceFolders: [{ name: 'Fixture', uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) }, window: {}, commands: { executeCommand: async (id, args) => conversation.push({ id, args }) } };
let items = [], updates = [], next = 0, pdf = true;
const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ channel: 'Webex', method: req.method, url: req.url, raw, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.method === 'GET' ? { items } : { id: 'webex-' + ++next }));
});
const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/services/handoffNotifier'; export * from './src/services/webexService'; export * from './src/services/webexIncomingWebhook'; export * from './src/services/telegramService'; export * from './src/services/telegramConversationReply'; export * from './src/services/webexWiring';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(id => id === 'vscode' ? vscode : id === 'child_process' ? { execFile: (file, args, options, callback) => { if (pdf) fs.writeFileSync(args[1], '%PDF-fixture\n' + fs.readFileSync(args[0])); callback(pdf ? null : new Error('converter unavailable')); } } : require(id), loaded, loaded.exports, () => ({}), () => {});
const nativeFetch = global.fetch;
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    global.fetch = async (url, options = {}) => {
        if (!String(url).includes('api.telegram.org')) return nativeFetch(url, options);
        const method = String(url).split('/').at(-1).split('?')[0];
        calls.push({ channel: 'Telegram', method, raw: options.body ? String(options.body) : '' });
        const result = method === 'getChat' ? { is_forum: true } : method === 'createForumTopic' ? { message_thread_id: 77 } : method === 'getMe' ? { id: 123 } : method === 'getUpdates' ? updates : { message_id: ++next };
        return new Response(JSON.stringify({ ok: true, result }));
    };
    const hook = new loaded.exports.WebexIncomingWebhook({ get: async () => 'https://webexapis.com/v1/webhooks/incoming/fixture' }, undefined, 'linux', base + '/incoming');
    const webex = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture-token' }) }, path.join(root, 'absent'), { baseUrl: base + '/v1' }, hook);
    const telegram = new loaded.exports.TelegramService();
    try {
        await webex.reloadConfig();
        for (const [name, service] of [['Webex', webex], ['Telegram', telegram]]) {
            if (name === 'Webex') {
                loaded.exports.publishWebex({ getWebexService: () => service, setWebexService: () => {} },
                    () => assert.fail('handoff must reach conversation, not tool callback'));
            } else service.onReply(async (task, text) => { assert.match(task, /^handoff:/); await loaded.exports.submitTelegramConversationReply(text); });
            for (const [index, kind] of ['pdf', 'md'].entries()) {
                pdf = kind === 'pdf';
                const converter = path.join(root, 'converter'); fs.writeFileSync(converter, 'fixture'); process.env.ASKAWAY_MD_TO_PDF = converter;
                const parts = { details: `Whole response ${kind}`, handoff: `Impact: ${kind} delivered.\nNext: Continue?` };
                const metrics = { latestInputTokens: 12500, turnOutputTokens: 2750, turnNanoAiu: 250000000000 };
                const notifier = new loaded.exports.HandoffNotifier([{ name, setting: name.toLowerCase() + '.notifyOnTurnEnd', get: () => service }], undefined, () => {}, () => metrics);
                notifier._readStamp = () => 1234 + index; notifier._findHandoff = () => parts;
                const before = calls.length; await notifier._onTurnEnd();
                const sent = calls.slice(before).filter(call => name === 'Webex' ? call.method === 'POST' : ['sendMessage', 'sendDocument'].includes(call.method));
                assert.equal(sent.length, 2, `${name} must send handoff then whole-response document`);
                if (name === 'Webex') {
                    assert.ok(sent[0].raw.replace(/\r\n/g, '\n').includes(loaded.exports.telegramHandoffUpdate(parts, metrics)));
                    assert.ok(sent[1].url.startsWith('/incoming/')); assert.equal(sent[1].auth, undefined);
                    assert.equal(sent[0].auth, 'Bearer fixture-token'); assert.ok(sent[0].raw.includes(`filename="response.${kind}"`));
                } else assert.ok(JSON.parse(sent[0].raw).text.includes('12.5K last in'));
                assert.ok(sent[name === 'Webex' ? 0 : 1].raw.includes(`Whole response ${kind}`));
                assert.equal(service.getActiveTaskCount(), 1);
                const answer = { id: `answer-${kind}`, text: `Continue ${kind}`, personEmail: 'reviewer', created: new Date().toISOString() };
                items = kind === 'pdf' ? [{ id: 'hook-parent', text: 'own', personEmail: 'incoming-webhooks@webex.bot' }, { ...answer, parentId: 'hook-parent' }] : [answer];
                updates = [{ update_id: index + 1, message: { message_id: 900 + index, chat: { id: 'chat' }, from: { id: 1, first_name: 'Reviewer' }, text: answer.text, message_thread_id: 77 } }];
                const count = conversation.length; await service._poll(); await service._poll();
                assert.equal(conversation.length, count + 2, 'reply reaches conversation exactly once');
                assert.equal(conversation.at(-2).args.query, answer.text);
                // A subsequent handoff answered locally must stop remote tracking.
                notifier._readStamp = () => 5678 + index; notifier._findHandoff = () => ({ ...parts, handoff: parts.handoff + ' New turn' }); await notifier._onTurnEnd();
                service.resolveTask('handoff:' + (5678 + index)); assert.equal(service.getActiveTaskCount(), 0);
            }
            console.log(`PASS ${name} remote handoff: shared banner then handoff, notifying final, full PDF/MD, once-only conversation reply and local resolve`);
        }
    } finally { webex.dispose(); telegram.dispose(); global.fetch = nativeFetch; delete process.env.ASKAWAY_MD_TO_PDF; await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error('FAIL remote handoff:', error.message); process.exitCode = 1; });
