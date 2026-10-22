const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const code = esbuild.buildSync({ stdin: { contents: "export * from './src/commentary/commentary'; export * from './src/workers/workerProfiles'; export * from './src/workers/claudeRuntime'; export { registerToolDefinitions } from './src/workers/workerTools';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const api = { exports: {} };
new Function('require', 'module', 'exports', code)(require, api, api.exports);
(async () => {
    const manifest = require('./package.json').contributes.languageModelTools;
    assert(manifest.some(tool => tool.name === 'aitalk' && tool.toolReferenceName === 'aitalk'));
    assert(!manifest.some(tool => tool.name === 'commentary'));
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const server = new McpServer({ name: 'test', version: '1' });
    const definitions = api.exports.commentaryToolDefinitions(() => ({ post: () => ({ status: 'POSTED' }) }), 'workspace');
    api.exports.registerToolDefinitions((...args) => server.registerTool(...args), definitions);
    const client = new Client({ name: 'test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['aitalk']);
        const posts = [];
        api.exports.setCommentaryAITalkMirror((workspace, args) => { posts.push(args.text); return { id: 'posted' }; });
        for (const action of ['say', 'aitalk']) {
            const result = await client.callTool({ name: 'aitalk', arguments: { action, text: 'A direct room message', waitSeconds: 0 } });
            assert.equal(JSON.parse(result.content[0].text).id, 'posted');
        }
        assert.equal(posts.length, 2);
        assert.equal(definitions[0].run({ kind: 'update', text: 'Default remains a feed line' }).status, 'POSTED');
        const profiles = api.exports.loadWorkerProfiles(path.join(__dirname, 'worker-profiles'));
        assert(profiles.some(profile => profile.mcp.includes('askaway_aitalk')));
        assert(profiles.every(profile => !profile.mcp.includes('askaway_commentary')));
        const stale = api.exports.parseWorkerProfile(fs.readFileSync(path.join(__dirname, 'worker-profiles/build.md'), 'utf8').replace('askaway_aitalk', 'askaway_commentary'));
        assert(stale.mcp.includes('askaway_aitalk'));
        assert.deepEqual(api.exports.toAgyPermissions({ mcp: ['askaway_commentary'], bash: 'deny' }), ['mcp(askaway/aitalk)']);
        assert(api.exports.claudeToolRules({ ...stale, mcp: ['askaway_commentary'] }).allowed.includes('mcp__askaway__aitalk'));
        console.log('PASS EV-AITALK-TOOL-NAME manifest+MCP listTools+profiles expose aitalk only; say+legacy action+default+stale policies preserved');
    } finally { await client.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
