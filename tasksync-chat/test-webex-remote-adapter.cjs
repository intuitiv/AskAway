process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
process.env.ASKAWAY_AVAILABILITY_MODE = 'away';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

function fixture() {
    const root = fs.mkdtempSync(path.join(__dirname, 'build/webex-adapter-'));
    fs.mkdirSync(path.join(root, '.askaway'));
    fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace', generalRoomId: 'general' } }));
    const settings = { 'webex.enabled': true, 'webex.roomId': 'workspace', 'telegram.enabled': true, 'telegram.botToken': 'fake-canary', 'telegram.chatId': 'chat' };
    const notices = [], calls = [], waits = [], replies = [], services = [];
    let items = [], sequence = 0, response;
    const vscode = { workspace: { name: 'Fixture', workspaceFolders: [{ name: 'Fixture', uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) }, window: { showErrorMessage: async text => notices.push(text), showInformationMessage: async () => undefined }, commands: { executeCommand: async () => {} } };
    const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexService'; export * from './src/services/telegramService'; export * from './src/services/webexSpaces'; export * from './src/services/handoffNotifier';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(id => id === 'vscode' ? vscode : id === 'child_process' ? { execFile: () => assert.fail('real credential/process boundary forbidden') } : ['http', 'https', 'net', 'node:http', 'node:https', 'node:net'].includes(id) ? { createServer: () => assert.fail('inbound listener forbidden') } : require(id), loaded, loaded.exports, () => ({}), () => {});
    const original = global.fetch;
    global.fetch = async (url, options = {}) => {
        const target = new URL(String(url));
        assert.ok(['webex.invalid', 'api.telegram.org'].includes(target.hostname), 'unexpected network destination');
        const call = { channel: target.hostname === 'webex.invalid' ? 'webex' : 'telegram', method: options.method || 'GET', url: target, body: options.body instanceof FormData ? options.body : options.body ? JSON.parse(options.body) : undefined };
        calls.push(call);
        if (response) { const result = await response(call); if (result) return result; }
        if (call.channel === 'telegram') {
            const method = target.pathname.split('/').at(-1);
            const result = method === 'getChat' ? { is_forum: false } : method === 'getMe' ? { id: 1 } : method === 'getUpdates' ? [] : { message_id: ++sequence };
            return Response.json({ ok: true, result });
        }
        return Response.json(call.method === 'GET' ? { items } : { id: 'post-' + ++sequence });
    };
    const auth = { tokens: async () => ({ accessToken: 'fake-canary', refreshToken: 'fake-refresh' }), mirror: async () => {} };
    const create = async () => {
        const service = new loaded.exports.WebexService(undefined, auth, path.join(root, 'absent'), { baseUrl: 'https://webex.invalid/v1', wait: async ms => waits.push(ms) });
        services.push(service); await service.reloadConfig(); service.onReply((task, text) => replies.push({ task, text })); return service;
    };
    return { root, settings, calls, waits, replies, notices, auth, api: loaded.exports, create, setItems: value => { items = value; }, respond: value => { response = value; }, close: () => { services.forEach(s => s.dispose()); global.fetch = original; } };
}

async function main() {
    const f = fixture();
    let count = 0;
    try {
        let service = await f.create();
        const workspace = await service.destination(f.root), general = await service.destination(f.root, true);
        await service.sendText('Workspace', 'Workspace', workspace); await service.sendText('General', 'General', general);
        assert.deepEqual(f.calls.filter(c => c.method === 'POST').map(c => c.body.roomId), ['workspace', 'general'], 'workspace/general must not cross-route');
        const spacesFile = path.join(f.root, '.askaway/webex-spaces.json');
        const teams = [{ id: 'self-team', name: 'self', rooms: [{ id: 'general', title: 'AskAway General' }] }];
        fs.writeFileSync(spacesFile, JSON.stringify({ teams }));
        assert.equal(await f.api.webexSpaces(f.auth, { fsPath: f.root, name: 'Same display name' }, { baseUrl: 'https://webex.invalid/v1' }), true);
        const creationCount = f.calls.filter(c => c.url.pathname.endsWith('/rooms')).length;
        assert.equal(await f.api.webexSpaces(f.auth, { fsPath: f.root, name: 'Same display name' }, { baseUrl: 'https://webex.invalid/v1' }), true);
        assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/rooms')).length, creationCount, 'resolved space must be reused');
        const resolved = JSON.parse(fs.readFileSync(spacesFile));
        const beforeAmbiguous = f.calls.length;
        fs.writeFileSync(spacesFile, JSON.stringify({ teams: [...teams, { ...teams[0], id: 'other-self' }] }));
        assert.equal(await f.api.webexSpaces(f.auth, { fsPath: f.root, name: 'Same display name' }), false);
        assert.equal(f.calls.length, beforeAmbiguous, 'ambiguous self must not send');
        resolved.teams[0].rooms.push({ id: 'duplicate-general', title: 'AskAway General' });
        fs.writeFileSync(spacesFile, JSON.stringify(resolved));
        assert.equal(await f.api.webexSpaces(f.auth, { fsPath: f.root, name: 'Same display name' }), false);
        assert.equal(f.calls.length, beforeAmbiguous, 'ambiguous General must not send');
        fs.writeFileSync(spacesFile, JSON.stringify({ self: { workspaceRoomId: 'workspace', generalRoomId: 'general' } }));
        count++;
        let limited = true, rejected = true;
        f.respond(call => {
            if (limited) { limited = false; return new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }); }
            if (rejected && call.body?.markdown) { rejected = false; return new Response('{}', { status: 400 }); }
        });
        assert.ok(await service.sendText('Formatted', 'Plain'));
        assert.deepEqual(f.waits, [2000], 'Retry-After must be awaited before retry');
        assert.deepEqual(f.calls.at(-1).body, { roomId: 'workspace', text: 'Plain' }, 'format rejection must retry plain text'); count++;
        const file = path.join(f.root, 'response.pdf'); fs.writeFileSync(file, '%PDF-offline');
        assert.equal(await service.sendDocument(file, 'PDF'), true);
        const form = f.calls.at(-1).body;
        assert.equal(form.get('roomId'), 'workspace'); assert.equal(await form.get('files').text(), '%PDF-offline', 'upload must retain document bytes');
        f.respond(() => new Response('{}', { status: 503 }));
        assert.equal(await service.sendDocument(file, 'PDF'), false, 'failed upload cannot claim delivery');
        assert.equal(await service.editLive('live', 'Update'), false, 'failed edit cannot claim success');
        f.respond(undefined); assert.equal(await service.editLive('live', 'Update'), true, 'caller retry must recover edit'); count++;
        let transient = true;
        f.respond(call => {
            if (call.method === 'PUT' && transient) { transient = false; return new Response('{}', { status: 503 }); }
        });
        const beforeEdit = f.calls.length;
        assert.equal(await service.editLive('live', 'Retained update'), true, 'transient edit must retry without another caller event');
        assert.equal(f.calls.length - beforeEdit, 2);
        assert.equal(f.waits.at(-1), 1000);
        f.respond(undefined);
        assert.ok(await service.sendText('x'.repeat(20000), 'x'.repeat(20000)));
        assert.ok(f.calls.at(-1).body.markdown.length <= 7000 && f.calls.at(-1).body.text.length <= 7000, 'oversized input must be bounded before delivery');
        for (const operation of [() => service.editLive('live', 'Rate limited'), () => service.sendDocument(file, 'PDF')]) {
            let rateLimit = true; const before = f.waits.length;
            f.respond(() => { if (rateLimit) { rateLimit = false; return new Response('{}', { status: 429, headers: { 'Retry-After': '3' } }); } });
            assert.equal(await operation(), true); assert.equal(f.waits[before], 3000);
        }
        f.respond(undefined); count++;
        await service.postQuestion('question', 'Choose');
        const own = f.calls.filter(c => c.method === 'POST').at(-1);
        const ledger = JSON.parse(fs.readFileSync(path.join(f.root, '.askaway/webex-messages.json')));
        f.setItems([{ id: ledger.posted.at(-1), text: 'Choose', personId: 'same-person' }, { id: 'reviewer-1', text: 'Yes', personId: 'same-person', created: '2099-01-01T00:00:00Z' }]);
        let pollLimited = true; const beforePollWait = f.waits.length;
        f.respond(call => { if (call.method === 'GET' && pollLimited) { pollLimited = false; return new Response('{}', { status: 429, headers: { 'Retry-After': '4' } }); } });
        await service._poll(); await service._poll(); assert.equal(f.waits[beforePollWait], 4000);
        f.respond(undefined);
        assert.deepEqual(f.replies, [{ task: 'question', text: 'Yes' }], 'same-person reply must be delivered exactly once, not own post');
        await service.postQuestion('next', 'Next'); service.dispose(); service = await f.create(); await service._poll();
        assert.equal(f.replies.length, 1, 'reload cannot replay processed reply or own post');
        assert.ok(own.body.roomId === 'workspace'); count++;
        const output = JSON.stringify({ notices: f.notices, ledger: JSON.parse(fs.readFileSync(path.join(f.root, '.askaway/webex-messages.json'))) });
        assert.ok(!/fake-canary|fake-refresh/.test(output), 'credentials must not enter persisted output or notices');
        f.settings['webex.enabled'] = false; await service.reloadConfig(); const before = f.calls.length;
        assert.equal(await service.sendText('Disabled', 'Disabled'), undefined); assert.equal(f.calls.length, before, 'disabled adapter must make zero requests'); count++;
        console.log(`PASS EV-WEBEX-REMOTE-ADAPTER matched=${count} routing; Retry-After/plain fallback; upload/error/edit recovery; reload IDs; secrecy/disabled`);
    } finally { f.close(); }
}
function failure(error) { console.error(error.message); console.error(String(error.stack).split('\n').slice(1, 4).join('\n')); process.exitCode = 1; }
module.exports = { fixture, failure };
if (require.main === module) main().catch(failure);
