const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const fixture = fs.mkdtempSync(path.join(build, 'worker-ask-refused-'));
const workspace = path.join(fixture, 'workspace');
fs.mkdirSync(path.join(workspace, 'specs/005-test'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'specs/005-test/spec.md'), '# Test spec\n');
fs.writeFileSync(path.join(workspace, 'specs/005-test/tasks.md'), '- [ ] T001 Reviewer work\n');
const snapshot = () => fs.readdirSync(path.join(workspace, 'specs'), { recursive: true })
    .filter(file => fs.statSync(path.join(workspace, 'specs', file)).isFile())
    .map(file => [file, fs.readFileSync(path.join(workspace, 'specs', file), 'utf8')]);

(async () => {
    const stubs = {
        vscode: `exports.workspace = { workspaceFolders: [{ uri: { fsPath: ${JSON.stringify(workspace)} } }], getConfiguration: () => ({ get: (key, fallback) => key === 'mcpPort' ? 0 : key === 'autoRegisterMcp' ? false : fallback }) };`,
        '../webview/webviewProvider': '',
        '../tools': 'exports.askUser = async () => ({});',
        '../utils/imageUtils': 'exports.getImageMimeType = () => undefined;',
        '../gradle/gradleEngine': 'exports.dispatchGradle = async () => ({});',
        '../workers/openCodeRuntime': 'exports.OpenCodeWorkerRuntime = class {};',
        '../workers/workerHost': 'exports.observeWorkers = async () => {}; exports.onSharedServerAttached = () => {}; exports.sharedWorkerRuntime = () => ({}); exports.sharedWorkerRuntimeReady = async () => ({}); exports.sharedCommentaryStore = {}; exports.restartSharedServer = async () => {};',
        '../workers/workersState': 'exports.cancelQueuedRun = () => {}; exports.loadWorkerTrace = () => {}; exports.projectWorkersState = () => ({});',
        '../workers/workerTools': 'exports.registerWorkerTools = () => {}; exports.registerToolDefinitions = (register, tools) => { for (const tool of tools) register(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async args => ({ content: [{ type: "text", text: JSON.stringify(await tool.run(args)) }] })); };',
        '../commentary/commentary': 'exports.commentaryToolDefinitions = () => [];',
        '../workers/vscodeToolBridge': 'exports.registerVsCodeToolBridge = () => {}; exports.registerWindow = () => {};',
        '../workers/evalScoreboard': 'exports.loadEvalScoreboard = () => ({});',
    };
    await esbuild.build({ entryPoints: [path.join(__dirname, 'src/mcp/mcpServer.ts')],
        outfile: path.join(fixture, 'server.cjs'), bundle: true, platform: 'node', format: 'cjs',
        packages: 'external', plugins: [{ name: 'host-fixture', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'host-fixture' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'host-fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
        } }] });
    esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/specs/askTool.ts')],
        outfile: path.join(fixture, 'asks.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
    const { McpServerManager } = require(path.join(fixture, 'server.cjs'));
    const provider = new Proxy({}, { get: () => () => {} });
    const manager = new McpServerManager(provider);
    const client = new Client({ name: 'opencode-worker', version: '1.0.0' });
    try {
        await manager.start();
        assert.ok(manager.isRunning());
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${manager.getPort()}/sse`)));
        const before = snapshot();
        const tools = await client.listTools();
        assert.equal(tools.tools.some(tool => tool.name === 'ask_user'), false, 'retired ask_user must not be exposed to MCP clients');
        assert.equal(tools.tools.some(tool => tool.name === 'askaway_asks'), false);
        const args = { action: 'capture', spec: '005-test', asks: [{ kind: 'request', text: 'Run Gradle in another repository worktree' }] };
        const response = await client.callTool({ name: 'askaway_asks', arguments: args });
        assert.equal(response.isError, true);
        assert.match(response.content[0].text, /not found/i);
        assert.deepEqual(snapshot(), before, 'worker MCP calls must not write anything under specs/');
        const { asksTool } = require(path.join(fixture, 'asks.cjs'));
        const captured = await asksTool(workspace).run({ ...args, asks: [{ kind: 'request', text: 'Reviewer requested feature' }] });
        assert.equal(captured.rows.length, 1);
        assert.match(fs.readFileSync(path.join(workspace, 'specs/005-test/tasks.md'), 'utf8'), /Reviewer requested feature/);
        const profile = fs.readFileSync(path.join(__dirname, 'worker-profiles/webex.md'), 'utf8');
        assert.match(profile, /only the main orchestrator captures reviewer asks/);
        assert.doesNotMatch(profile.split('---')[1], /askaway_asks/);
        console.log('PASS worker ask capture: ask_user absent from MCP list; OpenCode MCP tool unavailable, specs bytes unchanged; main agent capture persists; worker profile forbids capture');
    } finally {
        await client.close();
        if (manager.server) await new Promise(resolve => manager.server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
