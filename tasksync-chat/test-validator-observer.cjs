// T004a observer: covered/uncovered/no-question/worker-response cases, cost once, beta isolation, non-blocking failure, worker/session ids. Run: node test-validator-observer.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.validator-observer-build');
fs.rmSync(buildDir, { recursive: true, force: true });
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools',
    'commentary/commentary', 'specs/specCostLedger', 'validator/profile', 'validator/redact', 'validator/records', 'validator/observer']) {
    const out = path.join(buildDir, `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const load = (name) => require(path.join(buildDir, `${name}.js`));
const { CommentaryStore, commentaryView, buildOpener } = load('commentary/commentary');
const { readSpecCostTotals } = load('specs/specCostLedger');
const { ValidatorObserver } = load('validator/observer');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-observer-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-observer-ws-')));
fs.writeFileSync(path.join(workspace, 'Rules.md'), '# Rules\nAlways write tests from the caller view before shipping.\n');
fs.writeFileSync(path.join(workspace, 'Goal.md'), '# Goal\nShip a read-only validator.\n');
fs.mkdirSync(path.join(workspace, 'specs', '007-demo'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'specs', '007-demo', 'spec.md'), '# Spec\nFR-1: the build must run offline.\n');

const commentary = new CommentaryStore({ dir: path.join(home, 'commentary') });
const costFile = path.join(home, 'spec-cost.json');
const SLUG = '007-demo';

function make(run, extra = {}) {
    const events = [];
    const observer = new ValidatorObserver({ workspaceRoot: workspace, commentary, run, costFile, onEvent: (e) => events.push(e), timeoutMs: 300, ...extra });
    return { observer, events };
}
const reply = (body, usage, ids = { workerId: 'w-validator-1', sessionId: 'ses_abc' }) => async () => ({ text: JSON.stringify(body), usage, ...ids });

(async () => {
    try {
        const agentFeedBefore = JSON.stringify(commentary.read(workspace).items);

        // --- Covered question: cited answer reaches Commentary only; cost counted once; ids recorded ---
        let calls = 0;
        const usage = { input: 1000, output: 100, reasoning: 20, cacheRead: 500, cacheWrite: 50, cost: 0.02 };
        const covered = make(async (input) => { calls++; return reply({ answer: 'Write the test from the caller view first.', sources: ['Rules.md'], observations: 'rule applies', summary: 'covered', impact: 'low' }, usage)(input); });
        const r1 = await covered.observer.observe({ id: 'resp-1', source: 'agent', text: 'Should I write tests before shipping?', specSlug: SLUG });
        assert.equal(calls, 1);
        assert.equal(r1.skipped, false);
        assert.equal(r1.error, null);
        assert.match(r1.answer, /caller view/);
        assert.deepEqual(r1.sources, ['Rules.md']);
        assert.deepEqual([r1.workerId, r1.sessionId], ['w-validator-1', 'ses_abc'], 'record carries worker and session id');
        const shown = commentaryView(commentary.read(workspace)).items.filter((i) => i.kind === 'validator');
        assert.equal(shown.length, 1);
        assert.match(shown[0].text, /caller view/);
        assert.match(shown[0].text, /Rules\.md/, 'cited source is shown');
        assert.equal(readSpecCostTotals(costFile)[SLUG].turns, 1, 'cost counted once');
        assert.equal(readSpecCostTotals(costFile)[SLUG].inputTokens, 1000);
        assert.equal(readSpecCostTotals(costFile)[SLUG].nanoAiu, 0.02 * 100 * 1e9);
        const persisted = fs.readFileSync(path.join(workspace, '.askaway', 'specs', SLUG, 'validator', 'responses.jsonl'), 'utf8');
        assert.match(persisted, /ses_abc/);
        assert.match(persisted, /w-validator-1/);
        assert.deepEqual(covered.events.map((e) => [e.type, e.observedId]), [['start', 'resp-1'], ['stop', 'resp-1']]);
        assert.ok(covered.events.some((e) => e.type === 'stop' && e.workerId === 'w-validator-1' && e.sessionId === 'ses_abc'), 'lifecycle event by worker and session id');

        // --- Uncovered: no source answers (also when the model cites nothing real) ---
        const uncovered = make(reply({ answer: 'Use Postgres.', sources: ['made-up.md'], observations: '', summary: 'x', impact: '' }, usage));
        const r2 = await uncovered.observer.observe({ id: 'resp-2', source: 'agent', text: 'Which database do you prefer?', specSlug: SLUG });
        assert.equal(r2.answer, null, 'an answer with no real cited source is not an answer');
        assert.deepEqual(r2.sources, []);
        const last = commentaryView(commentary.read(workspace)).items.filter((i) => i.kind === 'validator').pop();
        assert.match(last.text, /no source answers/i);

        // --- No question: skipped with no model run and no cost; skip counted ---
        let skippedRuns = 0;
        const quiet = make(async () => { skippedRuns++; return { text: '{}' }; });
        const costBefore = JSON.stringify(readSpecCostTotals(costFile));
        const validatorItemsBefore = commentary.read(workspace).validatorItems.length;
        const r3 = await quiet.observer.observe({ id: 'resp-3', source: 'agent', text: 'Build passed, 12 tests green. Moving on to the next file.', specSlug: SLUG });
        assert.equal(r3.skipped, true);
        assert.equal(skippedRuns, 0);
        assert.equal(JSON.stringify(readSpecCostTotals(costFile)), costBefore, 'a skip costs nothing');
        assert.equal(commentary.read(workspace).validatorItems.length, validatorItemsBefore, 'a skip posts no entry');
        const stats = quiet.observer.stats(SLUG);
        assert.equal(stats.skipped, 1, 'skip is counted and visible');
        assert.equal(stats.observed, 2);

        // --- Worker response: per-source attribution and its own cost row ---
        const worker = make(reply({ answer: 'Offline, per FR-1.', sources: ['specs/007-demo/spec.md'], observations: '', summary: 'ok', impact: '' }, { ...usage, cost: 0.01 }));
        const r4 = await worker.observer.observe({ id: 'resp-4', source: 'worker:w-impl-9', text: 'Does the build need network access?', specSlug: SLUG });
        assert.equal(r4.source, 'worker:w-impl-9');
        assert.match(r4.answer, /Offline/);
        assert.equal(readSpecCostTotals(costFile)[SLUG].turns, 3, 'worker response adds exactly one more validator row (covered, uncovered, worker)');

        // --- Secrets: a credential in the response is never sent to the run or any sink ---
        let leaked = false;
        const secret = make(async (input) => { if (/ghp_/.test(input.prompt)) { leaked = true; } return { text: '{}' }; });
        const r5 = await secret.observer.observe({ id: 'resp-5', source: 'agent', text: 'Should I use ghp_abcdefghijklmnopqrstuvwxyz0123 for auth?', specSlug: SLUG });
        assert.equal(leaked, false);
        assert.ok(r5.error);
        assert.doesNotMatch(JSON.stringify(commentary.read(workspace)), /ghp_/);

        // --- Failure and timeout never block: the call resolves with a visible error ---
        const broken = make(async () => { throw new Error('opencode server down'); });
        const r6 = await broken.observer.observe({ id: 'resp-6', source: 'agent', text: 'Can you confirm the approach?', specSlug: SLUG });
        assert.match(r6.error, /opencode server down/);
        assert.equal(r6.answer, null);
        assert.ok(broken.events.some((e) => e.type === 'error'));
        const errItem = commentaryView(commentary.read(workspace)).items.filter((i) => i.kind === 'validator').pop();
        assert.match(errItem.text, /opencode server down/, 'failure is shown');
        const hung = make(() => new Promise(() => {}), { timeoutMs: 50 });
        const started = Date.now();
        const r7 = await hung.observer.observe({ id: 'resp-7', source: 'agent', text: 'Which option should I take?', specSlug: SLUG });
        assert.ok(Date.now() - started < 2000);
        assert.match(r7.error, /timed out/);
        const garbled = make(async () => ({ text: 'not json at all' }));
        assert.ok((await garbled.observer.observe({ id: 'resp-8', source: 'agent', text: 'Should I proceed?', specSlug: SLUG })).error);
        const throwingSink = make(reply({ answer: 'x', sources: [], observations: '', summary: '', impact: '' }, usage), { onEvent: () => { throw new Error('sink down'); } });
        assert.equal((await throwingSink.observer.observe({ id: 'resp-9', source: 'agent', text: 'Should I proceed?', specSlug: SLUG })).error, null, 'a failing event sink does not fail the run');

        // --- Beta isolation: nothing validator-made reaches the agent-facing feed, opener, or run input to the agent ---
        const state = commentary.read(workspace);
        assert.equal(JSON.stringify(state.items), agentFeedBefore, 'agent-facing feed untouched');
        assert.doesNotMatch(buildOpener(state), /caller view|Validator/);
        assert.deepEqual(Object.keys(covered.observer).filter((k) => /send|deliver|reply|respond/i.test(k)), [], 'no send surface');
        let profileSeen;
        await make(async (input) => { profileSeen = input.profile; return { text: '{}' }; }).observer.observe({ id: 'resp-10', source: 'agent', text: 'Should I proceed?', specSlug: SLUG });
        assert.deepEqual([profileSeen.edit, profileSeen.bash, profileSeen.webfetch], ['deny', 'deny', 'deny'], 'the run is read-only');

        console.log('PASS EV-VALIDATOR-OBSERVER');
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exit(1); });
