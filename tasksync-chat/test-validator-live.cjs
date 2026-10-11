const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'build', `validator-live-${Date.now()}-${process.pid}`);
fs.mkdirSync(fixture, { recursive: true });
function load(file) {
    const text = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', file)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(text, { module, exports: module.exports, require, console, process, Buffer, URL, fetch, AbortSignal, setTimeout, clearTimeout });
    return module.exports;
}
const { validatorTool } = load('validator/validatorTool.ts');
const { ValidatorObserver, validatorWorkerRun } = load('validator/observer.ts');
const { ValidatorTriggers } = load('validator/validatorTriggers.ts');
const { CommentaryStore } = load('commentary/commentary.ts');
const live = process.env.ASKAWAY_VALIDATOR_LIVE === '1';
(async () => {
    const commentary = new CommentaryStore({ dir: path.join(fixture, 'commentary') });
    let enabled = false, mode = 'awayValidator', until, confidence = 0.95, risk = 'low', reversible = true, sources = ['GOALS.md'];
    let run = async () => ({ text: 'Surrounding object {"unrelated":true}\n```json\n' + JSON.stringify({ answer: 'At most 4 keep-alive pings {maximum}.', sources, risk, reversible, confidence }) + '\n```\nResult: PASS\n{"footer":true}' });
    if (live) {
        const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime.ts');
        const { validatorProfile } = load('validator/profile.ts');
        const { syncOpenCodeAgents } = load('workers/workerProfiles.ts');
        const profile = validatorProfile();
        syncOpenCodeAgents([profile], path.join(fixture, '.opencode', 'agents'));
        const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir: path.join(fixture, 'worker-ledger') });
        runtime.setServerEndpoint('http://127.0.0.1:4096');
        run = validatorWorkerRun(async () => runtime, fixture, () => 'validator-live-check');
    }
    fs.writeFileSync(path.join(fixture, 'GOALS.md'), fs.readFileSync(path.join(root, 'GOALS.md')));
    let workerReply = '';
    const observer = new ValidatorObserver({ workspaceRoot: fixture, commentary,
        run: async input => { const result = await run(input); workerReply = result.text; return result; } });
    const triggers = new ValidatorTriggers(fixture, async () => observer, () => '', () => {});
    const tool = validatorTool(text => triggers.validatorCall(text), { workspace: fixture, enabled: () => enabled,
        availability: () => ({ mode, until }), timeoutMs: 65000 });
    const call = () => tool.run({ message: 'How many keep-alive pings may an idle worker get?' });
    const ack = JSON.stringify({ queued: true, note: "The validator's prediction goes to Commentary for the reviewer." });
    if (!live) {
        assert.equal(JSON.stringify(await call()), ack);
        enabled = true; mode = 'here';
        assert.equal(JSON.stringify(await call()), ack);
        mode = 'away'; assert.equal(JSON.stringify(await call()), ack, 'plain Away does not enable live');
        mode = 'awayValidator'; until = new Date(Date.now() - 1000).toISOString();
        assert.equal(JSON.stringify(await call()), ack);
        mode = 'offline'; until = undefined;
        assert.equal(JSON.stringify(await call()), ack);
    }
    enabled = true; mode = 'awayValidator'; until = undefined;
    const safe = await call();
    const { redactOrDrop } = load('validator/redact.ts');
    assert.equal(typeof safe.answer, 'string', 'Full tool result: ' + JSON.stringify(safe) + '; Commentary: ' + JSON.stringify(commentary.read(fixture).validatorItems) + '; Worker reply: ' + (redactOrDrop(workerReply) ?? '[credential omitted]'));
    assert.match(safe.answer, /4/, 'Full tool result: ' + JSON.stringify(safe)); assert.ok(safe.sources.includes('GOALS.md'), 'Full tool result: ' + JSON.stringify(safe));
    if (!live) {
        for (const change of [() => { risk = 'high'; }, () => { risk = 'low'; reversible = false; },
            () => { reversible = true; confidence = 0.3; }, () => { confidence = 0.95; sources = []; }]) {
            change(); const held = await call(); assert.equal(held.held, true);
            assert.equal(held.note, 'Held for the reviewer; continue with independent work.');
        }
    }
    const records = fs.readFileSync(path.join(fixture, '.askaway/validator/live-decisions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length, live ? 1 : 5);
    assert.equal(records[0].held, false);
    assert.ok(records.slice(1).every(row => row.held && row.answer === null));
    assert.ok(records.every(row => ['question', 'answer', 'held', 'sources', 'risk', 'reversible', 'confidence', 'ts'].every(key => key in row)));
    if (!live) {
        const failedRun = validatorWorkerRun(async () => ({ start: () => ({ runId: 'failed-run' }),
            wait: async () => ({ status: 'FAILED', reason: 'Unexpected server error: session directory mismatch' }), cancel: () => {} }), fixture, () => 'failure-check');
        const failedObserver = new ValidatorObserver({ workspaceRoot: fixture, commentary, run: failedRun });
        const failure = await failedObserver.observe({ id: 'failure-check', source: 'agent', text: 'Question?', force: true });
        assert.match(failure.error, /Validator worker FAILED: Unexpected server error: session directory mismatch/);
        const secretRun = validatorWorkerRun(async () => ({ start: () => ({ runId: 'secret-run' }),
            wait: async () => ({ status: 'FAILED', reason: 'ghp_' + 'a'.repeat(36) }), cancel: () => {} }), fixture, () => 'secret-check');
        await assert.rejects(secretRun({ prompt: 'Question?', profile: {}, observedId: 'secret-check' }), error =>
            error.message === 'Validator worker FAILED');
        const timed = validatorTool(() => new Promise(() => {}), { workspace: fixture, enabled: () => true,
            availability: () => ({ mode: 'awayValidator' }), timeoutMs: 5 });
        assert.equal((await timed.run({ message: 'A stalled question?' })).held, true);
        const lines = fs.readFileSync(path.join(fixture, '.askaway/validator/live-decisions.jsonl'), 'utf8').trim().split('\n');
        assert.equal(lines.length, 6); assert.equal(JSON.parse(lines.at(-1)).held, true);
    }
    assert.ok(JSON.stringify(commentary.read(fixture).validatorItems).includes('4'));
    const setting = require('./package.json').contributes.configuration.properties['askaway.validator.live'];
    assert.equal(setting.default, false); assert.equal(setting.type, 'boolean');
    console.log(live ? 'PASS EV-VALIDATOR-LIVE real OpenCode answer 4 with GOALS.md source; decision recorded'
        : 'PASS EV-VALIDATOR-LIVE setting off/Here = beta ack; Away low-risk = sourced answer; high-risk/irreversible/uncertain/unsourced = held; one ledger line per live decision');
})().catch(error => { console.error(error); process.exitCode = 1; });
