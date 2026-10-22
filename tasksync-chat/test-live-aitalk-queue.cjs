#!/usr/bin/env node
'use strict';
/**
 * LIVE end-to-end test of Spec 003 A3 queued delivery. Needs network, a GitHub Copilot sign-in in OpenCode, and optionally the agy CLI.
 * NOT part of test:workers. Run: npm run test:live-aitalk   (env LIVE_AITALK_STRICT=1 also fails on A3-expected assertions,
 * LIVE_AITALK_ONLY=S1,S3 picks scenarios, LIVE_AITALK_RUNTIMES=opencode|agy|opencode,agy, LIVE_AITALK_KEEP=1 keeps the temp workspace).
 *
 * What is real: the AskAway MCP server (src/mcp/mcpServer.ts + withAITalkMcpDelivery), the AITalk room/store/actors, the
 * commentary tool, the Validator actor, and a real cheap model driving them through `opencode run` (github-copilot/gpt-6-luna,
 * thinking low) or `agy` (gemini-4-argon-low).
 * What is mocked: only the 'vscode' module and the host-only modules the existing MCP test already stubs (workers runtime, gradle, webview).
 * Worker identity: real OpenCode workers send no `_meta`. The REAL AskAway OpenCode plugin (src/workers/openCodeIdentityPlugin.ts, written into the
 * isolated config by syncOpenCodeIdentityPlugin exactly as the runtime does) adds `_meta.openCodeSessionId` to every askaway_* call, and the server
 * resolves that session to the worker through setAITalkSessionResolver. The registry entry (session -> worker) is filled lazily from the first
 * JSON event of `opencode run`, the same way the runtime learns a worker's session (OpenCodeWorkerRuntime.sessionsByWorker).
 * A pass-through proxy in front of the MCP server only OBSERVES: it records each tools/call and lets the test act "while the call is in flight";
 * it injects nothing (no _meta, no workspacePath).
 * Isolation: OpenCode gets its own config file (OPENCODE_CONFIG) and an empty XDG_CONFIG_HOME holding the plugin; ~/.config/opencode is untouched.
 * agy has only a global MCP config and no plugin mechanism here, so a uniquely named server is added with `agy mcp add` and removed afterwards; it
 * has no worker identity (it needs the A3 claude/agy path), so agy scenarios are informational.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const esbuild = require('esbuild');

const MODEL = process.env.LIVE_AITALK_MODEL || 'github-copilot/gpt-6-luna';
const AGY_MODEL = process.env.LIVE_AITALK_AGY_MODEL || 'gemini-4-argon-low';
const SCENARIO_TIMEOUT_MS = 120_000;
const MAX_STEPS = 15;
const STRICT = process.env.LIVE_AITALK_STRICT === '1';
const ONLY = (process.env.LIVE_AITALK_ONLY || '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
const RUNTIMES = (process.env.LIVE_AITALK_RUNTIMES || 'opencode').split(',').map(item => item.trim());
const FIXTURES = path.join(__dirname, 'test-live', 'aitalk');
const scenarios = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scenarios.json'), 'utf8'));
const OLD_LABEL = /AITalk addressed messages \(user instructions take priority\):/;
const NEW_LABEL = /ADDITIONAL MESSAGES FROM THE USER/;
const runDir = path.join(FIXTURES, `ws-${crypto.randomBytes(4).toString('hex')}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const short = (text, n = 320) => { const one = String(text ?? '').replace(/\s+/g, ' ').trim(); return one.length > n ? `${one.slice(0, n)}…` : one; };
const children = new Set();
const killAll = () => { for (const child of children) { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', killAll);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { killAll(); process.exit(130); });

let lib, mcp, proxy, proxyPort, active = null;
const results = [];
const costs = [];

// ---- real server ------------------------------------------------------------------------------------------------------
async function buildServer() {
    fs.mkdirSync(runDir, { recursive: true });
    const stubs = {
        vscode: `exports.workspace = { workspaceFolders: [{ uri: { fsPath: ${JSON.stringify(runDir)} } }], getConfiguration: () => ({ get: (key, fallback) => key === 'mcpPort' ? 0 : key === 'autoRegisterMcp' ? false : fallback }) }; exports.window = { showErrorMessage() {}, showInformationMessage() {} };`,
        '../webview/webviewProvider': '',
        '../tools': 'exports.askUser = async () => ({});',
        '../utils/imageUtils': 'exports.getImageMimeType = () => undefined;',
        '../gradle/gradleEngine': 'exports.dispatchGradle = async () => ({});',
        '../workers/openCodeRuntime': 'exports.OpenCodeWorkerRuntime = class {};',
        '../workers/workerHost': 'exports.observeWorkers = async () => {}; exports.onSharedServerAttached = () => {}; exports.sharedWorkerRuntime = () => ({}); exports.sharedWorkerRuntimeReady = async () => ({}); exports.sharedCommentaryStore = () => globalThis.__liveCommentaryStore; exports.restartSharedServer = async () => {};',
        '../workers/workersState': 'exports.cancelQueuedRun = () => {}; exports.loadWorkerTrace = () => {}; exports.projectWorkersState = () => ({});',
        '../workers/vscodeToolBridge': 'exports.registerVsCodeToolBridge = () => {}; exports.registerWindow = () => {};',
        '../workers/evalScoreboard': 'exports.loadEvalScoreboard = () => ({});',
    };
    const entry = `export { McpServerManager } from './src/mcp/mcpServer';
export { configureAITalkDelivery, setAITalkSessionResolver, setAITalkAgyResolver, setAITalkRunTokenResolver } from './src/aitalk/delivery';
export { claudeArgs } from './src/workers/claudeRuntime';
export { syncOpenCodeIdentityPlugin } from './src/workers/openCodeIdentityPlugin';
export { roomFor, WorkerActor } from './src/aitalk/actors';
export { AITalkStore } from './src/aitalk/store';
export { registerAITalkValidator } from './src/aitalk/validatorDelivery';
export { CommentaryStore } from './src/commentary/commentary';`;
    const outfile = path.join(runDir, 'bundle.cjs');
    await esbuild.build({ stdin: { contents: entry, resolveDir: __dirname, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error',
        plugins: [{ name: 'host-fixture', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'host-fixture' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'host-fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
        } }] });
    lib = createRequire(outfile)(outfile);
    globalThis.__liveCommentaryStore = new lib.CommentaryStore({ dir: path.join(runDir, 'commentary') });
    lib.configureAITalkDelivery(runDir);
    mcp = new lib.McpServerManager(new Proxy({}, { get: () => () => {} }));
    await mcp.start();
    if (!mcp.isRunning()) throw new Error('MCP server did not start');
    // The runtime's session registry (session id -> worker) is stubbed with a lazily filled map; the resolver hook is the real one.
    lib.setAITalkSessionResolver(sessionId => sessions.get(sessionId));
}
const sessions = new Map();

// ---- proxy: only observes. Records every tools/call and runs the scenario hook before the model sees the result. Injects nothing.
function parseResult(buffer) {
    const text = buffer.toString('utf8');
    const bodies = /^data:/m.test(text) ? text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()) : [text];
    const parts = [];
    for (const body of bodies) {
        try { for (const item of [].concat(JSON.parse(body))) for (const part of item?.result?.content ?? []) if (part.type === 'text') parts.push(part.text); } catch { /* not JSON */ }
    }
    return parts;
}
async function startProxy() {
    proxy = http.createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks); const ctx = active; const calls = [];
        if (req.method === 'POST' && ctx && body.length) {
            try {
                for (const message of [].concat(JSON.parse(body.toString('utf8')))) if (message.method === 'tools/call') calls.push(message);
            } catch { /* forward untouched */ }
        }
        const headers = { ...req.headers, 'content-length': String(body.length), 'accept-encoding': 'identity', host: `127.0.0.1:${mcp.getPort()}` };
        const upstream = http.request({ host: '127.0.0.1', port: mcp.getPort(), path: req.url, method: req.method, headers }, async response => {
            const out = []; for await (const chunk of response) out.push(chunk);
            const payload = Buffer.concat(out);
            try {
                for (const message of calls) {
                    const parts = parseResult(payload);
                    const { _meta: identity, ...args } = message.params.arguments ?? {};
                    const call = { index: ctx.calls.length + 1, name: message.params.name, args, identity, transportIdentity: message.params._meta, runIdentityMatches: req.headers['x-askaway-run'] === ctx.runToken, parts, text: parts.join('\n\n'),
                        at: Date.now(), ticksBefore: ctx.requestTicks.get(message.id) ?? {}, ticksAfter: ctx.tickNow() };
                    ctx.calls.push(call);
                    ctx.log(`call ${call.index} ${call.name} returned`);
                    if (ctx.onResult) await ctx.onResult(call);
                }
            } catch (error) { ctx?.fail(`proxy hook crashed: ${error.stack || error}`); }
            const { 'content-length': _l, 'content-encoding': _e, 'transfer-encoding': _t, ...rest } = response.headers;
            res.writeHead(response.statusCode ?? 500, { ...rest, 'content-length': String(payload.length) });
            res.end(payload);
        });
        upstream.on('error', error => { res.writeHead(502); res.end(String(error)); });
        for (const message of calls) { ctx.requestTicks.set(message.id, ctx.tickNow()); ctx.log(`call ${ctx.calls.length + 1} ${message.params.name} requested`); }
        upstream.end(body);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    proxyPort = proxy.address().port;
}

