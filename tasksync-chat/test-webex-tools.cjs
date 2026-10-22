// EV-WEBEX-TOOLS-ADAPTERS (T046): the Webex host registers Webex as an assistant provider (twelve tools, no LM askaway_webex); its only
// send path is the AITalk card, and the R-TELE-43 modal is the explicit fallback it supplies: not Here means unavailable with no modal,
// Here shows the full target and text, Cancel and disabled never post. Fake fetch, no network.
process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
    const hostBuild = await esbuild.build({ entryPoints: [path.join(__dirname, 'src/services/webexToolsHost.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['vscode', '../webview/webviewProvider', './webexAuth'] });
    let mode = 'away', choice = 'Send', enabled = true, token = 'host-token-canary';
    const modals = [], httpCalls = [];
    const vscode = { workspace: { getConfiguration: () => ({ get: () => enabled }) }, window: { showWarningMessage: async (...args) => { modals.push(args); return choice; } } };
    const hostLoaded = { exports: {} };
    new Function('require', 'module', 'exports', hostBuild.outputFiles[0].text)(name => {
        if (name === 'vscode') return vscode;
        if (name.includes('webviewProvider')) return { readAvailability: () => ({ mode }) };
        if (name.includes('webexAuth')) return { WebexAuth: class { async tokens() { return { accessToken: token }; } } };
        return require(name);
    }, hostLoaded, hostLoaded.exports);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'webex-host-'));
    const originalFetch = global.fetch;
    const data = url => {
        const p = new URL(url).pathname;
        if (p === '/v1/rooms') return { items: [{ id: 'r', title: 'Build Team', type: 'group', lastActivity: '2026-10-22T09:00:00.000Z' }] };
        if (p === '/v1/people/me') return { id: 'me', displayName: 'Reviewer' };
        if (p === '/v1/messages') return { items: [{ id: 'posted', roomId: 'r', personId: 'me', text: 'hello', created: '2026-10-22T09:00:00.000Z' }] };
        return { items: [] };
    };
    global.fetch = async (url, options = {}) => { httpCalls.push({ url, options }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => data(url), text: async () => JSON.stringify(data(url)) }; };
    try {
        const tools = hostLoaded.exports.createWebexSuiteHost({}, workspace);
        const twelve = ['webex_inbox', 'webex_find', 'webex_read', 'webex_search', 'webex_wait', 'webex_meetings', 'webex_send', 'webex_reply', 'webex_edit_message', 'webex_delete_message', 'webex_edit_draft', 'webex_style_card'];
        assert.deepEqual(tools.map(tool => tool.name).sort(), [...twelve].sort());
        assert.equal(hostLoaded.exports.createWebexSuiteHost({}, workspace).length, 12, 'a second host (reload) replaces the provider instead of throwing');
        const run = (name, args) => tools.find(tool => tool.name === name).run(args);
        const posts = () => httpCalls.filter(call => call.options.method === 'POST');
        const send = { to: 'Build Team', text: 'Full message\n' + 'z'.repeat(900) };

        for (mode of ['away', 'offline']) {
            assert.equal((await run('webex_send', send)).status, 'unavailable');
            assert.equal(modals.length, 0); assert.equal(posts().length, 0);
        }
        mode = 'here';
        assert.equal((await run('webex_send', send)).status, 'sent');
        assert.ok(modals[0][0].includes('Build Team')); assert.ok(modals[0][0].includes(send.text));
        assert.deepEqual(modals[0].slice(1), [{ modal: true }, 'Send', 'Cancel']);
        assert.equal(posts().length, 1); assert.equal(posts()[0].options.headers.Authorization, 'Bearer host-token-canary');
        assert.equal(JSON.parse(posts()[0].options.body).roomId, 'r');
        choice = 'Cancel'; assert.equal((await run('webex_send', send)).status, 'rejected'); assert.equal(posts().length, 1);
        // Disabled or signed out: even an approved modal posts nothing (the cached space name still resolves).
        choice = 'Send';
        enabled = false; assert.equal((await run('webex_send', send)).status, 'error'); assert.equal(posts().length, 1);
        enabled = true; token = ''; assert.equal((await run('webex_send', send)).status, 'error'); assert.equal(posts().length, 1);
        token = 'host-token-canary';
        await run('webex_read', { space: 'Build Team' });
        assert.ok(fs.existsSync(path.join(workspace, '.askaway/webex-seen.json')), 'the seen watermark lives in the workspace .askaway folder');
        console.log('PASS Webex host: modal only as the explicit fallback (not Here: unavailable, no modal; Here: full target and text; Cancel and disabled never post)');
    } finally { global.fetch = originalFetch; fs.rmSync(workspace, { recursive: true, force: true }); }

    // Reviewer 2026-10-12: Webex tools belong to the Webex worker (MCP suite), not the main agent; 2026-10-22: the LM askaway_webex is gone.
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'src/tools.ts'), 'utf8'), /webexTool\(/);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'src/workers/workerTools.ts'), 'utf8'), /webexTool|askaway_webex/);
    assert.match(fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8'), /new McpServerManager\(provider, memory, createWebexSuiteHost\(/);
    assert.match(fs.readFileSync(path.join(__dirname, 'src/mcp/mcpServer.ts'), 'utf8'), /this\.webex\)/);
    assert.ok(!require('./package.json').contributes.languageModelTools.some(tool => tool.name === 'askaway_webex'));
    console.log('PASS EV-WEBEX-TOOLS-ADAPTERS Webex worker MCP suite wired with SecretStorage through the provider registry; no LM askaway_webex');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
