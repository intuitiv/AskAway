// T051 (CY-008): one Telegram message per turn, driven by the user-message hook, the commentary tool, and the final response.
// Real code end to end (prompt hook script, CommentaryStore + commentary tool, relay, TelegramService, turn target);
// only the Telegram HTTP API is faked. Run: node test-telegram-turn-lifecycle.cjs
// --live: the same scenario against the real Telegram API (bot settings from VS Code, TaskSync topic), paced for watching.
//         It never polls, so it cannot take replies meant for the running extension.
const LIVE = process.argv.includes('--live');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-turns-home-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-turns-ws-')));

const settingsFile = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');
function liveSetting(key) {
    const all = [...fs.readFileSync(settingsFile, 'utf8').matchAll(new RegExp(`"askaway\\.telegram\\.${key}"\\s*:\\s*"([^"]+)"`, 'g'))];
    if (!all.length) { throw new Error(`--live needs askaway.telegram.${key} in VS Code settings`); }
    return all[all.length - 1][1];
}
globalThis.__telegramConfig = { 'telegram.enabled': true, 'telegram.botToken': LIVE ? liveSetting('botToken') : 'test-token',
    'telegram.chatId': LIVE ? liveSetting('chatId') : 'test-chat', 'telegram.retryIntervalSeconds': 60, 'telegram.idlePauseMinutes': 0 };

async function load() {
    const build = await esbuild.build({
        stdin: {
            contents: [
                "export { TelegramService } from './src/services/telegramService';",
                "export { telegramHandoffUpdate } from './src/services/handoffNotifier';",
                "export { TelegramLiveCommentary, relayCommentaryToTelegram, telegramTurnTarget } from './src/commentary/telegramLive';",
                "export { CommentaryStore, commentaryToolDefinitions } from './src/commentary/commentary';",
            ].join('\n'),
            resolveDir: __dirname, sourcefile: 'turn-lifecycle-entry.ts', loader: 'ts',
        },
        bundle: true, format: 'cjs', platform: 'node', write: false, external: ['zod'],
        plugins: [{
            name: 'vscode-stub',
            setup(builder) {
                builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
                builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    loader: 'js',
                    contents: `module.exports = {
                        workspace: { name: 'TaskSync', workspaceFolders: [], getConfiguration() { return { get(key, fallback) {
                            const values = globalThis.__telegramConfig;
                            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback; } }; } },
                        commands: { async executeCommand() {} }, window: { showErrorMessage() {}, showWarningMessage() {} }, Uri: { file(v) { return { fsPath: v }; } },
                        EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
                    };`,
                }));
            },
        }],
    });
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    return mod.exports;
}