// ---- scenario context: fresh workspace, fresh room, fresh recipient, tick timeline ----------------------------------------
function newCtx(key, runtime) {
    const rand = crypto.randomBytes(3).toString('hex');
    const ws = path.join(runDir, `${key.toLowerCase()}-${runtime}-${rand}`);
    fs.mkdirSync(ws, { recursive: true });
    const recipient = `w-live-${key.toLowerCase()}-${rand}`;
    const room = lib.roomFor(ws); const store = new lib.AITalkStore(ws);
    room.register(new lib.WorkerActor({ id: recipient, displayName: `Live ${key}`, kind: 'worker', rank: 100 }));
    const t0 = Date.now();
    const ctx = { key, runtime, ws, recipient, room, store, t0, calls: [], timeline: new Map(), events: [], asserts: [], requestTicks: new Map(), onResult: null, cost: { usd: 0, tokens: 0, steps: 0 },
        rel: (at = Date.now()) => `+${((at - t0) / 1000).toFixed(1)}s`,
        tickNow() { const out = {}; for (const message of store.snapshot(true).messages) if (message.tick) out[message.id] = message.tick; return out; },
        log(text) { ctx.events.push(`${ctx.rel()} ${text}`); },
        fail(text) { ctx.asserts.push({ name: text, ok: false, a3: false }); },
        check(name, ok, detail = '', a3 = false) { ctx.asserts.push({ name, ok: Boolean(ok), detail: ok ? '' : detail, a3 }); },
        tickAt(id, call, when = 'ticksAfter') { return call?.[when]?.[id]; } };
    const poll = setInterval(() => {
        for (const [id, tick] of Object.entries(ctx.tickNow())) {
            const seen = ctx.timeline.get(id) ?? [];
            if (seen.at(-1)?.tick !== tick) { seen.push({ tick, at: Date.now() }); ctx.timeline.set(id, seen); }
        }
    }, 50);
    ctx.stop = () => clearInterval(poll);
    return ctx;
}
const label = text => NEW_LABEL.test(text) ? 'NEW' : OLD_LABEL.test(text) ? 'OLD' : '';
function deliveredEntries(call) {
    const part = call?.parts.find(item => NEW_LABEL.test(item) || OLD_LABEL.test(item)); if (!part) return [];
    const from = part.indexOf('[', part.search(NEW_LABEL.test(part) ? NEW_LABEL : OLD_LABEL)); const to = part.lastIndexOf(']');
    try { return JSON.parse(part.slice(from, to + 1)); } catch { return []; }
}
const delivers = call => call.parts.some(part => NEW_LABEL.test(part) || OLD_LABEL.test(part));
const tickWord = tick => tick === 'posted' ? 'sent' : tick;

