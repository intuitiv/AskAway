const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');

async function main() {
    let enabled = false, requests = 0, creations = 0, offered = false;
    const updates = [], commands = [], notices = [];
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
            assert.equal(data.title, 'webex-missing');
            creations++;
            const room = { id: 'created', title: data.title }; rooms.push(room); res.end(JSON.stringify(room));
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
        } },
        commands: { executeCommand: async command => commands.push(command) }
    };
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/webexAuth'; export * from './src/services/webexSpaces'; export * from './src/services/webexService';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports);
    const { WebexAuth, setupWebex, ensureWebexWorkspace, WebexService } = loaded.exports;
    const auth = new WebexAuth({ get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value) }, async () => {}, 'linux');
    const options = { baseUrl: `http://127.0.0.1:${server.address().port}/v1/` };
    const workspace = name => ({ fsPath: path.join(__dirname, 'build', name), name: 'display-name-not-folder-name' });
    const facts = name => JSON.parse(fs.readFileSync(path.join(workspace(name).fsPath, '.askaway/webex-spaces.json'), 'utf8'));
    try {
        assert.equal(await setupWebex(auth, workspace('webex-existing'), options), true);
        assert.equal(creations, 0);
        assert.deepEqual(facts('webex-existing').self, { teamId: 'self-team', generalRoomId: 'general', workspaceRoomId: 'existing' });
        assert.equal(enabled, true);
        assert.deepEqual(updates[0], { key: 'enabled', value: true, target: 1 });
        assert.equal(await setupWebex(auth, workspace('webex-missing'), options), true);
        assert.equal(await setupWebex(auth, workspace('webex-missing'), options), true);
        assert.equal(creations, 1);
        assert.deepEqual(facts('webex-missing').self, { teamId: 'self-team', generalRoomId: 'general', workspaceRoomId: 'created' });
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
    console.log('PASS Webex workspace: existing reused, missing created once, General recorded, folder title and global enabled setting');
    console.log('PASS Webex setting: disabled makes zero requests; enabled without token offers sign-in');
}
main().catch(error => { console.error('FAIL Webex workspace acceptance:', error.message); process.exitCode = 1; });
