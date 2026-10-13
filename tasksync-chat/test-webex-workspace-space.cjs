process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');

async function main() {
    let enabled = false, requests = 0, creations = 0, offered = false;
    const updates = [], commands = [], notices = [], mirrors = [];
    const secrets = new Map([['askaway.webex.accessToken', 'fixture-access-canary']]);
    // Real API shape (2026-10-08 live): the team's General space is titled with the team name.
    const rooms = [{ id: 'general', title: 'self' }, { id: 'existing', title: 'webex-existing' }];
    const server = http.createServer(async (req, res) => {
        requests++;
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/people/me') { res.end(JSON.stringify({ id: 'person', displayName: 'Fixture', emails: [] })); }
        else if (req.url === '/v1/teams') { res.end(JSON.stringify({ items: [{ id: 'self-team', name: 'self' }] })); }
        else if (req.method === 'POST' && req.url === '/v1/rooms') {
            let body = ''; for await (const chunk of req) { body += chunk; }
            const data = JSON.parse(body);
            assert.equal(data.teamId, 'self-team');
            assert.ok(['AskAway General', 'webex-missing', 'webex-existing_1'].includes(data.title));
            creations++;
            const room = { id: data.title === 'AskAway General' ? 'askaway-general' : data.title === 'webex-existing_1' ? 'collision' : 'created', title: data.title }; rooms.push(room); res.end(JSON.stringify(room));
        } else if (req.url.startsWith('/v1/rooms?')) { res.end(JSON.stringify({ items: rooms })); }
        else { res.writeHead(404); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'enabled' ? enabled : fallback,
            update: async (key, value, target) => { updates.push({ key, value, target }); enabled = value; } }) },
        window: { showErrorMessage: async message => notices.push(message), showInformationMessage: async (message, action) => {
            notices.push(message); if (action === 'Sign in') { offered = true; return 'Sign in'; }
            if (message.includes('Discovered')) { return new Promise(() => {}); }
            if (message.includes('Configure Webex notifications')) { return new Promise(() => {}); }
        } },
        commands: { executeCommand: async command => commands.push(command) }
    };
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/webexAuth'; export * from './src/services/webexSpaces'; export * from './src/services/webexService'; export * from './src/services/webexDiscover'; export * from './src/services/webexIncomingWebhook';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const home = fs.mkdtempSync(path.join(__dirname, 'build', 'webex-home-'));
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : name === 'os' ? { ...require('os'), homedir: () => home } : require(name), loaded, loaded.exports);
    const { WebexAuth, setupWebex, ensureWebexWorkspace, WebexService } = loaded.exports;
    const auth = new WebexAuth({ get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value) }, async (file, args) => mirrors.push({ file, args }), 'darwin');
    const options = { baseUrl: `http://127.0.0.1:${server.address().port}/v1/` };
    const workspace = name => ({ fsPath: path.join(__dirname, 'build', name), name: 'display-name-not-folder-name' });
    const facts = name => JSON.parse(fs.readFileSync(path.join(workspace(name).fsPath, '.askaway/webex-spaces.json'), 'utf8'));
    try {
        assert.equal(await setupWebex(auth, workspace('webex-existing'), options), true);
        assert.equal(creations, 1, 'owned General must be created instead of selecting built-in self');
        assert.deepEqual(facts('webex-existing').self, { teamId: 'self-team', generalRoomId: 'askaway-general', workspaceRoomId: 'existing' });
        assert.equal(mirrors.at(-1).args.at(-1), 'askaway-general');
        await loaded.exports.webexDiscover(auth, workspace('webex-existing'), options);
        assert.equal(facts('webex-existing').self.generalRoomId, 'askaway-general');
    const hook = new loaded.exports.WebexIncomingWebhook({ get: async key => secrets.get(key) }, async (file, args) => mirrors.push({ file, args }), 'darwin');
        await hook.prompt(workspace('webex-existing').fsPath, { get: (_, fallback) => fallback, update: async () => {} });
        assert.ok(notices.some(message => message.includes('Configure Webex notifications for AskAway General')));
        assert.equal(enabled, true);
        assert.deepEqual(updates[0], { key: 'enabled', value: true, target: 1 });
        assert.equal(await setupWebex(auth, workspace('webex-missing'), options), true);
        assert.equal(await setupWebex(auth, workspace('webex-missing'), options), true);
        assert.equal(creations, 2);
        assert.equal(rooms.filter(room => room.title === 'AskAway General').length, 1);
        assert.deepEqual(facts('webex-missing').self, { teamId: 'self-team', generalRoomId: 'askaway-general', workspaceRoomId: 'created' });
        const unavailableMirror = new WebexAuth({ get: async key => secrets.get(key) }, async () => { throw new Error('Keychain unavailable'); }, 'darwin');
        assert.equal(await setupWebex(unavailableMirror, workspace('webex-missing'), options), true, 'optional mirror failure cannot abort setup');
        assert.equal(creations, 2, 'mirror failure and rediscovery must not duplicate rooms');
        // 009 T006 (reviewer, 2026-10-13): same folder name in another workspace gets a counter suffix, stable across reloads.
        const twin = { fsPath: path.join(__dirname, 'build', 'webex-twin', 'webex-existing'), name: 'webex-existing' };
        fs.rmSync(path.dirname(twin.fsPath), { recursive: true, force: true });
        assert.equal(await setupWebex(auth, twin, options), true);
        assert.equal(creations, 3); assert.equal(rooms.filter(room => room.title === 'webex-existing_1').length, 1);
        assert.equal(JSON.parse(fs.readFileSync(path.join(twin.fsPath, '.askaway/webex-spaces.json'), 'utf8')).self.workspaceRoomId, 'collision');
        assert.equal(await setupWebex(auth, twin, options), true);
        assert.equal(await setupWebex(auth, workspace('webex-existing'), options), true);
        assert.equal(creations, 3, 'reload keeps each workspace on its own space');
        assert.equal(facts('webex-existing').self.workspaceRoomId, 'existing');
        assert.equal(JSON.parse(fs.readFileSync(path.join(twin.fsPath, '.askaway/webex-spaces.json'), 'utf8')).self.workspaceRoomId, 'collision');
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.askaway/webex-workspace-spaces.json'), 'utf8'))[twin.fsPath], 'webex-existing_1');
        console.log('PASS Webex same folder name: second workspace gets <name>_1, mapping persisted and stable on reload');
        const before = requests;
        assert.equal(await ensureWebexWorkspace(auth, workspace('webex-missing'), options), true);
        assert.equal(requests, before);
        enabled = false;
        assert.equal(await ensureWebexWorkspace(auth, workspace('webex-disabled'), options), false);
        const service = new WebexService(undefined, auth, path.join(__dirname, 'build', 'absent-credentials'), options);
        await service.reloadConfig(); service.start();
        assert.equal(await service.destination(workspace('webex-existing').fsPath), undefined);
        service.stop(); service.dispose();
        assert.equal(requests, before);
        enabled = true; secrets.clear();
        assert.equal(await ensureWebexWorkspace(auth, workspace('webex-unsigned'), options), false);
        assert.equal(offered, true);
        assert.deepEqual(commands, ['askaway.setWebexToken']);
        assert.ok(notices.some(message => message.includes('not signed in')));
        assert.equal(requests, before);
        assert.ok(!JSON.stringify(facts('webex-missing')).includes('fixture-access-canary'));
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log('PASS Webex workspace: AskAway General created once, recorded, mirrored, kept on rediscovery and offered in webhook prompt; workspace reused/created once');
    console.log('PASS Webex setting: disabled makes zero requests; enabled without token offers sign-in');
}
main().catch(error => { console.error('FAIL Webex workspace acceptance:', error.message); process.exitCode = 1; });