// ---- model runners ---------------------------------------------------------------------------------------------------------
function configFor(ctx, url, model) {
    const raw = fs.readFileSync(path.join(FIXTURES, 'opencode.template.json'), 'utf8').replace('{{MCP_URL}}', url ?? '').replace('{{MODEL}}', model);
    const config = JSON.parse(raw);
    if (!url) { delete config.mcp; config.permission = { '*': 'deny' }; }
    fs.mkdirSync(path.join(ctx.ws, 'xdg', 'opencode'), { recursive: true });
    // The same call the runtime makes for ~/.config/opencode/plugins, pointed at the isolated config.
    lib.syncOpenCodeIdentityPlugin(path.join(ctx.ws, 'xdg', 'opencode', 'plugins'));
    const file = path.join(ctx.ws, 'opencode.live.json'); fs.writeFileSync(file, JSON.stringify(config, null, 2));
    return file;
}
function runProcess(ctx, command, args, options, onLine) {
    return new Promise(resolve => {
        const child = spawn(command, args, { cwd: ctx.ws, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        children.add(child);
        const state = { exit: null, timedOut: false, stoppedByCap: false, stderr: '' };
        let buffer = '';
        const timer = setTimeout(() => { state.timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000); }, SCENARIO_TIMEOUT_MS);
        child.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) { if (onLine(line, state) === 'stop') { state.stoppedByCap = true; child.kill('SIGTERM'); } } });
        child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-1500); });
        child.on('error', error => { state.stderr += String(error); });
        child.on('close', code => { clearTimeout(timer); children.delete(child); if (buffer) onLine(buffer, state); state.exit = code; resolve(state); });
    });
}
async function runOpenCode(ctx, prompt, mcpUrl) {
    const cfg = configFor(ctx, mcpUrl, MODEL);
    const env = { ...process.env, OPENCODE_CONFIG: cfg, XDG_CONFIG_HOME: path.join(ctx.ws, 'xdg') };
    const answer = { text: '', afterTool: '' };
    const state = await runProcess(ctx, 'opencode', ['run', '--print-logs', '--log-level', 'ERROR', '--format', 'json', '--agent', 'live', '--model', MODEL, '--variant', 'low', '--dir', ctx.ws, '--title', `live/${ctx.key}`, prompt], { env }, (line, st) => {
        let event; try { event = JSON.parse(line); } catch { return; }
        // The runtime learns a worker's session from the first event that names it; the registry entry is made the same way.
        if (mcpUrl && event.sessionID && !sessions.has(event.sessionID)) { sessions.set(event.sessionID, { workerId: ctx.recipient, workspace: ctx.ws }); ctx.log('session registered to the worker'); }
        if (event.type === 'text') { answer.afterTool += event.part?.text ?? ''; answer.text += event.part?.text ?? ''; }
        if (event.type === 'tool_use') answer.afterTool = '';
        if (event.type === 'step_finish') {
            ctx.cost.steps++; ctx.cost.usd += event.part?.cost ?? 0; ctx.cost.tokens += event.part?.tokens?.total ?? 0;
            if (ctx.cost.steps >= MAX_STEPS && event.part?.reason !== 'stop') { st.stopped = true; return 'stop'; }
        }
    });
    return { ...state, final: (answer.afterTool || answer.text).trim() };
}
async function runAgy(ctx, prompt) {
    let final = ''; const denied = [];
    const state = await runProcess(ctx, 'agy', [`--print=${prompt}`, '--output-format=stream-json', `--model=${AGY_MODEL}`, '--disable-slash-commands', `--add-dir=${ctx.ws}`, '--dangerously-skip-permissions'], {}, line => {
        if (process.env.LIVE_AITALK_DEBUG === '1') console.log('  [agy] ' + short(line, 400));
        let event; try { event = JSON.parse(line); } catch { return; }
        const usage = event?.step_update?.usage;
        if (usage) { ctx.cost.steps++; ctx.cost.tokens += Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0); if (ctx.cost.steps >= MAX_STEPS * 2) return 'stop'; }
        if (event?.event === 'result' && event.result?.response) final = String(event.result.response);
        for (const action of event?.result?.denied_actions ?? []) denied.push(String(action.action));
    });
    ctx.agyDenied = denied;
    return { ...state, final: final.trim() };
}
const agyName = `aitalk-live-${crypto.randomBytes(3).toString('hex')}`;
function toolPhrase(runtime) { return runtime === 'agy' ? `aitalk (the MCP server named ${agyName})` : 'askaway_aitalk'; }
const withTool = (text, runtime) => text.replaceAll('{{STEPS}}', scenarios.steps).replaceAll('{{TOOL}}', toolPhrase(runtime));
async function runAgent(ctx, task) {
    const prompt = withTool(task, ctx.runtime);
    const url = `http://127.0.0.1:${proxyPort}/sse`;
    ctx.log(`model run starts (${ctx.runtime})`);
    const run = ctx.runtime === 'agy' ? await runAgy(ctx, prompt) : await runOpenCode(ctx, prompt, url);
    ctx.log(`model run ended exit=${run.exit}${run.timedOut ? ' TIMEOUT' : ''}${run.stoppedByCap ? ' STEP-CAP' : ''}`);
    // The host's run-end event: the worker lifecycle hook marks everything delivered to it as read.
    ctx.room.workerLifecycle({ id: ctx.recipient, displayName: `Live ${ctx.key}` }, false);
    await sleep(200);
    ctx.final = run.final;
    if (run.timedOut) ctx.check('run finished inside 120 s', false, 'timeout');
    if (run.exit && !run.timedOut && !run.stoppedByCap) ctx.check('model process exited cleanly', false, `exit ${run.exit}: ${short(run.stderr, 300)}`);
    return run;
}
const userMessage = (ctx, text, replyTo) => { const posted = ctx.room.userPost(replyTo ? text : `@${ctx.recipient} ${text}`, replyTo); ctx.log(`user posted "${short(text, 60)}"`); return posted.message; };
const messages = ctx => ctx.store.snapshot(true).messages;
const nth = (ctx, id) => ctx.tickNow()[id];

