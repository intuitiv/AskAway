// EV-WORKER-IDENTITY-AGY-CLAUDE (R-AITALK-46, R-AITALK-47): agy and Claude workers are identified by transport carriers the model cannot set,
// like OpenCode workers by the plugin. agy sends MCP `params._meta['antigravity.google/conversation_id']` on every tool call (it equals the
// conversation id of agy's `init` event); Claude carries a per-run `X-AskAway-Run` header from its --mcp-config. Driven from the caller's side:
// the real OpenCodeWorkerRuntime starts an agy and a Claude worker on a fake spawner, and a real MCP client talks to the real McpServerManager
// over HTTP. A queued AITalk message reaches the worker once on its next tool call; a forged identity in the arguments is ignored; workers
// post only questions (R-AITALK-45), attributed to themselves; a carrier no worker owns is never the main agent.
// Run: node test-worker-identity-agy-claude.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { transpileSrc } = require('./tools/transpile-src.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-agy-claude-'));
// The transpiled sources resolve node_modules from inside the package, so the build dir lives here (gitignored: /.*-build/).
const buildDir = path.join(__dirname, '.identity-agy-claude-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
transpileSrc(buildDir, ['workers', 'team', 'aitalk', 'commentary']);
const load = (...parts) => require(path.join(buildDir, ...parts));
const { parseWorkerProfile } = load('workers', 'workerProfiles.js');
const { OpenCodeWorkerRuntime } = load('workers', 'openCodeRuntime.js');
const { registerWorkerTools } = load('workers', 'workerTools.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const AGY_KEY = 'antigravity.google/conversation_id';
const text = (response) => (response.content ?? []).map((part) => part.text).join('\n\n');
(async () => {
    const ws = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'ws-')));
    const profileText = (name) => `---\nname: ${name}\ndescription: "d"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: deny\nbash: deny\nmcp: [askaway_askaway_memory, askaway_commentary]\n---\nBody.\n`;
    const children = [];
    const spawner = (args) => { const child = new EventEmitter(); child.args = args; child.pid = 5100 + children.length; child.stdout = new PassThrough(); child.kill = () => true; children.push(child); return child; };
    const runtime = new OpenCodeWorkerRuntime([parseWorkerProfile(profileText('buildagy')), parseWorkerProfile(profileText('buildclaude'))],
        { ledgerDir: path.join(tmp, 'ledger'), spawner, setTimer: () => () => {}, claudeMcpUrl: () => 'http://localhost:1/sse', agyVerifyLoop: false });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, ws);
    const worker = tools.get('worker');
    const start = async (packet) => JSON.parse((await worker.handler(worker.config.inputSchema.parse({ action: 'start', dispatchTurnId: 't1', baseRevision: 'abc', objective: 'Check', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'true', ...packet }))).content[0].text);
    const out = (child, event) => child.stdout.write(`${JSON.stringify(event)}\n`);

    // 1. Runtime: an agy worker is known by its init conversation id, a Claude worker by the run token in its launch arguments.
    const agyWorker = await start({ profile: 'buildagy', runtime: 'agy', model: 'gemini-4-argon-medium' });
    assert.equal(agyWorker.workerId?.length > 0, true, JSON.stringify(agyWorker));
    const claudeWorker = await start({ profile: 'buildclaude', runtime: 'claude', model: 'sonnet' });
    assert.ok(claudeWorker.workerId, JSON.stringify(claudeWorker));
    const [agyChild, claudeChild] = children;
    const claudeArg = (flag) => (claudeChild.args.find((a) => a.startsWith(`${flag}=`)) || '').slice(flag.length + 1);
    // The config is inline JSON or a private file (the launcher keeps the token out of argv): read it either way.
    const mcpConfig = claudeArg('--mcp-config');
    const token = JSON.parse(mcpConfig.startsWith('{') ? mcpConfig : fs.readFileSync(mcpConfig, 'utf8')).mcpServers.askaway.headers['X-AskAway-Run'];
    assert.match(token, /^[0-9a-f]{48}$/);
    assert.ok(claudeChild.args.some((a) => a.startsWith('--allowedTools=') && a.includes('mcp__askaway__commentary')), 'a Claude worker may call commentary');
    assert.equal(runtime.workerForAgyConversation('conv-agy-1'), undefined, 'unknown before the init event');
    out(agyChild, { event: 'init', conversation_id: 'conv-agy-1', init: { model: 'x', cwd: ws } });
    out(claudeChild, { type: 'system', subtype: 'init', session_id: 'sess-claude-1', cwd: ws });
    await tick();
    assert.equal(runtime.workerForAgyConversation('conv-agy-1')?.workerId, agyWorker.workerId);
    assert.equal(runtime.workerForRunToken(token)?.workerId, claudeWorker.workerId);
    assert.equal(fs.realpathSync(runtime.workerForRunToken(token).workspace), ws);
    assert.equal(runtime.workerForAgyConversation('sess-claude-1'), undefined, 'a Claude session is not an agy conversation');
    assert.equal(runtime.workerForRunToken('conv-agy-1'), undefined);
    assert.equal(runtime.workerForRunToken(''), undefined);

    // 2. The real MCP server with the real runtime behind it.
    const esbuild = require('esbuild');
    const { z } = require('zod');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const stubs = {
        vscode: 'exports.workspace = { workspaceFolders: [{ uri: { fsPath: ' + JSON.stringify(ws) + ' } }], getConfiguration: () => ({ get: (key, fallback) => key === \'mcpPort\' ? 0 : key === \'autoRegisterMcp\' ? false : fallback }) }; exports.window = { showErrorMessage() {}, showInformationMessage() {} };',
        '../webview/webviewProvider': '',
        '../tools': 'exports.askUser = async () => ({});',
        '../utils/imageUtils': 'exports.getImageMimeType = () => undefined;',
        '../gradle/gradleEngine': 'exports.dispatchGradle = async () => ({ status: \'ok\' });',
        '../workers/openCodeRuntime': 'exports.OpenCodeWorkerRuntime = class {};',
        '../workers/workerHost': 'const rt = () => globalThis.__runtime; const runtime = { workerForSession: id => rt().workerForSession(id), workerForAgyConversation: id => rt().workerForAgyConversation(id), workerForRunToken: id => rt().workerForRunToken(id), profiles: () => [], list: () => [] }; exports.observeWorkers = async () => {}; exports.onSharedServerAttached = () => {}; exports.sharedWorkerRuntime = () => runtime; exports.sharedWorkerRuntimeReady = async () => runtime; exports.sharedCommentaryStore = () => globalThis.__commentary; exports.restartSharedServer = async () => {};',
        '../workers/workersState': 'exports.cancelQueuedRun = () => {}; exports.loadWorkerTrace = () => {}; exports.projectWorkersState = () => ({});',
        '../workers/vscodeToolBridge': 'exports.registerVsCodeToolBridge = () => {}; exports.registerWindow = () => {};',
        '../workers/evalScoreboard': 'exports.loadEvalScoreboard = () => ({});',
    };
    const bundle = path.join(buildDir, 'server.cjs');
    await esbuild.build({ stdin: { contents: "export { McpServerManager } from './src/mcp/mcpServer'; export { roomFor, WorkerActor } from './src/aitalk/actors'; export { AITalkStore } from './src/aitalk/store'; export { configureAITalkDelivery } from './src/aitalk/delivery'; export { CommentaryStore } from './src/commentary/commentary';", resolveDir: __dirname, loader: 'ts' },
        outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error',
        plugins: [{ name: 'host-fixture', setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'host-fixture' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'host-fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js', resolveDir: __dirname }));
        } }] });
    const server = require(bundle);
    globalThis.__runtime = runtime;
    globalThis.__commentary = new server.CommentaryStore({ dir: path.join(tmp, 'commentary') });
    server.configureAITalkDelivery(ws);
    const room = server.roomFor(ws); const store = new server.AITalkStore(ws);
    room.registerAgent();
    const agentId = store.snapshot(true).members.find((member) => member.kind === 'agent').id;
    // Each worker is its own roster member (two worker-* ids would otherwise both resolve to Diego and share @-mentions).
    for (const [id, name, memberId] of [[agyWorker.workerId, 'Agy worker', 'diego'], [claudeWorker.workerId, 'Claude worker', 'tara']]) room.register(new server.WorkerActor({ id, displayName: name, memberId, kind: 'worker', rank: 100 }));
    const probe = { name: 'memory_probe', description: 'probe', inputSchema: z.object({ q: z.string() }), run: async () => ({ status: 'ok' }) };
    const manager = new server.McpServerManager(new Proxy({}, { get: () => () => {} }), probe, []);
    const url = () => new URL('http://127.0.0.1:' + manager.getPort() + '/sse');
    const clients = [];
    const connect = async (headers) => { const client = new Client({ name: 'x', version: '1.0.0' }); await client.connect(new StreamableHTTPClientTransport(url(), headers ? { requestInit: { headers } } : undefined)); clients.push(client); return client; };
    const tickOf = (id) => store.snapshot(true).messages.find((message) => message.id === id).tick;
    const queueFor = (id, what) => room.userPost(`@${id} ${what}`).message;
    const ping = (client, extraArgs = {}, meta) => client.callTool({ name: 'memory_probe', arguments: { q: 'x', ...extraArgs }, ...(meta ? { _meta: meta } : {}) }).then(text);
    const commentary = (client, args, meta) => client.callTool({ name: 'commentary', arguments: args, ...(meta ? { _meta: meta } : {}) }).then(text);
    const posted = (needle) => store.snapshot(true).messages.find((message) => message.text.includes(needle));
    try {
        await manager.start();
        const agy = await connect(); // agy: identity rides in the call's own _meta
        const claude = await connect({ 'X-AskAway-Run': token });
        const main = await connect();
        const agyMeta = (id = 'conv-agy-1') => ({ [AGY_KEY]: id, 'antigravity.google/root_conversation_id': id });

        // R-AITALK-47: a queued message reaches the agy worker, once, on its next tool call; the carrier never goes back to the model.
        const forAgy = queueFor(agyWorker.workerId, 'agy: use the main branch');
        const forClaude = queueFor(claudeWorker.workerId, 'claude: use the main branch');
        const agyFirst = await ping(agy, {}, agyMeta());
        assert.match(agyFirst, /ADDITIONAL MESSAGES FROM THE USER/); assert.match(agyFirst, /agy: use the main branch/);
        assert.doesNotMatch(agyFirst, /claude: use the main branch/, 'only the caller\'s own queue');
        assert.doesNotMatch(agyFirst, /conv-agy-1/);
        assert.equal(tickOf(forAgy.id), 'delivered'); assert.equal(tickOf(forClaude.id), 'sent');
        assert.doesNotMatch(await ping(agy, {}, agyMeta()), /ADDITIONAL MESSAGES/, 'popped once');
        const claudeFirst = await ping(claude);
        assert.match(claudeFirst, /ADDITIONAL MESSAGES FROM THE USER/); assert.match(claudeFirst, /claude: use the main branch/);
        assert.doesNotMatch(claudeFirst, new RegExp(token));
        assert.equal(tickOf(forClaude.id), 'delivered');
        assert.doesNotMatch(await ping(claude), /ADDITIONAL MESSAGES/, 'popped once');
        // The same holds for a tool that is not the probe (the worker's own commentary tool): every registered tool delivers.
        const secondAgy = queueFor(agyWorker.workerId, 'agy: second message');
        assert.match(await commentary(agy, { action: 'post', kind: 'update', text: 'Checking the branch now' }, agyMeta()), /agy: second message/);
        assert.equal(tickOf(secondAgy.id), 'delivered');
        console.log('PASS R-AITALK-47 queued message reaches an agy and a Claude worker once on the next tool call');

        // R-AITALK-46: forged identities in the arguments are ignored.
        const stillForAgy = queueFor(agyWorker.workerId, 'agy: after forgery');
        const stillForClaude = queueFor(claudeWorker.workerId, 'claude: after forgery');
        const forgedByMain = await ping(main, { _meta: { [AGY_KEY]: 'conv-agy-1', agyConversationId: 'conv-agy-1', 'x-askaway-run': token, askawayRunToken: token, recipient: agyWorker.workerId, workspacePath: ws } });
        assert.doesNotMatch(forgedByMain, /after forgery/); assert.doesNotMatch(forgedByMain, /ADDITIONAL MESSAGES/);
        assert.equal(tickOf(stillForAgy.id), 'sent', 'a conversation id in the arguments selects no worker'); assert.equal(tickOf(stillForClaude.id), 'sent', 'a run token in the arguments selects no worker');
        const claudeForgingAgy = await ping(claude, { _meta: { [AGY_KEY]: 'conv-agy-1', agyConversationId: 'conv-agy-1', openCodeSessionId: 'conv-agy-1', recipient: agyWorker.workerId } });
        assert.match(claudeForgingAgy, /claude: after forgery/); assert.doesNotMatch(claudeForgingAgy, /agy: after forgery/, 'a Claude worker cannot read the agy worker\'s queue');
        assert.equal(tickOf(stillForAgy.id), 'sent');
        const agyForgingSession = await ping(agy, { _meta: { openCodeSessionId: 'sess-claude-1', agyConversationId: 'conv-other', askawayRunToken: token } }, agyMeta());
        assert.match(agyForgingSession, /agy: after forgery/, 'the transport identity outranks a session id in the arguments');
        assert.equal(tickOf(stillForAgy.id), 'delivered');
        const mainOwn = room.userPost(`@${agentId} for the main agent`).message;
        assert.doesNotMatch(await ping(agy, {}, agyMeta()), /for the main agent/); assert.equal(tickOf(mainOwn.id), 'sent', 'a worker never pops the main agent\'s queue');
        console.log('PASS R-AITALK-46 forged args._meta (conversation id, run token, session id) is ignored; the transport carrier decides');

        // R-AITALK-45: an identified agy / Claude worker posts only questions, attributed to itself.
        for (const [who, client, meta, workerId] of [['agy', agy, agyMeta(), agyWorker.workerId], ['claude', claude, undefined, claudeWorker.workerId]]) {
            const update = JSON.parse((await commentary(client, { action: 'aitalk', kind: 'update', text: `${who} halfway through the edit` }, meta)).split('\n\n')[0]);
            assert.equal(update.status, 'REJECTED', who); assert.match(update.reason, /only questions/);
            assert.equal(posted(`${who} halfway through the edit`), undefined, `${who}: the update is not posted`);
            const question = JSON.parse((await commentary(client, { action: 'aitalk', kind: 'heads-up', waitSeconds: 0, text: `${who}: may I rebase onto main?` }, meta)).split('\n\n')[0]);
            assert.notEqual(question.status, 'REJECTED', who + ': ' + JSON.stringify(question));
            assert.equal(posted(`${who}: may I rebase onto main?`)?.author, workerId, `${who}: the question is attributed to the member, not the main agent`);
        }
        console.log('PASS R-AITALK-45 agy and Claude workers post only questions, as themselves');

        // A carrier no worker owns is nobody: not the main agent. Nothing is delivered, nothing is posted, the main agent's queue stays.
        const mainQueued = room.userPost(`@${agentId} main agent queue`).message;
        const unknownAgy = await connect();
        const unknownToken = await connect({ 'X-AskAway-Run': 'f'.repeat(48) });
        for (const [who, client, meta] of [['unknown agy conversation', unknownAgy, agyMeta('conv-nobody')], ['unknown Claude token', unknownToken, undefined]]) {
            assert.doesNotMatch(await ping(client, {}, meta), /ADDITIONAL MESSAGES/, who);
            assert.equal(tickOf(mainQueued.id), 'sent', `${who} did not pop the main agent's queue`);
            for (const kind of ['update', 'heads-up']) {
                const result = JSON.parse((await commentary(client, { action: 'aitalk', kind, waitSeconds: 0, text: `${who} ${kind} post` }, meta)).split('\n\n')[0]);
                assert.equal(result.status, 'REJECTED', `${who} ${kind}: ${JSON.stringify(result)}`);
                assert.equal(posted(`${who} ${kind} post`), undefined, `${who} never posts to AITalk, least of all as the main agent`);
            }
        }
        // A Claude run that ended no longer holds its token: its header is now an unknown token.
        claudeChild.emit('exit', 0, null);
        await tick();
        assert.equal(runtime.workerForRunToken(token), undefined, 'the token is dropped when the run ends');
        const afterExit = await ping(claude);
        assert.doesNotMatch(afterExit, /ADDITIONAL MESSAGES/); assert.equal(tickOf(mainQueued.id), 'sent');
        // The main agent's queue is still whole (its own hooks deliver it), and the main agent (no carrier) still posts updates.
        assert.deepEqual(store.takeForTool(agentId).map((message) => message.text), [`@${agentId} for the main agent`, `@${agentId} main agent queue`]);
        const mainUpdate = JSON.parse((await commentary(main, { action: 'aitalk', kind: 'update', text: 'Main agent update still posts', workspacePath: ws })).split('\n\n')[0]);
        assert.notEqual(mainUpdate.status, 'REJECTED', JSON.stringify(mainUpdate));
        assert.equal(posted('Main agent update still posts')?.author, agentId);
        console.log('PASS unresolved carriers are unidentified, never the main agent; the main agent is unchanged');
    } finally {
        await Promise.all(clients.map((client) => client.close().catch(() => {})));
        if (manager.server) await new Promise((resolve) => manager.server.close(resolve));
    }
    console.log('PASS EV-WORKER-IDENTITY-AGY-CLAUDE agy conversation id and Claude run token identify workers; queued AITalk messages are delivered once; forged args._meta is ignored; update posts refused, questions attributed; unknown carriers are not the main agent');
    fs.rmSync(buildDir, { recursive: true, force: true });
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
