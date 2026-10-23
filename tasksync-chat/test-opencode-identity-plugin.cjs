// OpenCode workers send no _meta on MCP calls. The AskAway OpenCode plugin adds the OpenCode session id to askaway_* calls and the
// server maps it to the worker through the runtime's session registry, so queued AITalk messages reach the worker (EV-OPENCODE-IDENTITY-PLUGIN).
// Run: node test-opencode-identity-plugin.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { transpileSrc } = require('./tools/transpile-src.cjs');

const buildDir = path.join(__dirname, '.opencode-identity-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
transpileSrc(buildDir, ['workers', 'team', 'aitalk', 'commentary', 'hooks', 'validator']);
const load = (...parts) => require(path.join(buildDir, ...parts));
const { syncOpenCodeIdentityPlugin, identityPluginSource, IDENTITY_PLUGIN_FILE } = load('workers', 'openCodeIdentityPlugin.js');
const { parseWorkerProfile } = load('workers', 'workerProfiles.js');
const { OpenCodeWorkerRuntime } = load('workers', 'openCodeRuntime.js');
const { registerToolDefinitions, registerWorkerTools } = load('workers', 'workerTools.js');
const { configureAITalkDelivery, setAITalkSessionResolver, mcpAITalkCaller, AITALK_QUEUE_LABEL } = load('aitalk', 'delivery.js');
const { roomFor } = load('aitalk', 'actors.js');
const { AITalkStore } = load('aitalk', 'store.js');
const { commentaryToolDefinitions, CommentaryStore } = load('commentary', 'commentary.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
    // 1. The generated plugin: only askaway_ tools get the session id, everything else is untouched.
    const pluginDir = path.join(buildDir, 'config', 'opencode', 'plugins');
    assert.equal(syncOpenCodeIdentityPlugin(pluginDir), true, 'first sync writes the plugin');
    const pluginFile = path.join(pluginDir, IDENTITY_PLUGIN_FILE);
    assert.equal(fs.readFileSync(pluginFile, 'utf8'), identityPluginSource());
    const plugin = await (await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(pluginFile, 'utf8')).toString('base64')}`)).AskAwayIdentity({});
    const before = plugin['tool.execute.before'];
    const commentaryArgs = { action: 'post', text: 'Working' };
    await before({ tool: 'askaway_commentary', sessionID: 'ses_A', callID: 'c1' }, { args: commentaryArgs });
    assert.deepEqual(commentaryArgs, { action: 'post', text: 'Working', _meta: { openCodeSessionId: 'ses_A' } });
    for (const tool of ['bash', 'read', 'askawayish', 'other_askaway_commentary']) {
        const args = { filePath: '/x' };
        await before({ tool, sessionID: 'ses_A', callID: 'c2' }, { args });
        assert.deepEqual(args, { filePath: '/x' }, `${tool} is untouched`);
    }
    const noSession = { text: 'x' };
    await before({ tool: 'askaway_commentary', callID: 'c3' }, { args: noSession });
    assert.deepEqual(noSession, { text: 'x' }, 'no session id, nothing added');
    await before({ tool: 'askaway_commentary', sessionID: 'ses_A' }, {});

    // 2. Idempotent, atomic, AskAway-owned filename only.
    const stat = fs.statSync(pluginFile);
    assert.equal(syncOpenCodeIdentityPlugin(pluginDir), false, 'second sync writes nothing');
    assert.equal(fs.statSync(pluginFile).ino, stat.ino); assert.equal(fs.statSync(pluginFile).mtimeMs, stat.mtimeMs);
    fs.writeFileSync(pluginFile, '// edited by hand\n');
    assert.equal(syncOpenCodeIdentityPlugin(pluginDir), true, 'a changed file is restored');
    assert.equal(fs.readFileSync(pluginFile, 'utf8'), identityPluginSource());
    assert.deepEqual(fs.readdirSync(pluginDir), [IDENTITY_PLUGIN_FILE], 'no temp files left, nothing else written');
    assert.equal(fs.existsSync(path.join(buildDir, 'config', 'opencode', 'opencode.json')), false, 'the user config file is never created or edited');

    // 3. The runtime's session registry: a worker's OpenCode session resolves to its worker and owner workspace; unknown does not.
    const MODEL = 'github-copilot/gpt-5.6-luna';
    const profile = parseWorkerProfile(`---\nname: verify\ndescription: "v"\ntier: light\nmodel: ${MODEL}\nthinking: low\nmodels: [${MODEL}]\nthinkingOptions: [low]\nedit: deny\n---\nBody.\n`);
    const ledgerDir = fs.mkdtempSync(path.join(buildDir, 'ledger-'));
    // The runtime's agent sync (called on every worker start) installs the plugin next to the agents, in the config's plugin folder.
    const { syncOpenCodeAgents } = load('workers', 'workerProfiles.js');
    const synced = path.join(buildDir, 'synced', 'opencode');
    syncOpenCodeAgents([profile], path.join(synced, 'agents'), undefined, path.join(synced, 'plugins'));
    assert.equal(fs.readFileSync(path.join(synced, 'plugins', IDENTITY_PLUGIN_FILE), 'utf8'), identityPluginSource());
    assert.deepEqual(fs.readdirSync(path.join(synced, 'agents')), ['aa-verify.md']);
    // A plugin write failure never stops worker start: the agents are still written, it is logged once, and no temp file stays behind.
    const blocked = path.join(buildDir, 'blocked'); fs.mkdirSync(path.join(blocked, IDENTITY_PLUGIN_FILE), { recursive: true }); fs.writeFileSync(path.join(blocked, IDENTITY_PLUGIN_FILE, 'keep'), 'x');
    const warnings = []; const warn = console.warn; console.warn = (...args) => warnings.push(args.join(' '));
    try {
        assert.throws(() => syncOpenCodeIdentityPlugin(blocked), 'the plugin writer itself reports the failure');
        assert.deepEqual(fs.readdirSync(blocked), [IDENTITY_PLUGIN_FILE], 'the failed write removed its temp file');
        const notADir = path.join(buildDir, 'not-a-dir'); fs.writeFileSync(notADir, 'x');
        for (const pluginDir of [path.join(notADir, 'plugins'), blocked]) syncOpenCodeAgents([profile], path.join(buildDir, 'agents-failed'), undefined, pluginDir);
    } finally { console.warn = warn; }
    assert.deepEqual(fs.readdirSync(path.join(buildDir, 'agents-failed')), ['aa-verify.md'], 'worker start still gets its agent file');
    assert.equal(warnings.length, 1, 'the failure is logged once: ' + warnings.join('|'));
    const owner = fs.mkdtempSync(path.join(buildDir, 'owner-'));
    const children = [];
    const spawner = (args) => { const child = new EventEmitter(); child.args = args; child.pid = 4100 + children.length; child.stdout = new PassThrough(); child.kill = () => true; children.push(child); return child; };
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir, spawner, setTimer: () => () => {}, now: () => 1_000_000 });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, owner);
    const worker = tools.get('worker');
    const started = JSON.parse((await worker.handler(worker.config.inputSchema.parse({ action: 'start', profile: 'verify', dispatchTurnId: 't1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true' }))).content[0].text);
    assert.equal(runtime.workerForSession('ses_W1'), undefined, 'no session known before the first event');
    children[0].stdout.write(`${JSON.stringify({ type: 'step_start', sessionID: 'ses_W1', part: {} })}\n`);
    await tick();
    const resolved = runtime.workerForSession('ses_W1');
    assert.equal(resolved.workerId, started.workerId);
    assert.equal(fs.realpathSync(resolved.workspace), fs.realpathSync(owner));
    assert.equal(runtime.workerForSession('ses_OTHER'), undefined);
    assert.equal(runtime.workerForSession(''), undefined);

    // 4. Server side: session -> worker caller. Known session fills the caller; unknown or failing resolver gives none and never throws.
    setAITalkSessionResolver((id) => runtime.workerForSession(id));
    assert.deepEqual({ ...mcpAITalkCaller({ _meta: { openCodeSessionId: 'ses_W1' } }) }, { recipient: started.workerId, workspace: resolved.workspace, displayName: undefined });
    assert.equal(mcpAITalkCaller({ _meta: { openCodeSessionId: 'ses_OTHER' } }), undefined);
    assert.equal(mcpAITalkCaller({ _meta: {} }), undefined);
    assert.equal(mcpAITalkCaller({}), undefined);
    setAITalkSessionResolver(() => { throw new Error('registry down'); });
    assert.equal(mcpAITalkCaller({ _meta: { openCodeSessionId: 'ses_W1' } }), undefined);
    assert.deepEqual({ ...mcpAITalkCaller({ _meta: { recipient: 'w-direct', workspacePath: owner } }) }, { recipient: 'w-direct', workspace: owner, displayName: undefined }, 'the existing _meta.recipient path is unchanged');
    setAITalkSessionResolver((id) => runtime.workerForSession(id));

    // 5. End to end through the registered MCP tool: the plugin's _meta in the args delivers the queued message to that worker only.
    configureAITalkDelivery(owner);
    const room = roomFor(owner); const store = new AITalkStore(owner);
    room.workerPost(started.workerId, 'Which branch?');
    const queued = room.userPost(`@${started.workerId} use main`).message;
    const handlers = new Map();
    registerToolDefinitions((name, config, handler) => handlers.set(name, { config, handler }), commentaryToolDefinitions(() => new CommentaryStore({ dir: path.join(buildDir, 'commentary') }), ''));
    const commentary = handlers.get('aitalk');
    assert.deepEqual(commentary.config.inputSchema.parse({ text: 'x', _meta: { openCodeSessionId: 's' } })._meta, { openCodeSessionId: 's' }, 'the host schema lets the identity through');
    // OpenCode's MCP client adds its own request _meta (e.g. a progress token); the identity in the args must survive it.
    const call = async (args) => (await commentary.handler({ ...args }, { _meta: { progressToken: 7 } })).content.map((part) => part.text).join('\n\n');
    const tick1 = () => store.snapshot(true).messages.find((message) => message.id === queued.id).tick;
    assert.equal(tick1(), 'sent');
    const stranger = await call({ action: 'post', kind: 'update', text: 'Step 1 of 3 is running now', _meta: { openCodeSessionId: 'ses_OTHER' } });
    assert.doesNotMatch(stranger, /use main/); assert.doesNotMatch(stranger, /ADDITIONAL MESSAGES/); assert.doesNotMatch(stranger, /ses_/);
    assert.equal(tick1(), 'sent', 'an unknown session is nobody: nothing is delivered');
    const first = await call({ action: 'post', kind: 'update', text: 'Step 2 of 3 is running now', _meta: { openCodeSessionId: 'ses_W1' } });
    assert.match(first, new RegExp(AITALK_QUEUE_LABEL.slice(0, 40))); assert.match(first, /use main/); assert.doesNotMatch(first, /ses_W1/, 'the session id never goes back to the model');
    assert.doesNotMatch(first, /REJECTED/, 'the worker workspace is filled in for the commentary line');
    assert.equal(tick1(), 'delivered');
    // A commentary update is itself a post to AITalk, so "not a response" is shown with a tool that posts nothing.
    const { z } = require('zod');
    registerToolDefinitions((name, config, handler) => handlers.set(name, { config, handler }), [{ name: 'ping', description: 'p', inputSchema: z.object({}), run: () => ({ status: 'ok' }) }]);
    const ping = async () => (await handlers.get('ping').handler({ _meta: { openCodeSessionId: 'ses_W1' } })).content.map((part) => part.text).join('\n\n');
    assert.doesNotMatch(await ping(), /use main/, 'popped once'); assert.doesNotMatch(await ping(), /ADDITIONAL MESSAGES/);
    assert.equal(tick1(), 'delivered', 'a later tool call is not a response');
    await call({ action: 'aitalk', text: 'Using main.', replyTo: queued.id, _meta: { openCodeSessionId: 'ses_W1' } });
    assert.equal(tick1(), 'read', 'the worker answered in AITalk');
    const reply = store.snapshot(true).messages.find((message) => message.replyTo === queued.id);
    assert.equal(reply.author, started.workerId, 'the worker posted as itself');

    // 6. Forgery: the model controls the arguments. The plugin replaces args._meta whole; the server reads only the session id from the arguments.
    const forged = { _meta: { recipient: 'w-B', workspacePath: owner, openCodeSessionId: 'ses_FORGED' }, text: 'x' };
    await before({ tool: 'askaway_ping', sessionID: 'ses_A', callID: 'c9' }, { args: forged });
    assert.deepEqual(forged._meta, { openCodeSessionId: 'ses_A' }, 'the plugin replaces a model-supplied _meta entirely');
    const other = 'w-B';
    room.workerPost(other, 'B here');
    const forA = room.userPost(`@${started.workerId} for A only`).message;
    const forB = room.userPost(`@${other} for B only`).message;
    const tickOf = (id) => store.snapshot(true).messages.find((message) => message.id === id).tick;
    const pingWith = async (args) => (await handlers.get('ping').handler(args)).content.map((part) => part.text).join('\n\n');
    setAITalkSessionResolver((id) => id === 'ses_A' ? { workerId: started.workerId, workspace: owner } : undefined);
    const withoutSession = await pingWith({ _meta: { recipient: other, workspacePath: owner } });
    assert.doesNotMatch(withoutSession, /for B only/); assert.doesNotMatch(withoutSession, /ADDITIONAL MESSAGES/);
    assert.equal(tickOf(forB.id), 'sent', 'a forged recipient with no session id yields no caller');
    assert.equal(tickOf(forA.id), 'sent');
    assert.equal(require(path.join(buildDir, 'aitalk', 'delivery.js')).callMeta({ _meta: { recipient: other, workspacePath: owner } }, undefined), undefined);
    const asA = await pingWith({ _meta: { recipient: other, workspacePath: owner, openCodeSessionId: 'ses_A' } });
    assert.match(asA, /for A only/); assert.doesNotMatch(asA, /for B only/, 'a forged recipient beside a real session id is ignored');
    assert.equal(tickOf(forA.id), 'delivered'); assert.equal(tickOf(forB.id), 'sent', 'worker B queue is untouched');
    const unknown = await pingWith({ _meta: { recipient: other, workspacePath: owner, openCodeSessionId: 'ses_unknown' } });
    assert.doesNotMatch(unknown, /for B only/, 'an unknown session never falls back to the forged recipient');
    assert.equal(tickOf(forB.id), 'sent');

    // 7. The real MCP server: a call carrying _meta.openCodeSessionId reaches the delivery wrapper for EVERY registered tool.
    const esbuild = require('esbuild');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const serverDir = fs.mkdtempSync(path.join(buildDir, 'server-'));
    const allWs = fs.mkdtempSync(path.join(buildDir, 'all-ws-'));
    const stubs = {
        vscode: 'exports.workspace = { workspaceFolders: [{ uri: { fsPath: ' + JSON.stringify(allWs) + ' } }], getConfiguration: () => ({ get: (key, fallback) => key === \'mcpPort\' ? 0 : key === \'autoRegisterMcp\' ? false : fallback }) }; exports.window = { showErrorMessage() {}, showInformationMessage() {} };',
        '../webview/webviewProvider': '',
        '../tools': 'exports.askUser = async () => ({});',
        '../utils/imageUtils': 'exports.getImageMimeType = () => undefined;',
        '../gradle/gradleEngine': 'exports.dispatchGradle = async () => ({ status: \'ok\' });',
        '../workers/openCodeRuntime': 'exports.OpenCodeWorkerRuntime = class {};',
        '../workers/workerHost': 'const runtime = { workerForSession: id => id === \'ses_all\' ? { workerId: globalThis.__allWorker, workspace: ' + JSON.stringify(allWs) + ' } : undefined, profiles: () => [], list: () => [] }; exports.observeWorkers = async () => {}; exports.onSharedServerAttached = () => {}; exports.sharedWorkerRuntime = () => runtime; exports.sharedWorkerRuntimeReady = async () => runtime; exports.sharedCommentaryStore = () => globalThis.__allCommentary; exports.restartSharedServer = async () => {};',
        '../workers/workersState': 'exports.cancelQueuedRun = () => {}; exports.loadWorkerTrace = () => {}; exports.projectWorkersState = () => ({});',
        '../workers/vscodeToolBridge': 'const { z } = require(\'zod\'); exports.registerVsCodeToolBridge = register => register(\'bridge_probe\', { description: \'bridge\', inputSchema: z.object({ path: z.string() }) }, async () => ({ content: [{ type: \'text\', text: \'bridge ok\' }] })); exports.registerWindow = () => {};',
        '../workers/evalScoreboard': 'exports.loadEvalScoreboard = () => ({});',
    };
    const bundle = path.join(serverDir, 'server.cjs');
    await esbuild.build({ stdin: { contents: "export { McpServerManager } from '../../src/mcp/mcpServer'; export { roomFor, WorkerActor } from '../../src/aitalk/actors'; export { AITalkStore } from '../../src/aitalk/store'; export { CommentaryStore } from '../../src/commentary/commentary';", resolveDir: serverDir, loader: 'ts' },
        outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error',
        plugins: [{ name: 'host-fixture', setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'host-fixture' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'host-fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js', resolveDir: __dirname }));
        } }] });
    const server = require(bundle);
    globalThis.__allCommentary = new server.CommentaryStore({ dir: path.join(serverDir, 'commentary') });
    globalThis.__allWorker = 'w-all';
    const allRoom = server.roomFor(allWs); const allStore = new server.AITalkStore(allWs);
    allRoom.register(new server.WorkerActor({ id: 'w-all', displayName: 'All tools', kind: 'worker', rank: 100 }));
    const probe = (name) => ({ name, description: name, inputSchema: z.object({ q: z.string() }), run: async () => ({ status: 'ok' }) });
    const manager = new server.McpServerManager(new Proxy({}, { get: () => () => {} }), probe('memory_probe'), [probe('webex_probe')]);
    const client = new Client({ name: 'opencode-worker', version: '1.0.0' });
    try {
        await manager.start();
        await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + manager.getPort() + '/sse')));
        const listed = (await client.listTools()).tools;
        for (const expected of ['gradle', 'worker', 'aitalk', 'memory_probe', 'webex_probe', 'bridge_probe']) assert.ok(listed.some((tool) => tool.name === expected), expected + ' is registered');
        const fill = (schema) => {
            if (schema?.enum) return schema.enum[0];
            if (schema?.type === 'number' || schema?.type === 'integer') return 1;
            if (schema?.type === 'boolean') return true;
            if (schema?.type === 'array') return [];
            if (schema?.type === 'object') return {};
            return 'x';
        };
        const overrides = { worker: { action: 'profiles' }, commentary: { action: 'post', kind: 'update', text: 'Working on it now' } };
        for (const tool of listed) {
            const args = Object.fromEntries((tool.inputSchema.required ?? []).map((key) => [key, fill(tool.inputSchema.properties?.[key])]));
            const queued = allRoom.userPost('@w-all queued for ' + tool.name).message;
            const response = await client.callTool({ name: tool.name, arguments: { ...args, ...overrides[tool.name], _meta: { openCodeSessionId: 'ses_all' } } });
            const text = (response.content ?? []).map((part) => part.text).join('\n\n');
            assert.match(text, /ADDITIONAL MESSAGES FROM THE USER/, tool.name + ' delivered the queue to the worker behind the session id: ' + text.slice(0, 200));
            assert.match(text, new RegExp('queued for ' + tool.name));
            assert.doesNotMatch(text, /ses_all/, tool.name + ': the session id never reaches the model');
            assert.equal(allStore.snapshot(true).messages.find((message) => message.id === queued.id).tick, 'delivered');
        }
        const forgedCall = await client.callTool({ name: 'gradle', arguments: { action: 'status', _meta: { recipient: 'w-all', workspacePath: allWs } } });
        const afterForged = allRoom.userPost('@w-all must wait').message;
        assert.doesNotMatch((forgedCall.content ?? []).map((part) => part.text).join(''), /ADDITIONAL MESSAGES/, 'a forged recipient in the arguments delivers nothing');
        assert.equal(allStore.snapshot(true).messages.find((message) => message.id === afterForged.id).tick, 'sent');
    } finally {
        await client.close();
        if (manager.server) await new Promise((resolve) => manager.server.close(resolve));
    }
    console.log('PASS EV-OPENCODE-IDENTITY-PLUGIN plugin tags askaway_ tools only; idempotent atomic write; session -> worker registry; queued AITalk reaches the worker; unknown session is nobody; forged _meta in args never selects a worker; every registered tool delivers on a session id');
})().catch((error) => { console.error(error); process.exitCode = 1; });