// ---- scenarios -------------------------------------------------------------------------------------------------------------
const bodies = {
    async S1(ctx) {
        const text = scenarios.S1.userMessage; let msg;
        ctx.onResult = call => { if (call.index === 1) { msg = userMessage(ctx, text); ctx.sentTick = nth(ctx, msg.id); } };
        await runAgent(ctx, scenarios.S1.task);
        if (!msg) return ctx.check('model made a tool call through the MCP server', false, 'no tools/call reached the server; the user message was never posted');
        ctx.check('model made at least 3 tool calls', ctx.calls.length >= 3, `calls=${ctx.calls.length}`);
        ctx.check('the real OpenCode plugin put the session id on every askaway call (no proxy injection)', ctx.calls.every(call => typeof call.identity?.openCodeSessionId === 'string'), `identities=${JSON.stringify(ctx.calls.map(call => call.identity))}`);
        ctx.check('right after the post the message is sent (single tick)', tickWord(ctx.sentTick) === 'sent', `tick=${ctx.sentTick}`);
        const hit = ctx.calls.find(call => call.index > 1 && delivers(call) && /PINEAPPLE/.test(call.text));
        ctx.check('the next tool call result carries the user message text', hit, 'no tool result after the post contained PINEAPPLE');
        ctx.check('the tool result carries label "ADDITIONAL MESSAGES FROM THE USER"', hit && NEW_LABEL.test(hit.text), `label seen: ${hit ? label(hit.text) || 'none' : 'n/a'}`, true);
        const entry = deliveredEntries(hit)[0];
        ctx.check('delivered entry has {id, from, text}', entry && entry.id === msg?.id && typeof entry.from === 'string' && /PINEAPPLE/.test(entry.text ?? ''), `entry=${JSON.stringify(entry)}`, true);
        ctx.check('after that call returned: delivered (double grey tick)', hit && tickWord(ctx.tickAt(msg.id, hit)) === 'delivered', `tick=${hit && ctx.tickAt(msg.id, hit)}`);
        // Every commentary call mirrors a line into AITalk, i.e. posts as the worker: that is the response which turns the tick blue.
        const next = ctx.calls.find(call => hit && call.index > hit.index);
        ctx.check('not read (blue) before the model posts to AITalk again (still delivered when its next call was requested)', hit && (!next || tickWord(ctx.tickAt(msg.id, next, 'ticksBefore')) === 'delivered'), `tick when next call was requested=${next && ctx.tickAt(msg.id, next, 'ticksBefore')}`, true);
        ctx.check('read (blue) once the run ended', tickWord(nth(ctx, msg.id)) === 'read', `tick=${nth(ctx, msg.id)}`);
        ctx.check('final answer mentions PINEAPPLE', /pineapple/i.test(ctx.final ?? ''), `final="${short(ctx.final, 120)}"`);
        ctx.tracked = [msg.id];
    },
    async S2(ctx) {
        let msg;
        ctx.onResult = call => { if (call.index === 1) msg = userMessage(ctx, scenarios.S2.userMessage); };
        await runAgent(ctx, scenarios.S2.task);
        if (!msg) return ctx.check('model made a tool call through the MCP server', false, 'no tools/call reached the server; the user message was never posted');
        const hit = ctx.calls.find(call => call.index > 1 && delivers(call) && /2\+3/.test(call.text));
        ctx.check('the question reached the model in a tool result', hit, 'no tool result contained the question');
        const reply = ctx.calls.find(call => call.args?.action === 'aitalk' && call.args?.replyTo === msg?.id);
        ctx.check('model replied with the AITalk tool and replyTo = the message id', reply, `aitalk calls: ${JSON.stringify(ctx.calls.filter(c => c.args?.action === 'aitalk').map(c => c.args))}`);
        const posted = messages(ctx).find(message => message.author === ctx.recipient && message.replyTo === msg?.id);
        ctx.check('a reply message with replyTo exists in the room', posted && /\b(5|five)\b/i.test(posted.text), `reply=${JSON.stringify(posted?.text)}`);
        ctx.check('user message is read (blue) after the model posted', reply && tickWord(ctx.tickAt(msg.id, reply)) === 'read', `tick right after reply call=${reply && ctx.tickAt(msg.id, reply)}`);
        ctx.check('delivered (double grey) before the model posted', reply && tickWord(ctx.tickAt(msg.id, reply, 'ticksBefore')) === 'delivered', `tick before reply call=${reply && ctx.tickAt(msg.id, reply, 'ticksBefore')}`, true);
        ctx.check('user message is read at the end', tickWord(nth(ctx, msg.id)) === 'read', `tick=${nth(ctx, msg.id)}`);
        ctx.tracked = [msg.id];
    },
    async S3(ctx) {
        let question, answer;
        ctx.onResult = call => {
            if (!question && call.args?.action === 'aitalk') {
                question = messages(ctx).filter(message => message.author === ctx.recipient && message.kind !== 'system').at(-1);
                if (question) answer = userMessage(ctx, scenarios.S3.userReply, question.id);
            }
        };
        await runAgent(ctx, scenarios.S3.task);
        ctx.check('model posted its heads-up question to AITalk', question, 'no aitalk call from the model');
        const hit = ctx.calls.find(call => answer && call.index > 1 && delivers(call) && /Blue/.test(call.text));
        ctx.check('the user answer reached the model in a tool result', hit, 'no tool result contained the answer');
        const entry = deliveredEntries(hit).find(item => /Blue/.test(item.text ?? ''));
        ctx.check('entry has inReplyTo with the original question id and text', entry?.inReplyTo?.id === question?.id && entry?.inReplyTo?.text === question?.text, `inReplyTo=${JSON.stringify(entry?.inReplyTo)} question=${JSON.stringify(question?.text)}`, true);
        ctx.check('the tool result carries label "ADDITIONAL MESSAGES FROM THE USER"', hit && NEW_LABEL.test(hit.text), `label seen: ${hit ? label(hit.text) || 'none' : 'n/a'}`, true);
        ctx.check('after that call returned: delivered', hit && tickWord(ctx.tickAt(answer.id, hit)) === 'delivered', `tick=${hit && ctx.tickAt(answer.id, hit)}`);
        ctx.check('final answer says blue', /blue/i.test(ctx.final ?? ''), `final="${short(ctx.final, 120)}"`);
        ctx.tracked = answer ? [answer.id] : [];
    },
    async S4(ctx) {
        let posted = [];
        ctx.onResult = call => { if (call.index === 1) posted = scenarios.S4.userMessages.map(text => userMessage(ctx, text)); };
        await runAgent(ctx, scenarios.S4.task);
        const words = ['ALPHA', 'BRAVO', 'CHARLIE'];
        const carrying = ctx.calls.filter(call => call.index > 1 && delivers(call) && words.some(word => call.text.includes(word)));
        ctx.check('all three messages arrive in exactly ONE tool result', carrying.length === 1 && words.every(word => carrying[0].text.includes(word)), `calls carrying words: ${carrying.map(c => c.index)}`);
        const entries = deliveredEntries(carrying[0]);
        ctx.check('they arrive as one JSON array in the order posted', entries.length === 3 && entries.map(e => e.id).join() === posted.map(m => m.id).join(), `ids=${entries.map(e => e.id)} posted=${posted.map(m => m.id)}`);
        ctx.check('label "ADDITIONAL MESSAGES FROM THE USER"', carrying[0] && NEW_LABEL.test(carrying[0].text), `label seen: ${carrying[0] ? label(carrying[0].text) || 'none' : 'n/a'}`, true);
        ctx.check('not delivered again on the next call', ctx.calls.filter(call => carrying[0] && call.index > carrying[0].index).every(call => !delivers(call)), 'words repeated');
        ctx.check('all three delivered (double grey) after that call', carrying[0] && posted.every(m => tickWord(ctx.tickAt(m.id, carrying[0])) === 'delivered'), `ticks=${posted.map(m => carrying[0] && ctx.tickAt(m.id, carrying[0]))}`);
        ctx.check('all three read after the run', posted.every(m => tickWord(nth(ctx, m.id)) === 'read'), `ticks=${posted.map(m => nth(ctx, m.id))}`);
        ctx.tracked = posted.map(m => m.id);
    },
};
async function validatorScenario(ctx) {
    const invoke = async (text, id) => {
        const prompt = scenarios.S5.validatorPrompt.replace('{{TEXT}}', text);
        const run = ctx.runtime === 'agy' ? await runAgy(ctx, prompt) : await runOpenCode(ctx, prompt, null);
        ctx.log(`validator model answered "${short(run.final, 60)}"`);
        const validator = ctx.store.snapshot().members.find(member => member.kind === 'validator');
        ctx.room.post(validator.id, run.final || '(no answer)', { replyTo: id });
        return run.final;
    };
    const validator = lib.registerAITalkValidator(ctx.ws, invoke);
    const posted = ctx.room.userPost(scenarios.S5.userMessage); ctx.log('user posted "@Validator ..."');
    ctx.tracked = [posted.message.id];
    const timeout = sleep(SCENARIO_TIMEOUT_MS).then(() => 'timeout');
    const outcome = await Promise.race([Promise.all(posted.deliveries), timeout]);
    await sleep(200); ctx.final = '';
    const reply = messages(ctx).find(message => message.replyTo === posted.message.id && message.author !== posted.message.author);
    ctx.final = reply?.text ?? '';
    ctx.check('the message was routed to the Validator', posted.message.recipients?.length === 1, `recipients=${JSON.stringify(posted.message.recipients)}`);
    ctx.check('Validator answered inside the 120 s limit', outcome !== 'timeout', 'timeout');
    ctx.check('answer is a room message replying to the question', reply && reply.author === posted.message.recipients?.[0], `reply=${JSON.stringify(reply)}`);
    ctx.check('the answer is correct (Paris)', /paris/i.test(reply?.text ?? ''), `answer="${short(reply?.text, 100)}"`);
    ctx.check('question ticks ended read (blue)', tickWord(nth(ctx, posted.message.id)) === 'read', `tick=${nth(ctx, posted.message.id)}`);
    validator.dispose();
}
bodies.S5 = validatorScenario;

