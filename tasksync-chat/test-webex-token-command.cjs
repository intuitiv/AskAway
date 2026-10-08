const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
    const logs = [], inputs = [], prompts = [], calls = [], requests = [];
    const values = { 'webex.enabled': true, 'webex.roomId': 'room', 'webex.accessToken': 'settings-canary' };
    const secrets = new Map();
    const storage = { get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); } };
    const vscode = {
        window: { showInputBox: async options => { prompts.push(options); return inputs.shift(); }, showErrorMessage: async message => logs.push(message) },
        workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) }
    };
    const build = await esbuild.build({
        stdin: { contents: "export * from './src/services/webexAuth'; export * from './src/services/webexService';", resolveDir: __dirname, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode']
    });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports);
    const { WebexAuth, setWebexToken, WebexService, readWebexCredentials } = loaded.exports;
    const originalConsole = { log: console.log, warn: console.warn, error: console.error };
    const originalFetch = global.fetch;
    for (const method of Object.keys(originalConsole)) { console[method] = (...args) => logs.push(args.join(' ')); }
    let refreshMode = 'success';
    global.fetch = async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/access_token')) {
            if (refreshMode === 'throw') { throw new Error('access-canary refresh-canary client-secret-canary'); }
            if (refreshMode === 'failure') { return { ok: false, status: 400, text: async () => 'access-canary refresh-canary client-secret-canary' }; }
            return { ok: true, json: async () => ({ access_token: 'rotated-access-canary', refresh_token: 'rotated-refresh-canary', expires_in: 3600 }) };
        }
        return { ok: true };
    };
    try {
        const auth = new WebexAuth(storage, async (file, args) => calls.push({ file, args }), 'darwin');
        inputs.push('access-canary', 'refresh-canary');
        assert.equal(await setWebexToken(auth), true);
        assert.equal(secrets.get('askaway.webex.accessToken'), 'access-canary');
        assert.equal(secrets.get('askaway.webex.refreshToken'), 'refresh-canary');
        assert.deepEqual(calls[0], { file: 'security', args: ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-access-token', '-w', 'access-canary'] });
        assert.ok(prompts.every(prompt => prompt.password === true));
        inputs.push(undefined);
        assert.equal(await setWebexToken(auth), false);
        assert.equal(calls.length, 1);
        for (const skip of [undefined, '']) {
            inputs.push('access-canary', skip);
            assert.equal(await setWebexToken(auth), true);
            assert.equal(secrets.get('askaway.webex.refreshToken'), 'refresh-canary');
        }
        const before = calls.length;
        await new WebexAuth(storage, async () => { throw new Error('must not run'); }, 'linux').store('access-canary');
        assert.equal(calls.length, before);
        inputs.push('access-canary', 'refresh-canary');
        assert.equal(await setWebexToken(new WebexAuth(storage, async () => { throw new Error('access-canary refresh-canary'); }, 'darwin')), false);

        const fixtureDir = path.join(__dirname, 'build');
        assert.ok(fs.statSync(__dirname).isDirectory());
        fs.mkdirSync(fixtureDir, { recursive: true });
        const fixture = path.join(fixtureDir, 'webex-token-command-fixture.md');
        fs.writeFileSync(fixture, 'Other line\nClient ID: client-id-canary\nClient secret: client-secret-canary\n');
        assert.deepEqual(readWebexCredentials(fixture), { clientId: 'client-id-canary', clientSecret: 'client-secret-canary' });
        const tokenFile = path.join(fixtureDir, 'webex-token-command-fixture.json');
        fs.writeFileSync(tokenFile, JSON.stringify({ access_token: 'file-canary' }));
        values['webex.tokenFilePath'] = tokenFile;
        const service = new WebexService({ appendLine: message => logs.push(message) }, auth, fixture);
        assert.equal(await service.postText('hello', 'hello'), true);
        assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer access-canary');
        secrets.delete('askaway.webex.accessToken');
        delete values['webex.tokenFilePath'];
        delete values['webex.accessToken'];
        await service.reloadConfig();
        const refresh = requests.find(request => request.url.endsWith('/access_token'));
        const body = new URLSearchParams(refresh.options.body);
        assert.equal(body.get('client_id'), 'client-id-canary');
        assert.equal(body.get('client_secret'), 'client-secret-canary');
        assert.equal(body.get('refresh_token'), 'refresh-canary');
        assert.equal(secrets.get('askaway.webex.accessToken'), 'rotated-access-canary');
        assert.equal(secrets.get('askaway.webex.refreshToken'), 'rotated-refresh-canary');
        assert.deepEqual(calls.at(-1), { file: 'security', args: ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-access-token', '-w', 'rotated-access-canary'] });
        assert.equal(await service.postText('hello', 'hello'), true);
        assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer rotated-access-canary');
        for (const mode of ['failure', 'throw']) {
            secrets.delete('askaway.webex.accessToken');
            refreshMode = mode;
            await service.reloadConfig();
        }
        service.dispose();
        for (const secret of ['access-canary', 'refresh-canary', 'settings-canary', 'file-canary', 'client-id-canary', 'client-secret-canary']) {
            assert.ok(!logs.join('\n').includes(secret), 'credentials must not appear in captured logs/errors');
        }
        const manifest = require('./package.json');
        assert.ok(manifest.contributes.commands.some(command => command.command === 'askaway.setWebexToken' && command.title === 'AskAway: Set Webex Token'));
        assert.match(fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8'), /registerCommand\('askaway\.setWebexToken'/);
    } finally {
        Object.assign(console, originalConsole);
        global.fetch = originalFetch;
    }
    console.log('PASS Webex token command: SecretStorage keys, exact Keychain args, optional refresh, non-macOS skip, safe failures');
    console.log('PASS WebexService: SecretStorage precedence, OAuth fixture parsing, refresh writes both stores, credentials never printed');
}
main().catch(() => { console.error('FAIL Webex token command acceptance'); process.exitCode = 1; });
