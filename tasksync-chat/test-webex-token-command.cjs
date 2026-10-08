const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
    const logs = [], inputs = [], prompts = [], calls = [], requests = [], browsers = [], commands = new Map();
    let browserMode = true;
    const values = { 'webex.enabled': true, 'webex.roomId': 'room', 'webex.accessToken': 'settings-canary' };
    const secrets = new Map();
    const storage = { get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); } };
    const vscode = {
        window: { showInputBox: async options => { prompts.push(options); const input = inputs.shift(); return typeof input === 'function' ? input() : input; }, showErrorMessage: async message => logs.push(message) },
        env: { openExternal: async uri => { browsers.push(new URL(uri)); if (browserMode === 'throw') { throw new Error('client-secret-canary'); } return browserMode; } },
        Uri: { parse: value => value },
        commands: { registerCommand: (id, callback) => { commands.set(id, callback); return { dispose() {} }; } },
        workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback, update: () => { throw new Error('No configuration writes allowed'); } }) }
    };
    const build = await esbuild.build({
        stdin: { contents: "export * from './src/services/webexAuth'; export * from './src/services/webexService';", resolveDir: __dirname, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode']
    });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports);
    const { WebexAuth, setWebexToken, registerWebexAuthCommands, WebexService, readWebexCredentials } = loaded.exports;
    const originalConsole = { log: console.log, warn: console.warn, error: console.error };
    const originalFetch = global.fetch;
    for (const method of Object.keys(originalConsole)) { console[method] = (...args) => logs.push(args.join(' ')); }
    let refreshMode = 'success';
    let exchange = { access_token: 'access-canary', refresh_token: 'refresh-canary' }, message401 = false;
    let deferredRefresh;
    global.fetch = async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/access_token')) {
            if (refreshMode === 'throw') { throw new Error('access-canary refresh-canary client-secret-canary'); }
            if (refreshMode === 'failure') { return { ok: false, status: 400, text: async () => 'access-canary refresh-canary client-secret-canary' }; }
            if (new URLSearchParams(options.body).get('grant_type') === 'authorization_code') { return { ok: true, json: async () => exchange }; }
            if (deferredRefresh) { return deferredRefresh(); }
            return { ok: true, json: async () => ({ access_token: 'rotated-access-canary', ...(refreshMode === 'omit' ? {} : { refresh_token: 'rotated-refresh-canary' }), expires_in: 3600 }) };
        }
        if (message401) { message401 = false; return { ok: false, status: 401 }; }
        return { ok: true, json: async () => ({ id: 'message-id' }) };
    };
    try {
        const auth = new WebexAuth(storage, async (file, args) => calls.push({ file, args }), 'darwin');
        const fixtureDir = path.join(__dirname, 'build');
        fs.mkdirSync(fixtureDir, { recursive: true });
        const fixture = path.join(fixtureDir, 'webex-token-command-fixture.md');
        const credentialsFixture = 'Other line\nClient ID: client-id-canary\nClient secret: client-secret-canary\n';
        const registeredScopes = 'spark:messages_read spark:messages_write spark:kms';
        fs.writeFileSync(fixture, credentialsFixture + 'Scopes: spark:messages_read, spark:messages_write spark:kms\n');
        const callback = () => 'http://localhost:5000/callback?code=code-canary&state=' + browsers.at(-1).searchParams.get('state');
        let reloads = 0;
        registerWebexAuthCommands({ secrets: storage, subscriptions: [] }, async () => { reloads++; }, auth, fixture);
        inputs.push(callback);
        await commands.get('askaway.setWebexToken')();
        assert.equal(reloads, 1);
        assert.equal(browsers[0].origin, 'https://webexapis.com');
        assert.equal(browsers[0].searchParams.get('redirect_uri'), 'http://localhost:5000/callback');
        assert.equal(browsers[0].searchParams.get('scope'), registeredScopes);
        assert.ok(!browsers[0].searchParams.get('scope').includes('spark:all'));
        assert.match(browsers[0].searchParams.get('state'), /^[a-f0-9]{64}$/);
        const form = new URLSearchParams(requests[0].options.body);
        assert.equal(form.get('redirect_uri'), 'http://localhost:5000/callback');
        assert.equal(form.get('client_secret'), 'client-secret-canary');
        assert.equal(form.get('code'), 'code-canary');
        assert.equal(requests[0].url, 'https://webexapis.com/v1/access_token');
        assert.equal(requests[0].options.method, 'POST');
        assert.equal(secrets.get('askaway.webex.accessToken'), 'access-canary');
        assert.equal(secrets.get('askaway.webex.refreshToken'), 'refresh-canary');
        assert.deepEqual(calls[0], { file: 'security', args: ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-access-token', '-w', 'access-canary'] });
        assert.ok(prompts.every(prompt => prompt.password === true));
        const invalid = [undefined, '', () => callback().replace('localhost:5000', 'localhost:54321'), () => callback().replace('/callback?', '/other?'),
            () => callback().replace('state=', 'state=wrong'), () => callback() + '&code=other', () => callback() + '&state=other',
            () => callback() + '&error=access_denied', () => callback() + '#fragment', () => callback().replace('code-canary', ''), () => callback().replace('code-canary', '%0A')];
        for (const input of invalid) {
            const before = requests.length, snapshot = [...secrets];
            inputs.push(input);
            assert.equal(await setWebexToken(auth, fixture), false);
            assert.equal(requests.length, before);
            assert.deepEqual([...secrets], snapshot);
        }
        for (const mode of [false, 'throw']) {
            browserMode = mode;
            const before = requests.length, promptCount = prompts.length;
            assert.equal(await setWebexToken(auth, fixture), false);
            assert.equal(requests.length, before); assert.equal(prompts.length, promptCount);
        }
        browserMode = true;
        for (const data of [{}, { access_token: 'valid', refresh_token: '' }, { access_token: 1, refresh_token: 'valid' }, { access_token: 'invalid token', refresh_token: 'valid' }]) {
            exchange = data; inputs.push(callback);
            const snapshot = [...secrets];
            assert.equal(await setWebexToken(auth, fixture), false); assert.deepEqual([...secrets], snapshot);
        }
        for (const mode of ['failure', 'throw']) {
            refreshMode = mode; inputs.push(callback);
            const snapshot = [...secrets];
            assert.equal(await setWebexToken(auth, fixture), false); assert.deepEqual([...secrets], snapshot);
        }
        refreshMode = 'success'; exchange = { access_token: 'access-canary', refresh_token: 'refresh-canary' };
        inputs.push(callback); await commands.get('askaway.authorizeWebex')();
        assert.equal(reloads, 2);
        const scopeSnapshot = [...secrets], scopeRequests = requests.length;
        inputs.push(() => 'http://localhost:5000/callback?error=invalid_scope&error_description=client-secret-canary&state=' + browsers.at(-1).searchParams.get('state'));
        assert.equal(await setWebexToken(auth, fixture), false);
        assert.equal(requests.length, scopeRequests);
        assert.deepEqual([...secrets], scopeSnapshot);
        assert.ok(logs.at(-1).includes('Copy the exact registered scope names'));
        for (const metadata of ['', 'Scopes: https://invalid.example/secret\n']) {
            fs.writeFileSync(fixture, credentialsFixture + metadata);
            const noBrowser = browsers.length, noRequests = requests.length;
            inputs.push(undefined);
            assert.equal(await setWebexToken(auth, fixture), false);
            assert.equal(browsers.length, noBrowser); assert.equal(requests.length, noRequests);
            inputs.push('spark:messages_read&scope=spark:all');
            assert.equal(await setWebexToken(auth, fixture), false);
            assert.equal(browsers.length, noBrowser); assert.equal(requests.length, noRequests);
            inputs.push('spark:rooms_read, spark:teams_read spark:kms', callback);
            assert.equal(await setWebexToken(auth, fixture), true);
            assert.equal(browsers.at(-1).searchParams.get('scope'), 'spark:rooms_read spark:teams_read spark:kms');
            assert.deepEqual([...secrets], scopeSnapshot);
        }
        fs.writeFileSync(fixture, credentialsFixture + 'Scopes: ' + registeredScopes + '\n');
        assert.equal(new Set(browsers.map(url => url.searchParams.get('state'))).size, browsers.length);
        const before = calls.length;
        await new WebexAuth(storage, async () => { throw new Error('must not run'); }, 'linux').store('access-canary');
        assert.equal(calls.length, before);
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
        const refresh = requests.find(request => request.url.endsWith('/access_token') && new URLSearchParams(request.options.body).get('grant_type') === 'refresh_token');
        const body = new URLSearchParams(refresh.options.body);
        assert.equal(body.get('client_id'), 'client-id-canary');
        assert.equal(body.get('client_secret'), 'client-secret-canary');
        assert.equal(body.get('refresh_token'), 'refresh-canary');
        assert.equal(secrets.get('askaway.webex.accessToken'), 'rotated-access-canary');
        assert.equal(secrets.get('askaway.webex.refreshToken'), 'rotated-refresh-canary');
        assert.deepEqual(calls.at(-1), { file: 'security', args: ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-access-token', '-w', 'rotated-access-canary'] });
        assert.equal(await service.postText('hello', 'hello'), true);
        assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer rotated-access-canary');
        await service.reloadConfig();
        message401 = true; refreshMode = 'omit';
        assert.equal(await service.sendText('hello', 'hello'), 'message-id');
        assert.equal(secrets.get('askaway.webex.refreshToken'), 'rotated-refresh-canary');
        refreshMode = 'success';
        const count = requests.filter(request => request.url.endsWith('/access_token')).length;
        await Promise.all([service.refreshAccessToken(), service.refreshAccessToken()]);
        assert.equal(requests.filter(request => request.url.endsWith('/access_token')).length, count + 1);
        let releaseUnchanged, signalUnchanged;
        const unchangedResponse = new Promise(resolve => { releaseUnchanged = resolve; });
        const unchangedStarted = new Promise(resolve => { signalUnchanged = resolve; });
        deferredRefresh = () => { signalUnchanged(); return unchangedResponse; };
        const unchangedRefresh = service.refreshAccessToken();
        await unchangedStarted;
        await service.reloadConfig();
        const unchangedMirrors = calls.length;
        releaseUnchanged({ ok: true, json: async () => ({ access_token: 'reload-rotated-access-canary', refresh_token: 'reload-rotated-refresh-canary' }) });
        await unchangedRefresh;
        assert.ok(secrets.get('askaway.webex.accessToken') === 'reload-rotated-access-canary' && secrets.get('askaway.webex.refreshToken') === 'reload-rotated-refresh-canary', 'unchanged reload must preserve valid rotation');
        assert.equal(calls.length, unchangedMirrors + 1);
        assert.ok(calls.at(-1).args.at(-1) === 'reload-rotated-access-canary');
        assert.equal(await service.postText('hello', 'hello'), true);
        assert.ok(requests.at(-1).options.headers.Authorization === 'Bearer reload-rotated-access-canary', 'unchanged reload must reconcile rotated service memory');
        let release, started;
        const pendingResponse = new Promise(resolve => { release = resolve; });
        const startedRequest = new Promise(resolve => { started = resolve; });
        deferredRefresh = () => { started(); return pendingResponse; };
        const oldRefresh = service.refreshAccessToken();
        await startedRequest;
        const browserAuth = new WebexAuth(storage, async (file, args) => calls.push({ file, args }), 'darwin');
        await browserAuth.store('fresh-access-canary', 'fresh-refresh-canary');
        await service.reloadConfig();
        const mirrorCount = calls.length;
        release({ ok: true, json: async () => ({ access_token: 'stale-access-canary', refresh_token: 'stale-refresh-canary' }) });
        await oldRefresh;
        assert.ok(secrets.get('askaway.webex.accessToken') === 'fresh-access-canary' && secrets.get('askaway.webex.refreshToken') === 'fresh-refresh-canary', 'stale refresh must not overwrite fresh browser credentials');
        assert.equal(calls.length, mirrorCount, 'stale refresh must not overwrite Keychain');
        assert.equal(await service.postText('hello', 'hello'), true);
        assert.ok(requests.at(-1).options.headers.Authorization === 'Bearer fresh-access-canary', 'stale refresh must not replace reloaded memory');
        let releaseWithoutReload, signalWithoutReload;
        const pendingWithoutReload = new Promise(resolve => { releaseWithoutReload = resolve; });
        const startedWithoutReload = new Promise(resolve => { signalWithoutReload = resolve; });
        deferredRefresh = () => { signalWithoutReload(); return pendingWithoutReload; };
        const oldWithoutReload = service.refreshAccessToken();
        await startedWithoutReload;
        await browserAuth.store('newest-access-canary', 'newest-refresh-canary');
        const mirrorsBeforeRelease = calls.length;
        releaseWithoutReload({ ok: true, json: async () => ({ access_token: 'stale-access-canary', refresh_token: 'stale-refresh-canary' }) });
        await oldWithoutReload;
        assert.ok(secrets.get('askaway.webex.accessToken') === 'newest-access-canary' && secrets.get('askaway.webex.refreshToken') === 'newest-refresh-canary', 'new store alone must invalidate stale refresh');
        assert.equal(calls.length, mirrorsBeforeRelease);
        await service.reloadConfig();
        deferredRefresh = undefined;
        const legacyStart = requests.length;
        message401 = true;
        assert.equal(await service.postText('legacy hello', 'hello'), true, 'legacy postText must refresh on 401');
        const legacyRequests = requests.slice(legacyStart);
        assert.equal(legacyRequests.filter(request => request.url.endsWith('/access_token')).length, 1);
        assert.equal(legacyRequests.filter(request => request.url.endsWith('/messages')).length, 2);
        assert.ok(legacyRequests.at(-1).options.headers.Authorization === 'Bearer rotated-access-canary');
        const boundedStart = requests.length;
        const normalFetch = global.fetch;
        global.fetch = async (url, options) => url.endsWith('/messages') ? (requests.push({ url, options }), { ok: false, status: 401 }) : normalFetch(url, options);
        assert.equal(await service.postText('legacy hello', 'hello'), false);
        global.fetch = normalFetch;
        assert.equal(requests.slice(boundedStart).filter(request => request.url.endsWith('/access_token')).length, 1);
        assert.equal(requests.slice(boundedStart).filter(request => request.url.endsWith('/messages')).length, 2);
        for (const mode of ['failure', 'throw']) {
            secrets.delete('askaway.webex.accessToken');
            refreshMode = mode;
            await service.reloadConfig();
        }
        service.dispose();
        for (const secret of ['access-canary', 'refresh-canary', 'settings-canary', 'file-canary', 'client-id-canary', 'client-secret-canary', 'code-canary', 'fresh-access-canary', 'fresh-refresh-canary', 'newest-access-canary', 'newest-refresh-canary', 'stale-access-canary', 'stale-refresh-canary', 'reload-rotated-access-canary', 'reload-rotated-refresh-canary', 'http://localhost:5000/callback?']) {
            assert.ok(!(logs.join('\n') + JSON.stringify(prompts)).includes(secret), 'credentials must not appear in captured logs/errors/prompts');
        }
        const manifest = require('./package.json');
        assert.ok(manifest.contributes.commands.some(command => command.command === 'askaway.setWebexToken' && command.title === 'AskAway: Set Webex Token'));
        const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
        assert.match(extension, /registerWebexAuthCommands\(context,/);
        assert.ok(!extension.includes('callbackPort = 54321'));
        assert.ok(!extension.includes("config.update('webex.accessToken'"));
    } finally {
        Object.assign(console, originalConsole);
        global.fetch = originalFetch;
    }
    console.log('PASS Webex OAuth commands: fresh browser authorization, localhost5000 callback/state validation, secure both-token storage, safe cancellation and failures');
    console.log('PASS WebexService: SecretStorage precedence, OAuth fixture parsing, refresh writes both stores, credentials never printed');
    console.log('PASS Webex refresh interleaving: stale response cannot overwrite fresh storage, Keychain or reloaded requests');
    console.log('PASS legacy postText: 401 refreshes and retries through shared boundary exactly once');
    console.log('PASS unchanged reload: valid refresh rotates SecretStorage, Keychain and subsequent request credentials');
    console.log('PASS Webex scopes: exact local or prompted names, no broad default, invalid_scope guidance with no exchange or token changes');
}
main().catch(() => { console.error('FAIL Webex token command acceptance'); process.exitCode = 1; });