// Identity cases use real CLIs and the production delivery boundary, not injected metadata.
scenarios.S6 = { title: 'real agy worker identity and queued reply' };
scenarios.S7 = { title: 'real Claude worker identity and queued reply' };
async function identityScenario(ctx) {
    let queued;
    const progress = 'IDENTITY_PROGRESS';
    const question = 'Should I use green or blue?';
    ctx.onResult = call => { if (call.index === 1) queued = userMessage(ctx, 'What is 2+3? Reply using action aitalk and replyTo this message id.'); };
    const tool = ctx.runtime === 'agy' ? 'aitalk on the askaway-live-identity plugin server live' : 'mcp__askaway__aitalk';
    const prompt = `Use only ${tool}. Make these calls sequentially, waiting for every result. First action aitalk, kind update, text ${progress}, waitSeconds 0. This is an intentional refusal test; continue after rejection. Second action aitalk, kind heads-up, text "${question}", waitSeconds 0. Read ADDITIONAL MESSAGES FROM THE USER in every result. Answer its arithmetic question by calling action aitalk with replyTo equal to its id, text "5", no kind, waitSeconds 0. Then finish with done. Do not put identity metadata or workspacePath in arguments.`;
    let run;
    if (ctx.runtime === 'agy') {
        lib.setAITalkAgyResolver(id => id === ctx.conversation ? { workerId: ctx.recipient, workspace: ctx.ws } : undefined);
        run = await runProcess(ctx, 'agy', ['--print', prompt, '--model', 'gemini-3.8-flash-low', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--print-timeout', '90s'], {}, line => {
            let event; try { event = JSON.parse(line); } catch { return; }
            if (event.event === 'init') ctx.conversation = event.conversation_id || event.session_id;
            if (event.event === 'result') ctx.final = event.result?.response || '';
            const usage = event.step_update?.usage;
            if (usage) { ctx.cost.steps++; ctx.cost.tokens += Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0); }
        });
        ctx.check('init conversation identity reaches every tool call', !!ctx.conversation && ctx.calls.length > 0 && ctx.calls.every(call => call.transportIdentity?.['antigravity.google/conversation_id'] === ctx.conversation));
    } else {
        ctx.runToken = crypto.randomBytes(24).toString('hex');
        lib.setAITalkRunTokenResolver(token => token === ctx.runToken ? { workerId: ctx.recipient, workspace: ctx.ws } : undefined);
        const args = lib.claudeArgs({ model: 'haiku', thinking: 'low', message: prompt, mcpUrl: `http://127.0.0.1:${proxyPort}/sse`, runToken: ctx.runToken,
            profile: { edit: 'deny', bash: 'deny', webfetch: 'deny', mcp: ['askaway_aitalk'] } });
        args.splice(args.indexOf('--'), 0, '--max-budget-usd', '0.10', '--setting-sources', '', '--tools', '');
        run = await runProcess(ctx, 'claude', args, { env: { ...process.env, ENABLE_TOOL_SEARCH: 'false' } }, line => {
            let event; try { event = JSON.parse(line); } catch { return; }
            if (event.type === 'result') { ctx.final = event.result || ''; ctx.costKnown = Number.isFinite(event.total_cost_usd); ctx.cost.usd = event.total_cost_usd; ctx.cost.steps = event.num_turns || 0; ctx.cost.tokens = (event.usage?.input_tokens || 0) + (event.usage?.output_tokens || 0); }
        });
        ctx.check('production run header reaches every tool call', ctx.calls.length > 0 && ctx.calls.every(call => call.runIdentityMatches));
        ctx.check('reported Claude spend is below $0.20', ctx.costKnown && ctx.cost.usd < 0.20);
        lib.setAITalkRunTokenResolver(undefined);
        ctx.runToken = undefined;
    }
    ctx.check('real CLI exited successfully', run.exit === 0 && !run.timedOut, `exit=${run.exit} timeout=${run.timedOut}`);
    const first = ctx.calls[0];
    ctx.check('progress update is refused', first?.args.kind === 'update' && /REJECTED/.test(first.text));
    ctx.check('refused progress is absent from room', !messages(ctx).some(message => message.text.includes(progress)));
    const next = ctx.calls[1];
    ctx.check('queued message arrives on exactly the next call with the user label', !!queued && NEW_LABEL.test(next?.text || '') && deliveredEntries(next).some(entry => entry.id === queued.id));
    ctx.check('queued message arrives only once', !!queued && ctx.calls.filter(call => deliveredEntries(call).some(entry => entry.id === queued.id)).length === 1);
    ctx.check('heads-up question is attributed to this member', messages(ctx).some(message => message.author === ctx.recipient && message.text === question));
    ctx.check('agent answers through commentary aitalk replyTo', !!queued && ctx.calls.some(call => call.args.action === 'aitalk' && call.args.replyTo === queued.id) && messages(ctx).some(message => message.author === ctx.recipient && message.replyTo === queued.id && /\b5\b/.test(message.text)));
    ctx.tracked = queued ? [queued.id] : [];
}
bodies.S6 = identityScenario;
bodies.S7 = identityScenario;

