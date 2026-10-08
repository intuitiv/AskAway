process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');

async function main() {
    const notifications = [], logs = [], security = [], waits = [], requests = [];
    const tokens = new Map([['askaway.webex.accessToken', 'access-secret-canary'], ['askaway.webex.refreshToken', 'refresh-secret-canary']]);
    const storage = { get: async key => tokens.get(key), store: async (key, value) => tokens.set(key, value) };
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/webexAuth'; export * from './src/services/webexDiscover';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const vscode = { window: { showInformationMessage: async message => notifications.push(message), showErrorMessage: async message => notifications.push(message) } };
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports);
    const { WebexAuth, webexDiscover } = loaded.exports;
    const auth = new WebexAuth(storage, async (file, args) => security.push({ file, args }), 'darwin');
    let unauthorized = true, limited = true, mode = 'success', refreshes = 0;
    const room = (id, title) => ({ id, title, type: 'group', created: '2026-01-01', lastActivity: '2026-10-08', access_token: 'access-secret-canary' });
    const server = http.createServer((req, res) => {
        requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
        res.setHeader('Content-Type', 'application/json');
        if (mode === 'unauthorized' || unauthorized) {
            unauthorized = false;
            res.writeHead(401); res.end(JSON.stringify({ error: 'access-secret-canary' })); return;
        }
        const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
        if (url.pathname === '/v1/people/me') {
            res.end(JSON.stringify({ id: 'me', displayName: mode === 'unsafe' ? 'rotated-secret-canary' : 'Reviewer', emails: ['reviewer@example.test'], token: 'access-secret-canary' }));
        } else if (url.pathname === '/v1/teams') {
            if (url.searchParams.has('page')) { res.end(JSON.stringify({ items: [{ id: 'other', name: 'Other' }] })); }
            else {
                res.setHeader('Link', `</v1/teams?page=2>; rel="next"`);
                res.end(JSON.stringify({ items: [{ id: 'self-team', name: 'SELF', token: 'access-secret-canary' }] }));
            }
        } else if (url.pathname === '/v1/rooms') {
            if (limited) { limited = false; res.setHeader('Retry-After', '0.01'); res.writeHead(429); res.end('{}'); return; }
            if (url.searchParams.get('teamId') === 'other') { res.end(JSON.stringify({ items: [room('other-room', 'Other room')] })); }
            else if (url.searchParams.has('page')) { res.end(JSON.stringify({ items: [room('workspace-room', 'FixtureWorkspace')] })); }
            else {
                res.setHeader('Link', `<http://127.0.0.1:${server.address().port}/v1/rooms?teamId=self-team&max=100&page=2>; rel="next"`);
                res.end(JSON.stringify({ items: [room('built-in', 'SELF'), room('general-room', 'AskAway General')] }));
            }
        } else { res.writeHead(404); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const original = { log: console.log, warn: console.warn, error: console.error };
    for (const method of Object.keys(original)) { console[method] = (...args) => logs.push(args.join(' ')); }
    try {
        const workspace = { fsPath: path.join(__dirname, 'build', 'webex-discover-workspace'), name: 'FixtureWorkspace' };
        const options = {
            baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, wait: async milliseconds => waits.push(milliseconds),
            refresh: async () => { refreshes++; await auth.store('rotated-secret-canary', 'rotated-refresh-canary'); return 'rotated-secret-canary'; }
        };
        assert.equal(await webexDiscover(auth, workspace, options), true);
        const raw = fs.readFileSync(path.join(workspace.fsPath, '.askaway', 'webex-spaces.json'), 'utf8');
        const facts = JSON.parse(raw);
        assert.ok(!Number.isNaN(Date.parse(facts.discoveredAt)));
        assert.deepEqual(facts.me, { id: 'me', displayName: 'Reviewer', emails: ['reviewer@example.test'] });
        assert.deepEqual(facts.teams, [
            { id: 'self-team', name: 'SELF', rooms: [['built-in', 'SELF'], ['general-room', 'AskAway General'], ['workspace-room', 'FixtureWorkspace']].map(([id, title]) => ({ id, title, type: 'group', created: '2026-01-01', lastActivity: '2026-10-08' })) },
            { id: 'other', name: 'Other', rooms: [{ id: 'other-room', title: 'Other room', type: 'group', created: '2026-01-01', lastActivity: '2026-10-08' }] }
        ]);
        assert.deepEqual(facts.self, { teamId: 'self-team', generalRoomId: 'general-room', workspaceRoomId: 'workspace-room' });
        assert.equal(refreshes, 1);
        assert.deepEqual(waits, [10]);
        assert.equal(requests.filter(request => request.url === '/v1/people/me').length, 2);
        assert.ok(requests.some(request => request.url === '/v1/rooms?teamId=self-team&max=100&page=2'));
        assert.ok(requests.some(request => request.url === '/v1/teams?page=2'));
        assert.ok(requests.every(request => request.method === 'GET'));
        assert.equal(requests[1].authorization, 'Bearer rotated-secret-canary');
        assert.deepEqual(security.at(-1), { file: 'security', args: ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-general-room-id', '-w', 'general-room'] });
        assert.equal(notifications[0], 'AskAway: Discovered 2 teams, 4 rooms. self: found; General: found.');
        mode = 'unauthorized';
        const previousRefreshes = refreshes;
        assert.equal(await webexDiscover(auth, workspace, options), false);
        assert.equal(refreshes - previousRefreshes, 1);
        mode = 'unsafe';
        assert.equal(await webexDiscover(auth, workspace, options), false);
        assert.equal(fs.readFileSync(path.join(workspace.fsPath, '.askaway', 'webex-spaces.json'), 'utf8'), raw);
        const captured = raw + notifications.join('\n') + logs.join('\n');
        for (const secret of ['access-secret-canary', 'refresh-secret-canary', 'rotated-secret-canary', 'rotated-refresh-canary']) { assert.ok(!captured.includes(secret)); }
        const before = security.length;
        await new WebexAuth(storage, async (file, args) => security.push({ file, args }), 'linux').mirror('webex-general-room-id', 'general-room');
        assert.equal(security.length, before);
        assert.ok(require('./package.json').contributes.commands.some(command => command.command === 'askaway.webexDiscover' && command.title === 'AskAway: Discover Webex Spaces'));
        assert.match(fs.readFileSync(path.join(__dirname, 'src/services/webexWiring.ts'), 'utf8'), /registerCommand\('askaway\.webexDiscover'/);
        assert.match(fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8'), /wireWebex\(context, provider,/);
    } finally {
        Object.assign(console, original);
        await new Promise(resolve => server.close(resolve));
    }
    console.log('PASS Webex discovery: teams and rooms paginated, 429 waited and retried, 401 refreshed once');
    console.log('PASS Webex discovery: non-secret workspace file, self/General routing, exact Keychain args, safe notifications');
}
main().catch(error => { console.error('FAIL Webex discovery acceptance:', String(error.message || error).slice(0, 1000)); process.exitCode = 1; });
