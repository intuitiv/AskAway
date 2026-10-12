const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const fixture = path.join(__dirname, 'build', `digest-watch-${Date.now()}-${process.pid}`);
fs.mkdirSync(fixture, { recursive: true });
function load(file) {
    const text = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', file)], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(text, { module, exports: module.exports, require, console, process, Buffer, URL, fetch,
        AbortSignal, setTimeout, clearTimeout });
    return module.exports;
}
const { CommentaryStore, commentaryView, buildOpener } = load('commentary/commentary.ts');
const { LiveDigest } = load('validator/liveDigest.ts');
const { CommentaryWatch, COMMENTARY_WATCH_THROTTLE_MS } = load('validator/commentaryWatch.ts');
const { recordLiveDecision } = load('validator/liveDecisions.ts');
const { relayCommentaryToTelegram } = load('commentary/telegramLive.ts');
const { ValidatorObserver, validatorWorkerRun } = load('validator/observer.ts');
const { ValidatorTriggers } = load('validator/validatorTriggers.ts');
const live = process.env.ASKAWAY_VALIDATOR_LIVE === '1';
async function checkLiveWatch() {
    const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime.ts');
    const { validatorProfile } = load('validator/profile.ts');
    const { syncOpenCodeAgents } = load('workers/workerProfiles.ts');
    const profile = validatorProfile();
    syncOpenCodeAgents([profile], path.join(fixture, '.opencode', 'agents'));
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir: path.join(fixture, 'worker-ledger') });
    runtime.setServerEndpoint('http://127.0.0.1:4096');
    fs.writeFileSync(path.join(fixture, 'GOALS.md'), fs.readFileSync(path.resolve(__dirname, '..', 'GOALS.md')));
    let now = Date.now();
    const store = new CommentaryStore({ dir: path.join(fixture, 'commentary'), now: () => now });
    const observer = new ValidatorObserver({ workspaceRoot: fixture, commentary: store,
        run: validatorWorkerRun(async () => runtime, fixture, () => 'validator-watch-live-check') });
    const triggers = new ValidatorTriggers(fixture, async () => observer, () => '', () => {});
    const replies = [];
    const watch = new CommentaryWatch(fixture, store, () => true, () => ({ mode: 'awayValidator' }), async text => {
        const reply = await triggers.validatorCall(text);
        replies.push(reply);
        assert.ok(reply && !reply.error && !reply.skipped, 'Real validator must complete; failure is not quiet');
        return reply;
    }, () => now);
    assert.equal(store.post(fixture, { kind: 'update',
        text: 'Plan: rewrite every specs/*/tasks.md into user stories so the Specs tab matches' }).status, 'POSTED');
    await watch.check();
    const flags = () => (store.read(fixture).validatorItems || []).filter(item => item.kind === 'heads-up');
    assert.equal(flags().length, 1, 'Contradictory plan must produce exactly one real drift flag');
    const flag = flags()[0];
    assert.ok(flag.detail.sources.includes('GOALS.md'), 'Drift must cite the supplied GOALS.md');
    assert.match(JSON.stringify(flag.detail.observations), /rewrite every/);
    assert.ok(!buildOpener(store.read(fixture)).includes(flag.text), 'Validator flag must never reach agent opener');
    now += COMMENTARY_WATCH_THROTTLE_MS;
    assert.equal(store.post(fixture, { kind: 'update',
        text: 'Plan: reverse-map tasks.md tasks onto spec.md stories in the Specs tab, no file rewritten' }).status, 'POSTED');
    await watch.check();
    assert.equal(replies.length, 2, 'Live check makes exactly two validator attempts');
    assert.equal(replies[1].risk, 'low', 'Aligned plan must be assessed as low risk, not a silent failure');
    assert.equal(flags().length, 1, 'Aligned plan must not produce another heads-up');
    assert.ok(!buildOpener(store.read(fixture)).includes(flag.text));
    console.log('PASS EV-VALIDATOR-DIGEST-WATCH-LIVE drift=flagged aligned=quiet GOALS.md=cited opener=isolated attempts=2');
}
(async () => {
    if (live) { await checkLiveWatch(); return; }
    let now = 1000000, enabled = true;
    let state = { mode: 'awayValidator', setAt: new Date(now).toISOString() };
    const store = new CommentaryStore({ dir: path.join(fixture, 'commentary'), now: () => now });
    const mirrors = [];
    const relay = relayCommentaryToTelegram({ update: async view => { mirrors.push(view); }, dispose() {} }, store, fixture);
    try {
        const digest = new LiveDigest(fixture, store, () => enabled, () => state, () => now);
        digest.check();
        const decision = (question, held, confidence, ts = now) => recordLiveDecision(fixture, {
            question, held, confidence, ts, answer: held ? null : 'DECIDED_FOUR', sources: ['GOALS.md'], risk: held ? 'high' : 'low', reversible: !held });
        decision('OLD_DECISION', false, 1, now - 1);
        decision('ANSWERED_QUESTION', false, 0.95); decision('UNCERTAIN_QUESTION', true, 0.2); decision('HELD_QUESTION', true, 0.9);
        state = { mode: 'here' }; digest.check(); digest.check();
        let items = store.read(fixture).validatorItems;
        assert.equal(items.length, 1); assert.equal(items[0].kind, 'heads-up');
        assert.match(items[0].text, /1 answered, 1 uncertain, 2 held/);
        assert.equal(items[0].detail.summary.answered[0].answer, 'DECIDED_FOUR');
        assert.equal(items[0].detail.summary.uncertain[0].question, 'UNCERTAIN_QUESTION');
        assert.equal(items[0].detail.summary.held.length, 2);
        assert.ok(!JSON.stringify(items).includes('OLD_DECISION'));
        now += 100; state = { mode: 'awayValidator', setAt: new Date(now).toISOString() }; digest.check();
        state = { mode: 'here' }; digest.check(); assert.equal(store.read(fixture).validatorItems.length, 1);
        state = { mode: 'awayValidator', setAt: new Date(now).toISOString(), until: new Date(now + 10).toISOString() }; digest.check();
        decision('TIMED_RETURN', false, 1); now += 11; digest.check(); digest.check();
        assert.equal(store.read(fixture).validatorItems.length, 2);
        enabled = false; state = { mode: 'awayValidator' }; digest.check(); decision('OFF_DECISION', false, 1);
        state = { mode: 'here' }; digest.check(); assert.equal(store.read(fixture).validatorItems.length, 2);

        fs.writeFileSync(path.join(fixture, 'GOALS.md'), 'Do not drift from the agreed goal.');
        const calls = [];
        const observer = new ValidatorObserver({ workspaceRoot: fixture, commentary: store,
            run: async input => { calls.push(input); return { text: JSON.stringify({ answer: 'DRIFT_WARNING', sources: ['GOALS.md'], risk: 'high' }) }; } });
        const triggers = new ValidatorTriggers(fixture, async () => observer, () => '', () => {});
        enabled = true; state = { mode: 'awayValidator' };
        const watch = new CommentaryWatch(fixture, store, () => enabled, () => state, text => triggers.validatorCall(text), () => now);
        store.post(fixture, { kind: 'update', text: 'Evidence line one changes direction' }); await watch.check();
        assert.equal(calls.length, 1);
        let flag = store.read(fixture).validatorItems.at(-1);
        assert.equal(flag.kind, 'heads-up'); assert.match(flag.text, /DRIFT_WARNING/);
        assert.match(JSON.stringify(flag.detail.observations), /Evidence line one/);
        assert.ok(flag.detail.sources.includes('GOALS.md'));
        store.post(fixture, { kind: 'update', text: 'Evidence line two changes direction' }); await watch.check(); await watch.check();
        assert.equal(calls.length, 1);
        now += COMMENTARY_WATCH_THROTTLE_MS; await watch.check(); assert.equal(calls.length, 2);
        assert.match(calls[1].prompt, /Evidence line two/); assert.ok(!calls[1].prompt.includes('Evidence line one'));
        await watch.check(); assert.equal(calls.length, 2, 'validator flags never feed the watch');
        enabled = false; store.post(fixture, { kind: 'update', text: 'Disabled work should stay silent' }); await watch.check();
        enabled = true; state = { mode: 'here' }; store.post(fixture, { kind: 'update', text: 'Here work should stay silent' }); await watch.check();
        assert.equal(calls.length, 2);
        assert.equal(calls[0].profile.edit, 'deny');
        const opener = buildOpener(store.read(fixture));
        for (const text of ['Validator return digest', 'DECIDED_FOUR', 'UNCERTAIN_QUESTION', 'DRIFT_WARNING']) assert.ok(!opener.includes(text));
        assert.ok(commentaryView(store.read(fixture)).items.some(item => item.id === flag.id));
        assert.ok(mirrors.at(-1).items.some(item => item.id === flag.id && item.kind === 'heads-up'));
        assert.ok(mirrors.at(-1).items.some(item => item.text.includes('Validator return digest')));
        // The Commentary renderer is gone (2026-10-12); Validator evidence rows render in the Trace tab (test-trace-tab-unification.cjs).
        assert.ok(require('./package.json').scripts['pretest:workers'].includes('test-validator-digest-watch.cjs'));
        console.log('PASS EV-VALIDATOR-DIGEST-WATCH answered/uncertain/held digest once on return and expiry; empty silent; watch throttled; isolated heads-up evidence uses shared trace and Telegram view; no action; off/Here silent');
    } finally { relay.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