async function withAgyIdentity(test) {
    const settingsPath = path.join(require('node:os').homedir(), '.gemini/antigravity-cli/settings.json');
    const original = fs.readFileSync(settingsPath);
    const plugin = path.join(runDir, 'identity-plugin');
    fs.mkdirSync(path.join(plugin, '.antigravity-plugin'), { recursive: true });
    fs.writeFileSync(path.join(plugin, '.antigravity-plugin/plugin.json'), JSON.stringify({ name: 'askaway-live-identity', version: '1.0.0', description: 'Temporary live identity test' }));
    fs.writeFileSync(path.join(plugin, 'mcp_config.json'), JSON.stringify({ mcpServers: { live: { command: process.execPath, args: [path.join(FIXTURES, 'agy-mcp-bridge.cjs'), `http://127.0.0.1:${proxyPort}/sse`] } } }));
    const cli = args => { const result = spawnSync('agy', args, { encoding: 'utf8', timeout: 30_000 }); if (result.status !== 0) throw new Error(`agy ${args[0]} ${args[1]} failed (exit ${result.status})`); };
    let installed = false;
    try {
        const settings = JSON.parse(original); settings.permissions ||= {}; settings.permissions.allow ||= [];
        settings.permissions.allow.push('mcp(askaway-live-identity_live/aitalk)');
        fs.writeFileSync(settingsPath, JSON.stringify(settings));
        installed = true; cli(['plugin', 'install', plugin]);
        await test();
    } finally {
        try { if (installed) cli(['plugin', 'uninstall', 'askaway-live-identity']); }
        finally { fs.writeFileSync(settingsPath, original); }
        if (!fs.readFileSync(settingsPath).equals(original)) throw new Error('agy settings restore differs');
        console.log('PASS agy cleanup: plugin uninstalled; settings.json restored byte for byte');
    }
}

