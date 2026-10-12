process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
    const build = await esbuild.build({ entryPoints: [path.join(__dirname, 'src/services/webexTools.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => {
        assert.ok(!['vscode', 'child_process'].includes(name), 'no host or Keychain access');
        return require(name);
    }, loaded, loaded.exports);
    const { runWebexTool } = loaded.exports;
    const calls = [], approvals = [], outputs = [];
    let decision = 'denied', failure = false;
    const deps = {
        approve: async draft => { approvals.push(draft); if (decision === 'throws') { throw Error('Bearer approval-secret'); } return decision; },
        request: async (method, url, body) => {
            calls.push({ method, url, body });
            if (failure) { throw Error('Bearer request-secret'); }
            const parsed = new URL(url, 'https://fixture.test');
            const max = Number(parsed.searchParams.get('max'));
            assert.ok(url.startsWith('/'));
            let data;
            if (method === 'POST') { assert.equal(url, '/messages'); data = { id: 'sent', access_token: 'hidden-secret' }; }
            else if (parsed.pathname === '/people/me') { data = { id: 'me', token: 'hidden-secret' }; }
            else {
                assert.ok(max > 0 && max <= 50);
                if (parsed.pathname === '/rooms') {
                    assert.equal(parsed.searchParams.get('sortBy'), 'lastactivity');
                    data = { items: Array.from({ length: 60 }, (_, i) => ({ id: `room-${i}`, title: 'Space', access_token: 'hidden-secret' })) };
                } else if (parsed.pathname === '/people') {
                    assert.ok(parsed.searchParams.has('email') || parsed.searchParams.has('displayName'));
                    data = { items: [{ id: 'person', displayName: 'Reviewer', token: 'hidden-secret' }] };
                } else {
                    assert.equal(parsed.pathname, '/messages');
                    assert.equal(parsed.searchParams.get('roomId'), 'room & one');
                    data = { items: [
                        { id: 'm1', personId: 'me', text: 'HELLO style', access_token: 'hidden-secret' },
                        { id: 'm2', personId: 'other', text: 'hello team' },
                        { id: 'm3', personId: 'me', text: 'x'.repeat(1500) },
                        { id: 'm4', text: 'Bearer response-secret' },
                    ] };
                }
            }
            return { ok: true, json: async () => data, headers: { get: name => name === 'Link' ? '<https://unsafe.test/?token=hidden-secret>; rel="next"' : null } };
        },
    };
    const run = async input => { const out = await runWebexTool(input, deps); outputs.push(out); return out; };
    const spaces = await run({ action: 'spaces', max: 500 });
    assert.equal(spaces.items.length, 50); assert.equal(spaces.hasMore, true); assert.equal(spaces.truncated, true);
    console.log('PASS spaces bounded max=50 lastactivity and pagination flag');
    const read = await run({ action: 'read', roomId: 'room & one', mine: true });
    assert.deepEqual(read.items.map(item => item.id), ['m1', 'm3']);
    assert.equal(read.items[1].text.length, 1000); assert.equal(read.truncated, true);
    assert.ok(calls.some(call => call.url === '/people/me'));
    console.log('PASS read mine filters token owner; text bounded to 1000');
    await run({ action: 'thread', roomId: 'room & one', parentId: 'parent & one', max: 2 });
    assert.equal(new URL(calls.at(-1).url, 'https://fixture.test').searchParams.get('parentId'), 'parent & one');
    console.log('PASS thread roomId and parentId encoded');
    const search = await run({ action: 'search', roomId: 'room & one', query: 'HeLLo', max: 2 });
    assert.deepEqual(search.items.map(item => item.id), ['m1', 'm2']); assert.equal(search.scanned, 2);
    console.log('PASS search case-insensitive last N messages');
    for (const input of [{ email: 'reviewer@example.test' }, { displayName: 'A & B' }]) {
        assert.equal((await run({ action: 'people', ...input })).items[0].id, 'person');
    }
    console.log('PASS people email and displayName lookup');
    for (decision of ['denied', 'unavailable', 'throws']) {
        for (const recipient of [{ roomId: 'other-space' }, { toPersonEmail: 'other@example.test' }]) {
            const before = calls.length;
            const out = await run({ action: 'send', ...recipient, text: 'Please review.', parentId: 'parent' });
            assert.deepEqual(out, { status: 'draft', recipientLabel: Object.values(recipient)[0], text: 'Please review.' });
            assert.equal(calls.length, before); assert.equal(approvals.at(-1).parentId, 'parent');
        }
    }
    console.log('PASS draft-refusal person and space denied/unavailable/approval failure never post');
    decision = 'approved';
    for (const recipient of [{ roomId: 'other-space' }, { toPersonEmail: 'other@example.test' }]) {
        assert.equal((await run({ action: 'send', ...recipient, text: 'Approved reply', parentId: 'parent' })).status, 'sent');
        assert.deepEqual(calls.at(-1).body, { ...recipient, text: 'Approved reply', parentId: 'parent' });
    }
    const before = calls.length;
    assert.equal((await run({ action: 'send', roomId: 'a', toPersonEmail: 'a@example.test', text: 'bad' })).status, 'invalid');
    assert.equal((await run({ action: 'read' })).status, 'invalid');
    assert.equal((await run({ action: 'spaces', token: 'hidden-secret' })).status, 'invalid');
    assert.equal(calls.length, before);
    failure = true;
    assert.equal((await run({ action: 'spaces' })).status, 'error');
    failure = false;
    await run({ action: 'read', roomId: 'room & one' });
    assert.doesNotMatch(JSON.stringify(outputs), /hidden-secret|request-secret|response-secret|approval-secret|access_token|Bearer/);
    console.log('PASS secret-free output allowlisted fields, redacted text, sanitized errors and strict token-free inputs');
    const hostBuild = await esbuild.build({ entryPoints: [path.join(__dirname, 'src/services/webexToolsHost.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['vscode', '../webview/webviewProvider', './webexAuth'] });
    let mode = 'away', choice = 'Send', enabled = true, token = 'host-token-canary';
    const modals = [], httpCalls = [];
    const vscode = { workspace: { getConfiguration: () => ({ get: () => enabled }) },
        window: { showWarningMessage: async (...args) => { modals.push(args); return choice; } } };
    const hostLoaded = { exports: {} };
    new Function('require', 'module', 'exports', hostBuild.outputFiles[0].text)(name => {
        if (name === 'vscode') return vscode;
        if (name.includes('webviewProvider')) return { readAvailability: () => ({ mode }) };
        if (name.includes('webexAuth')) return { WebexAuth: class { async tokens() { return { accessToken: token }; } } };
        return require(name);
    }, hostLoaded, hostLoaded.exports);
    const host = hostLoaded.exports.createWebexToolsHost({}, 'fixture');
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => { httpCalls.push({ url, options }); return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ id: 'posted', items: [] }) }; };
    try {
        const send = { action: 'send', toPersonEmail: 'reviewer@example.test', text: 'Full message\n' + 'z'.repeat(900) };
        for (mode of ['away', 'offline']) {
            assert.equal((await host(send)).status, 'draft');
            assert.equal(modals.length, 0); assert.equal(httpCalls.length, 0);
        }
        mode = 'here';
        assert.equal((await host(send)).status, 'sent');
        assert.ok(modals[0][0].includes(send.toPersonEmail)); assert.ok(modals[0][0].includes(send.text));
        assert.deepEqual(modals[0].slice(1), [{ modal: true }, 'Send', 'Cancel']);
        assert.equal(httpCalls[0].options.headers.Authorization, 'Bearer host-token-canary');
        choice = 'Cancel'; assert.equal((await host(send)).status, 'draft'); assert.equal(httpCalls.length, 1);
        enabled = false; assert.equal((await host(send)).status, 'disabled');
        enabled = true; token = ''; assert.equal((await host(send)).status, 'disabled');
        console.log('PASS Webex host approval: not Here draft without modal; Here full recipient+text modal; Cancel and disabled never post');
    } finally { global.fetch = originalFetch; }
    const adaptersBuild = await esbuild.build({ stdin: { contents: "export { webexTool, registerToolDefinitions } from './src/workers/workerTools'; export { registerLmToolDefinitions } from './src/workers/lmTools';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const lm = new Map(), mcp = new Map(), adapters = { exports: {} };
    new Function('require', 'module', 'exports', adaptersBuild.outputFiles[0].text)(name => name === 'vscode' ? {
        lm: { registerTool: (name, tool) => { lm.set(name, tool); return { dispose() {} }; } },
        LanguageModelToolResult: class { constructor(content) { this.content = content; } },
        LanguageModelTextPart: class { constructor(value) { this.value = value; } },
    } : require(name), adapters, adapters.exports);
    const definition = adapters.exports.webexTool(host);
    adapters.exports.registerLmToolDefinitions([definition]);
    adapters.exports.registerToolDefinitions((name, config, handler) => mcp.set(name, handler), [definition]);
    const lmResult = await lm.get('askaway_webex').invoke({ input: { action: 'spaces' } });
    const mcpResult = await mcp.get('askaway_webex')({ action: 'spaces' });
    assert.equal(lmResult.content[0].value, mcpResult.content[0].text);
    assert.equal(JSON.parse(lmResult.content[0].value).status, 'disabled');
    token = 'host-token-canary'; mode = 'away';
    const sendInput = { action: 'send', roomId: 'another-space', text: 'Please check this.' };
    const modalCount = modals.length;
    assert.equal(JSON.parse((await lm.get('askaway_webex').invoke({ input: sendInput })).content[0].value).status, 'draft');
    assert.equal(JSON.parse((await mcp.get('askaway_webex')(sendInput)).content[0].text).status, 'draft');
    assert.equal(modals.length, modalCount);
    const fs = require('node:fs');
    // Reviewer 2026-10-12: Webex tools belong to the Webex worker (MCP suite), not the main agent.
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'src/tools.ts'), 'utf8'), /webexTool\(/);
    assert.match(fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8'), /new McpServerManager\(provider, memory, createWebexSuiteHost\(/);
    assert.match(fs.readFileSync(path.join(__dirname, 'src/mcp/mcpServer.ts'), 'utf8'), /this\.webex\)/);
    assert.ok(!require('./package.json').contributes.languageModelTools.some(tool => tool.name === 'askaway_webex'));
    console.log('PASS EV-WEBEX-TOOLS-ADAPTERS askaway_webex adapters; Webex worker MCP suite wired with SecretStorage; not in main LM tools');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
