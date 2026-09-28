// T048 (CY-008): the Commentary feed mirrored into ONE live Telegram message per turn. Run: node test-telegram-live-commentary.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.telegram-live-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
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
};
let enabled = true;
const relay = new TelegramLiveCommentary(() => poster, 'TaskSync', { minEditMs: 0, enabled: () => enabled });
const view = () => commentaryView(store.read(workspace), store.turnStarts(workspace));
const sync = () => relay.update(view());

(async () => {
    // Turn 1: the first line sends the live message; later lines edit that same message.
    prompt();
    await sync();
    assert.equal(telegram.sent.length, 0, 'a prompt alone sends nothing');
    post('update', '🏏 Plan: **two tracks**, each checked by another worker.');
    await sync();
    assert.equal(telegram.sent.length, 1);
    assert.match(telegram.sent[0], /^🔴 <b>Live<\/b> · TaskSync\n<code>\d\d:\d\d:\d\d<\/code> 🏏 Plan: <b>two tracks<\/b>, each checked by another worker\.$/);
    post('heads-up', 'Keep three retries or allow five? <script>x</script>');
    await sync();
    await sync();
    assert.deepEqual([telegram.sent.length, telegram.edits.length, telegram.edits[0].id], [1, 1, 100], 'one message per turn, edited in place; an unchanged feed is not re-sent');
    assert.match(telegram.edits[0].html, /❓ <b>HEADS-UP<\/b> Keep three retries or allow five\? &lt;script&gt;x&lt;\/script&gt;$/, 'heads-up flagged, HTML escaped');

    // Turn end: the live message is marked complete before the handoff posts.
    await relay.finish(view());
    const closed = telegram.edits[telegram.edits.length - 1].html;
    assert.match(closed, /^✅ <b>Turn complete<\/b> · TaskSync/);
    assert.match(closed, /<i>Final response follows\.<\/i>$/);

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

    for (const dir of [buildDir, home, workspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
    console.log('EV-048 TelegramLiveCommentary: PASS oneMessagePerTurn=true editInPlace=true headsUp=flagged escaped=true closedOnTurnEnd=true throttled=trailingEdit offSwitches=true bounded=true newTurnSignal=true');
})().catch((error) => { console.error(error); process.exit(1); });
