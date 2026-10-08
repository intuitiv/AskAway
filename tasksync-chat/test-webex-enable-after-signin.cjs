const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
async function main() {
    const root = path.join(__dirname, 'build', 'enable-after-signin-' + process.pid);
    fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
    fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { teamId: 'self-team', generalRoomId: 'general', workspaceRoomId: null }, teams: [{ id: 'self-team', name: 'self', rooms: [{ id: 'general', title: 'General' }] }] }));
    let enabled = false, created = 0, current, displayed;
    const tokens = new Map(), listeners = [], commands = new Map(), notices = [], rooms = [{ id: 'general', title: 'General' }];
    const context = { secrets: { get: async key => tokens.get(key), store: async (key, value) => tokens.set(key, value) }, subscriptions: [], workspaceState: { get: (key, fallback) => fallback, update: async () => {} } };
    const provider = { setWebexService: service => { current = service; displayed = service.getTokenStatus(); }, getWebexService: () => current };
    // The Settings listener runs before the extension's deferred service listener, as in VS Code.
    listeners.push(() => { displayed = current?.getTokenStatus(); });
    const vscode = { ConfigurationTarget: { Global: 1 }, workspace: { workspaceFolders: [{ name: 'Display name', uri: { fsPath: root } }],
        getConfiguration: namespace => ({ get: (key, fallback) => key === 'enabled' || key === 'webex.enabled' ? enabled : fallback,
            update: async (key, value) => { enabled = value; } }),
        onDidChangeConfiguration: listener => { listeners.push(listener); return { dispose() {} }; } },
        commands: { registerCommand: (id, handler) => { commands.set(id, handler); return { dispose() {} }; }, executeCommand: async id => commands.get(id)?.() },
        window: { showInformationMessage: async text => notices.push(text), showErrorMessage: async text => notices.push(text), showWarningMessage: async text => notices.push(text) } };
    const server = http.createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/people/me') res.end(JSON.stringify({ id: 'me', displayName: 'Fixture', emails: [] }));
        else if (req.url === '/v1/teams') res.end(JSON.stringify({ items: [{ id: 'self-team', name: 'self' }] }));
        else if (req.method === 'POST' && req.url === '/v1/rooms') {
            const body = JSON.parse(raw); assert.equal(body.teamId, 'self-team'); assert.equal(body.title, path.basename(root));
            created++; rooms.push({ id: 'workspace', title: body.title }); res.end(JSON.stringify(rooms.at(-1)));
        } else if (req.url.startsWith('/v1/rooms')) res.end(JSON.stringify({ items: rooms }));
        else res.end('{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const source = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
    const commandsBlock = source.slice(source.indexOf('        // Webex/Telegram commands'), source.indexOf('        // Initialize remote server context'));
    const deferred = source.slice(source.indexOf('                const webexModule ='), source.indexOf('            } catch (err)', source.indexOf('                const webexModule =')));
    const code = `import * as vscode from 'vscode'; import { registerWebexAuthCommands, WebexAuth } from './services/webexAuth';
        export async function wire(context, provider) { const webviewProvider = provider; const outputChannel = undefined; const CONFIG_NAMESPACE = 'askaway'; let telegramServiceInstance; let webexService; const logRuntime = () => {}; ${commandsBlock} ${deferred} }`;
    const build = esbuild.buildSync({ stdin: { contents: code, resolveDir: path.join(__dirname, 'src'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports);
    const originalFetch = global.fetch;
    global.fetch = (url, options) => originalFetch(String(url).replace('https://webexapis.com', `http://127.0.0.1:${server.address().port}`), options);
    try {
        await loaded.exports.wire(context, provider);
        tokens.set('askaway.webex.accessToken', 'fixture-access'); tokens.set('askaway.webex.refreshToken', 'fixture-refresh');
        enabled = true;
        for (const listener of listeners) await listener({ affectsConfiguration: name => name.startsWith('askaway') });
        assert.equal(displayed.hasToken, true, 'Settings must publish signed-in status after async reload');
        assert.equal(displayed.hasRoomId, true, 'resolved workspace room must configure delivery');
        assert.equal(created, 1);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.askaway/webex-spaces.json'))).self.workspaceRoomId, 'workspace');
        await commands.get('askaway.webexDiscover')();
        assert.equal(created, 1, 'discovery must not duplicate workspace rooms');
        assert.equal(current.getTokenStatus().hasToken, true);
        assert.ok(!notices.some(text => text.includes('not signed in')));
        console.log('PASS enable after sign-in: actual extension wiring reloads shared credentials, publishes signed-in status and creates one self workspace space');
    } finally { global.fetch = originalFetch; current?.dispose(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error('FAIL enable after sign-in:', error.message); process.exitCode = 1; });