// Every API call is recorded and messages are kept by id, so the test reads what the reviewer sees.
// Offline this IS Telegram; with --live it mirrors real responses.
const api = { calls: [], messages: new Map(), nextId: 500, updates: [] };
const ok = (result) => ({ ok: true, status: 200, async json() { return { ok: true, result }; }, async text() { return '{}'; } });
const realFetch = global.fetch;
global.fetch = async (url, init) => {
    const method = String(url).split('?')[0].split('/').pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    api.calls.push({ method, body });
    if (LIVE) {
        const response = await realFetch(url, init);
        const data = await response.clone().json().catch(() => ({}));
        if (!response.ok) { console.log(`TELEGRAM ${method} ${response.status}: ${data.description ?? ''}`); }
        if (response.ok && method === 'sendMessage') { api.messages.set(data.result.message_id, { text: body.text, silent: !!body.disable_notification, thread: body.message_thread_id }); }
        if (response.ok && method === 'editMessageText') { api.messages.get(body.message_id).text = body.text; }
        return response;
    }
    if (method === 'sendMessage') { const id = api.nextId++; api.messages.set(id, { text: body.text, silent: !!body.disable_notification, thread: body.message_thread_id }); return ok({ message_id: id }); }
    if (method === 'editMessageText') { api.messages.get(body.message_id).text = body.text; return ok(true); }
    if (method === 'getUpdates') { const u = api.updates; api.updates = []; return ok(u); }
    if (['editForumTopic', 'answerCallbackQuery', 'getMe', 'getChat'].includes(method)) { return ok(method === 'getChat' ? { is_forum: true } : true); }
    throw new Error(`unexpected Telegram call ${method}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(LIVE ? 4000 : 1400); // turns-file watcher polls every 500ms; live runs are paced for watching
const beat = () => sleep(LIVE ? 2500 : 30);
const text = (id) => api.messages.get(id)?.text ?? '';
const newest = () => Math.max(...api.messages.keys());

(async () => {
    const m = await load();
    const store = new m.CommentaryStore({ dir: path.join(home, '.askaway', 'commentary') });
    const [commentary] = m.commentaryToolDefinitions(() => store, workspace);
    const telegram = new m.TelegramService();
    telegram._isForum = true; telegram._forumTopicsLoaded = true; telegram._topicIds.set('TaskSync', 8637); telegram._botId = 999;
    telegram.setResponseCallback(async () => {});
    telegram.setLiveTurns(() => true);
    if (LIVE) { telegram.startPolling = () => {}; }
    // The status ticker is real; `skew` fast-forwards the clock so the 5-minute stuck warning shows without waiting.
    let skew = 0;
    const activity = { lastActivityAt: 0, requests: 0 };
    const tickMs = LIVE ? 6000 : 3_600_000;
    const relay = new m.TelegramLiveCommentary(() => telegram, 'TaskSync', {
        minEditMs: LIVE ? 1500 : 0, now: () => Date.now() + skew, activity: () => activity, tickMs,
    });
    const statusTick = () => (LIVE ? sleep(tickMs + 1500) : relay.tick());
    const target = m.telegramTurnTarget(relay, () => telegram);
    const wired = m.relayCommentaryToTelegram(relay, store, workspace, () => telegram.resolveHandoffs());

    // The three triggers, each through the code that fires it in production.
    const userTypes = async (prompt) => {
        await sleep(20);
        childProcess.execFileSync(process.execPath, [path.join(__dirname, 'hooks', 'spec-context-inject.cjs')], {
            input: JSON.stringify({ session_id: 'demo', cwd: workspace, prompt }), env: { ...process.env, HOME: home },
        });
        await settle();
    };
    const commentaryTool = async (kind, line) => { assert.equal((await commentary.run({ kind, text: line })).status, 'POSTED'); await beat(); };
    let turnEnd = 1_000;
    const finalResponse = async (handoff) => target.postText(m.telegramHandoffUpdate({ handoff, details: '' }), handoff, `handoff:${++turnEnd}`);
    const queuedMessageDelivered = async (prompt) => { telegram.resolveTask('ask-1'); store.markTurnStart(workspace, prompt); await settle(); };

    // ── Turn 1: user message opens the message; commentary edits it; the final response becomes it ──
    await userTypes('Add a truncate helper and prove it with a test.');
    const turn1 = newest();
    assert.match(text(turn1), /^🔴 <b>Live<\/b> · TaskSync\n💬 <i>Add a truncate helper and prove it with a test\.<\/i>$/, 'a user message opens the live message at once');
    assert.equal(api.messages.get(turn1).thread, 8637, 'in the workspace topic');
    assert.equal(api.messages.get(turn1).silent, true);
    await commentaryTool('update', '🏏 Plan: **one builder**, then a separate checker runs the test.');
    await commentaryTool('heads-up', '❓ Count a flag emoji as **one character or two**?');
    assert.equal(api.messages.size, 1, 'commentary edits the same message');
    assert.match(text(turn1), /Plan: <b>one builder<\/b>[\s\S]*❓ <b>HEADS-UP<\/b>/);
    assert.equal(await finalResponse('- Summary: truncate accepted, 4 cases pass.\n- Next: Ship it?'), true);
    assert.equal(api.messages.size, 1, 'the final response lands in the same message');
    assert.match(text(turn1), /^✅ <b>Turn complete<\/b> · TaskSync[\s\S]*HEADS-UP[\s\S]*truncate accepted, 4 cases pass/);
    assert.equal(telegram.getActiveTaskCount(), 1, 'the final message waits for a reply');
    if (!LIVE) { assert.ok(telegram._pollingTimer, 'and is polled'); }

    // ── Turn 2: a new user message in VS Code stops that polling and opens the next message ──
    await userTypes('Also make it emoji safe.');
    assert.match(text(turn1), /^✅ <b>Continued in VS Code<\/b>[\s\S]*truncate accepted/, 'the answered message says so and keeps the final response');
    assert.equal(telegram.getActiveTaskCount(), 0);
    if (!LIVE) { assert.equal(telegram._pollingTimer, undefined, 'polling stopped'); }
    const turn2 = newest();
    assert.notEqual(turn2, turn1);
    assert.match(text(turn2), /💬 <i>Also make it emoji safe\.<\/i>$/);
    await commentaryTool('update', '🚀 Reusing the warm builder for emoji support.');
    // A line for this workspace written by another window (e.g. over the shared MCP server) reaches this turn's message.
    const otherWindow = new m.CommentaryStore({ dir: path.join(home, '.askaway', 'commentary') });
    otherWindow.post(workspace, { kind: 'update', text: '📦 Checker posted from another window: six cases pass.' });
    await settle();
    assert.match(text(newest()), /Checker posted from another window/, 'cross-window lines are picked up from the feed file');

    // T053: the status line refreshes in the same message, and warns once the agent has been silent for 5 minutes.
    Object.assign(activity, { lastActivityAt: Date.now(), requests: 3 });
    const messagesBeforeStatus = api.messages.size;
    await statusTick();
    assert.match(text(turn2), /⏱ \d\d:\d\d · working \d+s · 3 requests · last activity \d+s ago/, 'status line in the live message');
    assert.doesNotMatch(text(turn2), /No activity/);
    skew = 6 * 60_000;
    await statusTick();
    assert.match(text(turn2), /⚠️ <b>No activity for 6m<\/b> — the agent may be stuck or errored\./, 'stuck warning after 5 silent minutes');
    assert.match(text(turn2), /Checker posted from another window/, 'commentary kept above the status');
    assert.equal(api.messages.size, messagesBeforeStatus, 'status edits the message, never sends a new one');
    skew = 0;
    Object.assign(activity, { lastActivityAt: Date.now(), requests: 4 });

    // ── Turn 3: a queued message is delivered mid-turn: turn 2's message is closed, a new one opens ──
    await queuedMessageDelivered('Queue: also handle flags as one character.');
    assert.match(text(turn2), /^⏭ <b>Continued<\/b>[\s\S]*Reusing the warm builder/, 'a turn without a final response is closed, not left live');
    const turn3 = newest();
    assert.match(text(turn3), /💬 <i>Queue: also handle flags as one character\.<\/i>/);
    await commentaryTool('update', '✅ **Flags count as one**; the checker reran all six cases.');
    assert.equal(await finalResponse('- Summary: emoji-safe truncate accepted.\n- Next: Anything else?'), true);
    assert.equal(telegram.getActiveTaskCount(), 1);

    if (LIVE) {
        // A real reply would go to the running extension's poller, not this script; close the demo instead.
        await sleep(2500);
        const [, open] = [...telegram._activeTasks][0];
        telegram._activeTasks.clear();
        await telegram._markResolvedExternal(open, 'Demo finished — no reply needed');
        assert.equal(api.messages.size, 3, 'one Telegram message per turn');
        assert.ok(!api.calls.some((c) => c.method === 'sendMessage' && /Processing your response|still working/i.test(c.body.text)));
        wired.dispose();
        console.log(`EV-051-LIVE TelegramTurnLifecycle: PASS messages=${[...api.messages.keys()].join(',')} topic=8637 openOnUserMessage=true commentaryEdits=true finalInSameMessage=true vscodeReplyStopsPolling=true queuedMessageClosesTurn=true heartbeat=none`);
        console.log(`EV-053-LIVE TelegramStatusLive: PASS message=${turn2} statusEditedInPlace=true stuckWarning=true crossWindowLine=true tickMs=${tickMs}`);
        process.exit(0);
    }

    // ── Turn 4: the reviewer replies on Telegram; that reply starts the turn, and its message is not relabelled ──
    api.updates = [{ update_id: 7, message: { message_id: 900, message_thread_id: 8637, text: 'Ship it', from: { id: 42, username: 'reviewer' }, reply_to_message: { message_id: turn3 } } }];
    await telegram._poll();
    telegram.stopPolling();
    await userTypes('Ship it');
    assert.doesNotMatch(text(turn3), /Continued in VS Code/, 'a Telegram reply is not reported as a VS Code reply');
    assert.match(text(turn3), /Ship it/, 'it shows the Telegram answer');
    const turn4 = newest();
    assert.match(text(turn4), /💬 <i>Ship it<\/i>/);

    // No heartbeat or "processing" messages: the live message is the status.
    assert.equal(api.messages.size, 4, 'exactly one Telegram message per turn');
    assert.ok(!api.calls.some((c) => c.method === 'sendMessage' && /Processing your response|still working/i.test(c.body.text)));

    wired.dispose();
    telegram.stopPolling();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    console.log(`EV-051 TelegramTurnLifecycle: PASS messages=${api.messages.size} openOnUserMessage=true commentaryEdits=true finalInSameMessage=true vscodeReplyStopsPolling=true queuedMessageClosesTurn=true telegramReplyUntouched=true heartbeat=none statusInPlace=true stuckWarning=true`);
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