// ---- run -------------------------------------------------------------------------------------------------------------------
function report(ctx, started) {
    const failed = ctx.asserts.filter(item => !item.ok);
    const unexpected = failed.filter(item => !item.a3);
    const status = !failed.length ? 'PASS' : unexpected.length ? 'FAIL' : 'FAIL (expected until A3)';
    console.log(`\n=== ${ctx.key} [${ctx.runtime}] ${scenarios[ctx.key].title}: ${status}  (${((Date.now() - started) / 1000).toFixed(0)} s, ${ctx.cost.steps} steps, ${ctx.cost.tokens} tokens, $${ctx.cost.usd.toFixed(4)}) ===`);
    for (const item of ctx.asserts) console.log(`  ${item.ok ? 'ok  ' : item.a3 ? 'EXPECTED-UNTIL-A3' : 'FAIL'} ${item.name}${item.ok ? '' : ` -> ${item.detail}`}`);
    for (const call of ctx.calls) {
        const delivered = label(call.text) ? ` [${label(call.text)} label]` : '';
        const note = call.parts.length > 1 || delivered ? `\n      model received: "${short(call.text, 700)}"` : '';
        console.log(`  call ${call.index} ${call.name}(${short(JSON.stringify(call.args), 110)})${delivered}${note || `: ${short(call.text, 110)}`}`);
    }
    for (const id of ctx.tracked ?? []) {
        const steps = ctx.timeline.get(id) ?? [];
        console.log(`  ticks ${id.slice(0, 8)}: ${steps.map(step => `${tickWord(step.tick)} ${ctx.rel(step.at)}`).join(' → ') || '(none seen)'}`);
    }
    console.log(`  model final answer: "${short(ctx.final, 300)}"`);
    costs.push({ key: ctx.key, runtime: ctx.runtime, ...ctx.cost });
    results.push({ key: ctx.key, runtime: ctx.runtime, status, a3: failed.filter(item => item.a3).map(item => item.name), unexpected: unexpected.map(item => item.name) });
}
let agyBlocked = '';
async function runOne(key, runtime) {
    if (runtime === 'agy' && agyBlocked && key !== 'S5') { console.log(`\nSKIP ${key} [agy]: ${agyBlocked}`); results.push({ key, runtime, status: 'SKIP', a3: [], unexpected: [] }); return; }
    const ctx = newCtx(key, runtime); active = ctx; const started = Date.now();
    try { await bodies[key](ctx); } catch (error) { ctx.fail(`harness error: ${error.stack || error}`); }
    finally { ctx.stop(); active = null; }
    if (runtime === 'agy' && key !== 'S5' && !ctx.calls.length && ctx.agyDenied?.includes('mcp')) {
        agyBlocked = 'agy denied its MCP tool call headless (denied_actions: mcp) even with --dangerously-skip-permissions, so no agent tool call can reach the server; needs the repo agy approval wrapper (tools/agy-approve.py) or a policy change';
        console.log(`\nSKIP ${key} [agy]: ${agyBlocked}`); results.push({ key, runtime, status: 'SKIP', a3: [], unexpected: [] }); costs.push({ key, runtime, ...ctx.cost }); return;
    }
    report(ctx, started);
}
function agySignedIn() {
    const probe = spawnSync('agy', ['models'], { encoding: 'utf8', timeout: 30_000 });
    return probe.status === 0 && probe.stdout.includes(AGY_MODEL);
}
(async () => {
    console.log(`AITalk live test: model ${MODEL} (opencode), ${AGY_MODEL} (agy); scenarios ${(ONLY.length ? ONLY : ['S1', 'S2', 'S3', 'S4', 'S5']).join(',')}`);
    const selected = ONLY.length ? ONLY : ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
    const names = selected.filter(key => /^S[1-5]$/.test(key));
    await buildServer(); await startProxy();
    console.log(`real MCP server on :${mcp.getPort()}, proxy on :${proxyPort}, workspace ${path.relative(process.cwd(), runDir)}`);
    let agyRegistered = false;
    try {
        if (RUNTIMES.includes('opencode')) for (const key of names) await runOne(key, 'opencode');
        if (RUNTIMES.includes('agy')) {
            if (!agySignedIn()) console.log(`\nSKIP agy: \`agy models\` did not list ${AGY_MODEL} (not signed in or model unavailable)`);
            else {
                const added = spawnSync('agy', ['mcp', 'add', '--type', 'http', agyName, `http://127.0.0.1:${proxyPort}/sse`], { encoding: 'utf8', timeout: 30_000 });
                agyRegistered = added.status === 0;
                if (!agyRegistered) console.log(`\nSKIP agy: could not add the temporary MCP server (${short(added.stderr || added.stdout, 200)})`);
                else for (const key of names) await runOne(key, 'agy');
            }
        }
        if (selected.includes('S6')) await withAgyIdentity(() => runOne('S6', 'agy'));
        if (selected.includes('S7')) await runOne('S7', 'claude');
    } finally {
        if (agyRegistered) spawnSync('agy', ['mcp', 'remove', agyName], { encoding: 'utf8', timeout: 30_000 });
        proxy.close(); mcp.server?.close(); killAll();
        if (process.env.LIVE_AITALK_KEEP !== '1') fs.rmSync(runDir, { recursive: true, force: true });
    }
    console.log('\n=== SUMMARY ===');
    for (const item of results) console.log(`${item.status.padEnd(26)} ${item.key} [${item.runtime}]${item.a3.length ? `  expected-until-A3: ${item.a3.join('; ')}` : ''}${item.unexpected.length ? `  UNEXPECTED: ${item.unexpected.join('; ')}` : ''}`);
    const total = costs.reduce((sum, item) => ({ usd: sum.usd + item.usd, tokens: sum.tokens + item.tokens, steps: sum.steps + item.steps }), { usd: 0, tokens: 0, steps: 0 });
    console.log(`model cost: ${total.steps} steps, ${total.tokens} tokens, $${total.usd.toFixed(4)} (opencode-reported; agy reports no cost)`);
    console.log(`Result: ${results.some(item => item.status !== 'PASS') ? 'FAIL' : 'PASS'} matched=${results.length}`);
    const bad = results.some(item => item.unexpected.length || ((STRICT || item.key === 'S6' || item.key === 'S7') && item.a3.length));
    process.exit(bad || !results.length ? 1 : 0);
})().catch(error => { console.error(error); killAll(); try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(1); });
