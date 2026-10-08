const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
async function scenario(late, failure = 0) {
    const root = path.join(__dirname, 'build', `startup-enabled-${process.pid}-${late}-${failure}`);
    fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
    fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { teamId: 'self-team', generalRoomId: 'general', workspaceRoomId: null }, teams: [{ id: 'self-team', name: 'self', rooms: [{ id: 'general', title: 'General' }] }] }));
    const tokens = new Map([['askaway.webex.accessToken', 'access-canary'], ['askaway.webex.refreshToken', 'refresh-canary']]);
    const notices = [], lines = [], messages = [], commands = new Map();
    let service, resolved = !late, created = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const publish = () => { if (resolved && service) messages.push(service.getTokenStatus()); };
    const provider = { setWebexService: value => { service = value; publish(); }, getWebexService: () => service };
    const context = { secrets: { get: async key => tokens.get(key), store: async (key, value) => tokens.set(key, value) }, subscriptions: [], workspaceState: { get: (_, fallback) => fallback, update: async () => {} } };
    const vscode = { ConfigurationTarget: { Global: 1 }, workspace: {
        workspaceFolders: [{ name: 'Display name', uri: { fsPath: root } }],
        getConfiguration: () => ({ get: (key, fallback) => ['enabled', 'webex.enabled'].includes(key) ? true : fallback, inspect: () => ({ globalValue: true }), update: async () => {} }),
        onDidChangeConfiguration: () => ({ dispose() {} }) },
        commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async id => commands.get(id)?.() },
        window: { showInformationMessage: async text => { notices.push(text); if (text.includes('Configure Webex notifications')) await gate; }, showErrorMessage: async text => notices.push(text), showWarningMessage: async text => notices.push(text) } };
    const server = http.createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/people/me') res.end(JSON.stringify({ id: 'me', displayName: 'Fixture', emails: [] }));
        else if (req.url === '/v1/teams') res.end(JSON.stringify({ items: [{ id: 'self-team', name: 'self' }] }));
        else if (req.method === 'POST' && req.url === '/v1/rooms') {
            created++; assert.deepEqual(JSON.parse(raw), { title: path.basename(root), teamId: 'self-team' });
            res.statusCode = failure || 200;
            res.end(JSON.stringify(failure ? { message: 'Missing scope access-canary', trackingId: 'tracking-fixture' } : { id: 'workspace' }));
        } else res.end(JSON.stringify({ items: [{ id: 'general', title: 'General' }] }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const source = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
    const commandsBlock = source.slice(source.indexOf('        // Webex/Telegram commands'), source.indexOf('        // Initialize remote server context'));
    const deferred = source.slice(source.indexOf('                const webexModule ='), source.indexOf('            } catch (err)', source.indexOf('                const webexModule =')));
    const code = `import * as vscode from 'vscode'; import { WebexStatus } from './services/webexStatus'; import { registerWebexAuthCommands, WebexAuth } from './services/webexAuth'; export async function wire(context, provider, outputChannel) { const webviewProvider = provider; const CONFIG_NAMESPACE = 'askaway'; let telegramServiceInstance; let webexService; const logRuntime = () => {}; ${commandsBlock} ${deferred} }`;
    const build = esbuild.buildSync({ stdin: { contents: code, resolveDir: path.join(__dirname, 'src'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : name === 'child_process' ? { execFile: (...args) => args.at(-1)(new Error('Keychain unavailable')) } : require(name), loaded, loaded.exports);
    const original = global.fetch;
    global.fetch = (url, options) => original(String(url).replace('https://webexapis.com', `http://127.0.0.1:${server.address().port}`), options);
    try {
        const wiring = loaded.exports.wire(context, provider, { appendLine: line => lines.push(line) });
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!late) assert.ok(messages.some(status => status.hasToken), 'Settings must report signed in before a startup prompt completes');
        release(); await wiring;
        resolved = true; publish();
        assert.equal(created, 1, 'activation alone must POST one workspace room');
        assert.equal(messages.at(-1).hasToken, true);
        if (!failure) {
            assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.askaway/webex-spaces.json'))).self.workspaceRoomId, 'workspace');
            assert.ok(notices.some(text => text.includes(`Configure Webex notifications for ${path.basename(root)}`)));
        } else {
            assert.equal(messages.at(-1).message, `Signed in; space creation failed: ${failure}`);
            assert.ok(notices.some(text => text.includes('spark:rooms_write')));
        }
        const diagnostic = fs.readFileSync(path.join(root, '.askaway/webex-status.json'), 'utf8');
        assert.ok(diagnostic.includes('activation') && diagnostic.includes('space resolve'));
        assert.ok(!diagnostic.includes('access-canary') && !diagnostic.includes('refresh-canary'));
        assert.ok(!lines.join('\n').includes('access-canary'));
    } finally { release(); global.fetch = original; service?.dispose(); await new Promise(resolve => server.close(resolve)); }
}
(async () => { await scenario(false); await scenario(true); await scenario(false, 401); await scenario(true, 403); console.log('PASS startup enabled: activation publishes signed-in status before/after view resolution, creates one space, prompts, records secret-free diagnostics and surfaces 401/403 scope failures'); })().catch(error => { console.error('FAIL startup enabled:', error.message); process.exitCode = 1; });
