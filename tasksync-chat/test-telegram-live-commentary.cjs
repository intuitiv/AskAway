// T048 (CY-008): the Commentary feed mirrored into ONE live Telegram message per turn. Run: node test-telegram-live-commentary.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

async function runLive() {
    // Preserve quoted strings (including URLs) while removing JSONC syntax.
    const strings = '"(?:\\\\.|[^"\\\\])*"';
    let settings;
    try {
        const raw = fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/Code/User/settings.json'), 'utf8');
        const uncommented = raw.replace(new RegExp(`(${strings})|//[^\\r\\n]*|/\\*[\\s\\S]*?\\*/`, 'g'), (_, quoted) => quoted ?? '');
        settings = JSON.parse(uncommented.replace(new RegExp(`(${strings})|,(?=\\s*[}\\]])`, 'g'), (_, quoted) => quoted ?? ''));
    } catch (error) {
        if (error.code === 'ENOENT') { console.log('SKIP EV-048-LIVE reason=user-settings-missing'); return; }
        throw new Error('EV-048-LIVE could not parse user settings (contents masked)');
    }
    const token = settings['askaway.telegram.botToken'];
    const chatId = settings['askaway.telegram.chatId'];
    if (typeof token !== 'string' || !token.trim() || !String(chatId ?? '').trim()) {
        console.log('SKIP EV-048-LIVE reason=botToken-or-chatId-missing');
        return;
    }
    const mask = text => String(text).split(token).join('[MASKED]').split(encodeURIComponent(token)).join('[MASKED]');
    let service, wired;
    try {
        const bundle = await require('esbuild').build({
            stdin: { contents: "export { TelegramService } from './src/services/telegramService'; export { CommentaryStore } from './src/commentary/commentary'; export { TelegramLiveCommentary, relayCommentaryToTelegram } from './src/commentary/telegramLive';", resolveDir: __dirname, loader: 'ts' },
            bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', external: ['vscode'],
        });
        const fixture = path.join(__dirname, 'build', 'telegram-live-test-fixture');
        fs.mkdirSync(fixture, { recursive: true });
        const fixtureRun = fs.mkdtempSync(path.join(fixture, 'turn-'));
        const vscode = {
            workspace: { name: 'TaskSync', workspaceFolders: [{ uri: { fsPath: path.dirname(__dirname) } }],
                getConfiguration: () => ({ get: (key, fallback) => {
                    if (key === 'telegram.enabled') { return true; }
                    if (key === 'telegram.botToken') { return token; }
                    if (key === 'telegram.chatId') { return String(chatId); }
                    return settings[`askaway.${key}`] ?? fallback;
                } }) },
            commands: { executeCommand: async () => {} },
            window: { showErrorMessage() {}, showWarningMessage() {} },
        };
        let apiErrors = 0;
        const pending = new Set();
        const liveFetch = (url, options) => {
            // Never read updates: that would consume the reviewer's real replies meant for the running extension.
            if (String(url).includes('/getUpdates')) {
                return Promise.resolve(new Response(JSON.stringify({ ok: true, result: [] }), { headers: { 'content-type': 'application/json' } }));
            }
            const request = (async () => {
                try {
                    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
                    const data = await response.clone().json();
                    if (!response.ok || data.ok !== true) { apiErrors++; }
                    return response;
                } catch { apiErrors++; throw new Error('EV-048-LIVE Telegram transport failed (details masked)'); }
            })();
            pending.add(request);
            request.then(() => pending.delete(request), () => pending.delete(request));
            return request;
        };
        const loaded = { exports: {} };
        // The host adapter supplies settings only; all Telegram HTTP calls remain real.
        // Suppress service logs entirely: API errors can contain the credential URL.
        new Function('require', 'module', 'exports', 'console', 'fetch', bundle.outputFiles[0].text)(
            name => name === 'vscode' ? vscode : require(name), loaded, loaded.exports,
            { log() {}, warn() {}, error() {} }, liveFetch);
        const runtime = loaded.exports;
        service = new runtime.TelegramService();
        const calls = { sends: [], edits: [], finishes: [] };
        let posterErrors = 0;
        const observe = async (list, action) => {
            try { const result = await action(); list.push(result); return result; }
            catch { posterErrors++; return undefined; }
        };
        const poster = {
            isConfigured: () => service.isConfigured(),
            sendLive: html => observe(calls.sends, () => service.sendLive(html)),
            editLive: (id, html) => observe(calls.edits, () => service.editLive(id, html)),
            finishLive: (...args) => observe(calls.finishes, () => service.finishLive(...args)),
        };
        let clock = Date.now();
        const liveStore = new runtime.CommentaryStore({ dir: path.join(fixtureRun, 'commentary'), now: () => ++clock });
        const liveRelay = new runtime.TelegramLiveCommentary(() => poster, 'TaskSync', { minEditMs: 0 });
        wired = runtime.relayCommentaryToTelegram(liveRelay, liveStore, fixtureRun);
        const waitFor = async predicate => {
            const deadline = Date.now() + 20000;
            while (!predicate() && !apiErrors && !posterErrors && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            assert.ok(!apiErrors && !posterErrors, 'EV-048-LIVE real Telegram API and poster must report no errors');
            assert.ok(predicate(), 'EV-048-LIVE relay must deliver before timeout');
        };
        liveStore.markTurnStart(fixtureRun, '[AskAway live test] Verify one live commentary turn');
        await waitFor(() => calls.sends.length > 0);
        assert.ok(calls.sends.length === 1 && Number.isInteger(calls.sends[0]) && calls.sends[0] > 0,
            'EV-048-LIVE user message must return one real Telegram message id');
        for (const [kind, text] of [
            ['update', '[AskAway live test] Checking the real commentary relay sends updates into this Telegram message.'],
            ['heads-up', '[AskAway live test] Heads-up: this labelled test checks live delivery; no reviewer action is needed.'],
        ]) {
            const before = calls.edits.length;
            assert.ok(liveStore.post(fixtureRun, { kind, text }).status === 'POSTED', 'EV-048-LIVE commentary must be accepted');
            await waitFor(() => calls.edits.length > before);
            assert.ok(calls.edits.at(-1) === true, 'EV-048-LIVE real Telegram edit must succeed');
        }
        assert.ok(await liveRelay.finish('[AskAway live test] Commentary delivery test complete.', 'handoff:EV-048-LIVE'),
            'EV-048-LIVE real Telegram turn completion must succeed');
        wired.dispose(); wired = undefined;
        service.dispose();
        await Promise.allSettled([...pending]);
        assert.ok(apiErrors === 0 && posterErrors === 0, 'EV-048-LIVE no API error during turn completion');
        assert.ok(calls.sends.length === 1 && calls.edits.length === 2 && calls.finishes.length === 1,
            'EV-048-LIVE exactly one live opening, two edits and one turn completion');
        // finishLive sends a notifying final message and removes the silent live one, as in the extension.
        console.log(`PASS EV-048-LIVE sent=1 edits=${calls.edits.length}`);
    } catch (error) {
        const safe = new Error(mask(error.message));
        safe.stack = mask(error.stack ?? safe.stack);
        throw safe;
    } finally {
        wired?.dispose();
        service?.dispose();
    }
}

if (process.env.ASKAWAY_TELEGRAM_LIVE === '1') {
    runLive().catch(error => { console.error(String(error.stack).split('\n').slice(0, 5).join('\n')); process.exitCode = 1; });
} else {
const buildDir = path.join(__dirname, '.telegram-live-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
require('./tools/transpile-src.cjs').transpileSrc(buildDir);
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools', 'commentary/commentary', 'commentary/telegramLive']) {
    const out = path.join(buildDir, `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { CommentaryStore, commentaryToolDefinitions, commentaryView } = require(path.join(buildDir, 'commentary', 'commentary.js'));
const { TelegramLiveCommentary } = require(path.join(buildDir, 'commentary', 'telegramLive.js'));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-live-home-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-live-ws-')));
// Store and hook both stamp real time in production, so the test does too.
const store = new CommentaryStore({ dir: path.join(home, '.askaway', 'commentary') });
const [commentary] = commentaryToolDefinitions(() => store, workspace);
const post = (kind, text) => commentary.run({ kind, text });
const pause = () => { const until = Date.now() + 15; while (Date.now() < until) { /* let the wall clock pass the last line */ } };
// The prompt hook's own writer, run as Copilot runs it.
const prompt = () => {
    pause();
    require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, 'hooks', 'spec-context-inject.cjs')], {
        input: JSON.stringify({ session_id: 'conv-live', cwd: workspace, prompt: 'go' }), env: { ...process.env, HOME: home },
    });
    pause();
};

const telegram = { sent: [], edits: [], configured: true, nextId: 100 };
const poster = {
    isConfigured: () => telegram.configured,
    sendLive: async (html) => { telegram.sent.push(html); return telegram.nextId++; },
    editLive: async (id, html) => { telegram.edits.push({ id, html }); return true; },
    finishLive: async (id, head, markdown, replyTaskId) => { telegram.edits.push({ id, html: `${head}\n\n${markdown}`, replyTaskId }); return true; },
};
let enabled = true;
const relay = new TelegramLiveCommentary(() => poster, 'TaskSync', { minEditMs: 0, enabled: () => enabled });
const view = () => commentaryView(store.read(workspace), store.turnStarts(workspace), store.currentPrompt(workspace));
const sync = () => relay.update(view());

(async () => {
    // Turn 1: the user message opens the live message; lines edit that same message.
    prompt();
    await sync();
    assert.equal(telegram.sent.length, 1, 'a user message opens the live message');
    assert.match(telegram.sent[0], /^🔴 <b>Live<\/b> · TaskSync\n💬 <i>go<\/i>$/);
    post('update', '🏏 Plan: **two tracks**, each checked by another worker.');
    await sync();
    assert.match(telegram.edits[0].html, /\n<code>\d\d:\d\d:\d\d<\/code> 🏏 Plan: <b>two tracks<\/b>, each checked by another worker\.$/);
    post('heads-up', 'Keep three retries or allow five? <script>x</script>');
    await sync();
    await sync();
    assert.deepEqual([telegram.sent.length, telegram.edits.length, telegram.edits[1].id], [1, 2, 100], 'one message per turn, edited in place; an unchanged feed is not re-sent');
    assert.match(telegram.edits[1].html, /❓ <b>HEADS-UP<\/b> Keep three retries or allow five\? &lt;script&gt;x&lt;\/script&gt;$/, 'heads-up flagged, HTML escaped');

    // Turn end: the final response replaces the live status in the same message, once.
    assert.equal(await relay.finish('- Summary: accepted', 'handoff:1'), true);
    const closed = telegram.edits[telegram.edits.length - 1];
    assert.deepEqual([closed.id, closed.replyTaskId], [100, 'handoff:1']);
    assert.match(closed.html, /^✅ <b>Turn complete<\/b> · TaskSync[\s\S]*- Summary: accepted$/);
    assert.equal(await relay.finish('- Summary: again', 'handoff:2'), false, 'a finished turn is not finished twice');

    // Turn 2: a new prompt starts a new live message holding only the new turn's lines.
    prompt();
    post('update', '🚀 Reusing the warm builder for emoji support.');
    await sync();
    assert.equal(telegram.sent.length, 2, 'a new turn gets its own live message');
    assert.doesNotMatch(telegram.sent[1], /two tracks/, 'earlier turns are not repeated');

    // Throttle: a burst inside the edit window collapses into one trailing edit with the newest text.
    const throttled = new TelegramLiveCommentary(() => poster, 'TaskSync', { minEditMs: 60 });
    await throttled.update(view());
    const before = telegram.edits.length;
    post('update', 'Builder done; the warm checker reruns the test.');
    await throttled.update(view());
    post('update', '🏆 Emoji-safe truncate accepted by the checker.');
    await throttled.update(view());
    assert.equal(telegram.edits.length, before, 'no edit inside the window');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(telegram.edits.length, before + 1, 'exactly one trailing edit');
    assert.match(telegram.edits[telegram.edits.length - 1].html, /Emoji-safe truncate accepted/);

    // Off switches: setting disabled or Telegram not configured means no calls at all.
    const calls = telegram.sent.length + telegram.edits.length;
    enabled = false;
    prompt(); post('update', 'This line stays out of Telegram entirely.'); await sync();
    enabled = true; telegram.configured = false;
    post('update', 'Still unconfigured, so nothing is sent.'); await sync();
    assert.equal(telegram.sent.length + telegram.edits.length, calls, 'no Telegram calls when off');

    // A long turn keeps its newest lines inside Telegram's message limit.
    telegram.configured = true;
    prompt();
    for (let i = 0; i < 80; i++) { post('update', `Line ${i} with enough words to make the message grow quickly past limits.`); }
    await sync();
    const long = telegram.sent[telegram.sent.length - 1];
    assert.ok(long.length <= 3900 && /Line 79 /.test(long) && !/Line 0 /.test(long), 'newest lines kept, under the limit');

    // A new prompt fires onNewTurn exactly once (it resolves the last turn-end handoff in Telegram).
    const { relayCommentaryToTelegram } = require(path.join(buildDir, 'commentary', 'telegramLive.js'));
    let newTurns = 0;
    const wired = relayCommentaryToTelegram(new TelegramLiveCommentary(() => poster, 'TaskSync'), store, workspace, () => { newTurns++; });
    prompt();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    wired.dispose();
    assert.equal(newTurns, 1, 'one prompt, one new-turn signal');

    // Every 2 minutes (here 80ms) a live turn shows how long it ran and when the agent last acted; long silence warns.
    const { statusFooter } = require(path.join(buildDir, 'commentary', 'telegramLive.js'));
    const at = new Date(2026, 8, 28, 16, 0, 0).getTime();
    assert.equal(statusFooter(at, at - 6 * 60_000, { lastActivityAt: at - 40_000, requests: 12, dollars: 1.234, lastIn: 95_000, turnOut: 2_100 }),
        '⏱ 16:00 · working 6m · 12 requests · <b>$1.23</b> · 95.0K last in / 2.1K turn out · last activity 40s ago');
    assert.match(statusFooter(at, at - 20 * 60_000, { lastActivityAt: at - 7 * 60_000, requests: 3 }), /\n⚠️ <b>No activity for 7m<\/b> — the agent may be stuck or errored\.$/);
    const activity = { lastActivityAt: Date.now(), requests: 2 };
    const ticking = new TelegramLiveCommentary(() => poster, 'TaskSync', { minEditMs: 0, activity: () => activity, tickMs: 80 });
    prompt();
    await ticking.update(view());
    const tickSent = telegram.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ticked = telegram.edits[telegram.edits.length - 1].html;
    assert.equal(telegram.sent.length, tickSent, 'the status refresh edits the live message, never a new one');
    assert.match(ticked, /\n⏱ \d\d:\d\d · working \d+s · 2 requests · <b>\$0\.00<\/b> · 0 last in \/ 0 turn out · last activity \d+s ago$/);
    await ticking.finish('- Summary: done', 'handoff:9');
    const editsAfterFinish = telegram.edits.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(telegram.edits.length, editsAfterFinish, 'no status ticks after the final response');
    ticking.dispose();

    for (const dir of [buildDir, home, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('EV-048 TelegramLiveCommentary: PASS openOnUserMessage=true editInPlace=true headsUp=flagged escaped=true finalReplacesLive=true throttled=trailingEdit offSwitches=true bounded=true newTurnSignal=true statusEvery2m=true stuckWarning=true');
})().catch((error) => { console.error(error); process.exit(1); });
}
