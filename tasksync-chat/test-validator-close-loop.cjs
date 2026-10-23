const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./node_modules/typescript');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
const root = fs.mkdtempSync(path.join(__dirname, 'build/validator-close-loop-'));
require('./tools/transpile-src.cjs').transpileSrc(root);
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools',
    'commentary/commentary', 'specs/specCostLedger', 'validator/profile', 'validator/redact', 'validator/records', 'validator/observer']) {
    const file = path.join(root, `${name}.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText);
}
const { CommentaryStore, buildOpener, commentaryView } = require(path.join(root, 'commentary/commentary.js'));
const { ValidatorObserver } = require(path.join(root, 'validator/observer.js'));
const { ValidatorRecords } = require(path.join(root, 'validator/records.js'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspace, 'specs/007-demo'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'specs/007-demo/Rules.md'), 'Prefer sequential work.');
const commentary = new CommentaryStore({ dir: path.join(root, 'commentary-state') });
const items = [];
const store = {
    async remember(fact, scope) { const item = { id: `memory-${items.length + 1}`, fact, scope }; items.push(item); return item; },
    async recall(query, scope) { return items.filter(item => JSON.stringify(item.scope) === JSON.stringify(scope)); }
};
const scope = { project: 'fixture', agentId: 'validator', spec: '007-demo' };
const ports = { workspaceRoot: workspace, commentary, costFile: path.join(root, 'cost.json'), timeoutMs: 200,
    knowledgeStore: store, knowledgeScope: scope };
const json = body => ({ text: JSON.stringify(body), usage: { input: 10, output: 5, cost: 0.001 } });
const prev = { id: 'previous', text: 'Should I run work sequentially or in parallel?', specSlug: '007-demo', storyId: 'US2', taskId: 'T006' };
const reply = { id: 'reviewer', text: 'Run independent work in parallel. For example, tests and docs can run together. Use caller-view tests. Our goal is to reduce repeated context.' };
(async () => {
    const observer = new ValidatorObserver({ ...ports, run: async () => json({ answer: 'Run sequentially.', sources: ['specs/007-demo/Rules.md'], observations: '', summary: '', impact: '' }) });
    await observer.observe({ ...prev, source: 'agent' });
    assert.equal(observer.predictions('007-demo')[0].decision, 'Run sequentially.');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const slow = new ValidatorObserver({ ...ports, run: async input => {
        assert.ok(input.prompt.includes(prev.text));
        assert.ok(input.prompt.includes(reply.text));
        assert.ok(input.prompt.includes('Run sequentially.'));
        started(); await gate;
        return json({ answer: null, related: true, matched: false, diff: 'Reviewer chose parallel instead of sequential.',
            facts: [{ kind: 'rule', text: 'Run independent work in parallel.', example: 'Tests and docs can run together.' },
                { kind: 'instruction', text: 'Use caller-view tests.' }, { kind: 'goal', text: 'Reduce repeated context.' }], sources: [], observations: '', summary: '', impact: '' });
    } });
    const channels = { chatInput: [], workerInput: [], toolResults: [], promptText: 'ORIGINAL PROMPT' };
    const openerBefore = buildOpener(commentary.read(workspace));
    const pending = slow.closeLoop(prev, reply);
    let completed = false;
    pending.then(() => { completed = true; });
    channels.chatInput.push(reply.text);
    await entered;
    assert.deepEqual(channels.chatInput, [reply.text]);
    assert.equal(completed, false, 'agent received reply while validator is blocked on deterministic gate');
    release();
    assert.equal(await pending, undefined, 'no validator output is returned to a tool');
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(item => item.fact.kind), ['rule', 'instruction', 'goal']);
    assert.deepEqual(items[0].scope, scope);
    assert.equal(items[0].fact.from, reply.id);
    assert.equal(items[0].fact.storyId, 'US2');
    assert.equal(items[0].fact.taskId, 'T006');
    assert.match(items[0].fact.example, /Tests and docs/);
    const prediction = new ValidatorRecords(workspace, '007-demo').predictions()[0];
    assert.equal(prediction.matched, false);
    assert.match(prediction.diff, /parallel/);
    assert.ok(!commentaryView(commentary.read(workspace)).items.some(item => /match measure/.test(item.text)), 'the score is shown in Priya\'s header, never as a chat Observation');
    console.log('PASS EV-VALIDATOR-CLOSE-LOOP: slow validator never delays agent receipt; mismatch shown and scoped knowledge stored');
    const fresh = new ValidatorObserver({ ...ports,
        run: async input => {
            assert.match(input.prompt, /--- memory-1\nRun independent work in parallel/);
            return json({ answer: 'Run independent work in parallel.', sources: ['memory-1'], observations: '', summary: '', impact: '' });
        } });
    const answer = await fresh.observe({ id: 'fresh', source: 'agent', text: 'Should independent work run in parallel?', specSlug: '007-demo' });
    assert.deepEqual(answer.sources, ['memory-1']);
    assert.ok(commentaryView(commentary.read(workspace)).items.some(item => item.text.includes('source: memory-1')));
    console.log('PASS fresh observer cites stored rule without conversation history');
    const quiet = new ValidatorObserver({ ...ports, run: async () => json({ answer: null, sources: [], related: false, matched: null, diff: 'Unrelated', facts: [], observations: '', summary: '', impact: '' }) });
    await quiet.closeLoop(prev, { id: 'ok', text: 'ok' });
    await quiet.closeLoop(prev, { id: 'unrelated', text: 'My lunch arrived.' });
    assert.equal(items.length, 3);
    const unseen = new ValidatorObserver({ ...ports, run: async () => json({ answer: null, sources: [], related: true, matched: null, diff: '', facts: [{ kind: 'rule', text: 'Keep tests offline.' }] }) });
    await unseen.closeLoop({ ...prev, id: 'unseen' }, { id: 'new-rule', text: 'Keep tests offline.' });
    assert.equal(items.length, 4, 'pair works without an earlier observation');
    const failing = new ValidatorObserver({ ...ports, run: async () => { throw new Error('fake validator unavailable'); } });
    await failing.closeLoop(prev, reply);
    assert.ok(commentaryView(commentary.read(workspace)).items.some(item => item.text.includes('fake validator unavailable')));
    assert.equal(buildOpener(commentary.read(workspace)), openerBefore);
    assert.deepEqual(channels, { chatInput: [reply.text], workerInput: [], toolResults: [], promptText: 'ORIGINAL PROMPT' });
    assert.deepEqual(commentary.read(workspace).items, []);
    console.log('PASS FR-018: no validator output reaches chat input, worker input, MCP result or prompt text; ok/unrelated store nothing');
    fs.writeFileSync(path.join(workspace, 'GOALS.md'), 'Keep work aligned with reviewer goals.');
    const repoWide = new ValidatorObserver({ workspaceRoot: workspace, commentary,
        run: async () => json({ answer: 'Flag drift for the reviewer.', sources: ['GOALS.md'], risk: 'high' }) });
    const drift = await repoWide.observe({ id: 'repo-wide-drift', source: 'agent', specSlug: '', force: true,
        text: 'Review commentary for drift from the goals.' });
    assert.equal(drift.error, null, 'prediction record rejection cannot turn a valid observation into an error');
    assert.equal(drift.risk, 'high');
    assert.equal(drift.answer, 'Flag drift for the reviewer.');
    assert.deepEqual(drift.sources, ['GOALS.md']);
    console.log('PASS prediction persistence failure preserves repo-wide answer, sources and high-risk drift classification');
    // Real-model finding 2026-10-22 (live Luna): the first reply came in the observation schema without related/matched/facts.
    const lazyRuns = [];
    const lazy = new ValidatorObserver({ ...ports, run: async input => {
        lazyRuns.push(input.prompt);
        return lazyRuns.length === 1 ? json({ answer: 'Run sequentially.', sources: ['specs/007-demo/Rules.md'], observations: '', summary: '', impact: '' })
            : lazyRuns.length === 2 ? json({ answer: null, sources: [], observations: 'The reviewer states a rule.', summary: 's', impact: 'i' })
            : json({ answer: null, related: true, matched: false, diff: 'Reviewer wants parallel work.', facts: [{ kind: 'rule', text: 'Run independent work in parallel.' }] });
    } });
    await lazy.observe({ ...prev, id: 'lazy-prev', source: 'agent' });
    const before = items.length;
    await lazy.closeLoop({ ...prev, id: 'lazy-prev' }, { id: 'lazy-reply', text: 'Run independent work in parallel.' });
    assert.equal(lazyRuns.length, 3, 'one observe, one comparison, one retry for the missing comparison keys');
    assert.match(lazyRuns.at(-1), /lacked the comparison keys/);
    assert.equal(items.length, before + 1, 'the fact from the retry is stored');
    assert.equal(new ValidatorRecords(workspace, '007-demo').predictions().find(p => p.responseId === 'lazy-prev').matched, false);
    // The optional third argument is the conversation prefix; it sits above the Previous response block.
    const prompts = [];
    const ctx = new ValidatorObserver({ ...ports, run: async input => { prompts.push(input.prompt); return json({ answer: null, related: false, matched: null, diff: '', facts: [], sources: [], observations: '', summary: '', impact: '' }); } });
    await ctx.closeLoop({ ...prev, id: 'ctx-prev' }, { id: 'ctx-reply', text: 'Reply.' }, '[1] Reviewer: EARLIER TURN');
    assert.ok(prompts[0].includes('[1] Reviewer: EARLIER TURN'));
    assert.ok(prompts[0].indexOf('EARLIER TURN') < prompts[0].indexOf('Previous response:'));
    console.log('PASS EV-VALIDATOR-CLOSE-LOOP-RETRY: a reply without the comparison keys is asked once more and then learned');
})().catch(error => { console.error(error); process.exitCode = 1; });
