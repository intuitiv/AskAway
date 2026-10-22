const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./node_modules/typescript');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
const root = fs.mkdtempSync(path.join(__dirname, 'build/validator-learn-loop-'));
require('./tools/transpile-src.cjs').transpileSrc(root);
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools',
    'commentary/commentary', 'specs/specCostLedger', 'validator/profile', 'validator/redact', 'validator/records', 'validator/observer',
    'validator/conversationStack', 'validator/validatorTriggers']) {
    const file = path.join(root, `${name}.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText);
}
const { CommentaryStore } = require(path.join(root, 'commentary/commentary.js'));
const { ValidatorObserver } = require(path.join(root, 'validator/observer.js'));
const { ValidatorRecords } = require(path.join(root, 'validator/records.js'));
const { ConversationStacks } = require(path.join(root, 'validator/conversationStack.js'));
const { ValidatorTriggers } = require(path.join(root, 'validator/validatorTriggers.js'));

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
let sessionUsed = '';
let predictDelay = 0;
const json = body => ({ text: JSON.stringify(body), usage: { input: 1, output: 1, cost: 0 }, ...(sessionUsed ? { sessionId: sessionUsed } : {}) });
const prompts = [];
let broken = false;
const run = async input => {
    prompts.push(input.prompt);
    if (broken) throw new Error('fake model offline');
    if (predictDelay && !input.prompt.includes('Compare prediction with reviewer reply')) await new Promise(resolve => setTimeout(resolve, predictDelay));
    if (input.prompt.includes('Compare prediction with reviewer reply')) {
        return json({ answer: null, sources: [], related: true, matched: input.prompt.includes('Reviewer reply:\nU2'), diff: 'd',
            facts: [{ kind: 'rule', text: `Learned from ${/Reviewer reply:\n(\S+)/.exec(input.prompt)[1]}` }] });
    }
    return json({ answer: 'Guess.', sources: ['specs/007-demo/Rules.md'], observations: '', summary: '', impact: '' });
};
const observer = new ValidatorObserver({ workspaceRoot: workspace, commentary, costFile: path.join(root, 'cost.json'), timeoutMs: 500,
    knowledgeStore: store, knowledgeScope: scope, run });
const failures = [];
let continues = false;
const stacks = new ConversationStacks({ dir: path.join(root, 'stacks') });
const make = () => new ValidatorTriggers(workspace, async () => observer, () => '007-demo', () => failures.push('failed'), () => [],
    { stacks, sessionContinues: () => continues });
const triggers = make();
const learnPrompts = () => prompts.filter(p => p.includes('Compare prediction with reviewer reply'));
const user = async (key, text, turnId, t = triggers) => {
    stacks.append(key, { role: 'user', text, turnId, at: Date.now() });
    await t.onReviewerReply({ conversationKey: key, text, turnId });
};
const agent = (key, text, turnId, t = triggers) => t.onAgentFinal({ conversationKey: key, text, turnId });
const predictions = () => new ValidatorRecords(workspace, '007-demo').predictions();

(async () => {
    // (d) no earlier agent entry: nothing to learn from.
    await user('K', 'U1', 'u1');
    assert.equal(learnPrompts().length, 0);

    await agent('K', 'A1', 'a1');
    const a1 = stacks.read('K').find(e => e.text === 'A1');
    assert.equal(predictions().find(p => p.responseId === a1.id)?.decision, 'Guess.', 'prediction keyed by the stack entry id');

    // (a) U2 teaches from A1 once; a repeat call and a restarted instance do not relearn.
    await user('K', 'U2', 'u2');
    assert.equal(learnPrompts().length, 1);
    assert.match(learnPrompts()[0], /Previous response:\nA1\n/);
    assert.match(learnPrompts()[0], /Reviewer reply:\nU2/);
    assert.equal(predictions().find(p => p.responseId === a1.id).matched, true);
    await triggers.onReviewerReply({ conversationKey: 'K', text: 'U2', turnId: 'u2' });
    await make().onReviewerReply({ conversationKey: 'K', text: 'U2', turnId: 'u2' });
    assert.equal(learnPrompts().length, 1, 'never twice for the same reviewer message');

    // (b) full case: A2's input holds U1 A1 U2.
    await agent('K', 'A2', 'a2');
    const a2Prompt = prompts.at(-1);
    for (const text of ['Reviewer: U1', 'Agent: A1', 'Reviewer: U2', 'Agent: A2']) assert.ok(a2Prompt.includes(text), text);
    await user('K', 'U3', 'u3');
    assert.equal(learnPrompts().length, 2);
    assert.match(learnPrompts()[1], /Previous response:\nA2\n/);
    assert.match(learnPrompts()[1], /Reviewer reply:\nU3/);
    await agent('K', 'A3', 'a3');
    await user('K', 'U4', 'u4');
    assert.equal(learnPrompts().length, 3);

    // (b) continuing case: only the new entries after the first call.
    continues = true;
    await user('C', 'CU1', 'cu1'); await agent('C', 'CA1', 'ca1');
    assert.ok(prompts.at(-1).includes('Reviewer: CU1'));
    await user('C', 'CU2', 'cu2'); await agent('C', 'CA2', 'ca2');
    const continuing = prompts.at(-1);
    assert.ok(continuing.includes('Reviewer: CU2') && continuing.includes('Agent: CA2'));
    assert.ok(!continuing.includes('Reviewer: CU1') && !continuing.includes('Agent: CA1'), 'continuing session gets only new entries');
    continues = false;

    // (c) conversations stay apart.
    for (const p of prompts.filter(x => x.includes('CU') || x.includes('CA'))) assert.ok(!/Reviewer: U\d|Agent: A\d/.test(p), 'C input holds no K text');
    for (const p of prompts.filter(x => /Reviewer: U\d|Agent: A\d|Previous response:\nA/.test(x))) assert.ok(!/CU\d|CA\d/.test(p), 'K input holds no C text');

    // (f) facts land in the Validator's scope.
    assert.ok(items.length >= 3 && items.every(item => JSON.stringify(item.scope) === JSON.stringify(scope)));
    assert.ok(items.some(item => item.fact.text === 'Learned from U2'));

    // (g) the conversation prefix (ADR 0038): the learn call sees the earlier turns, above the Previous response block.
    assert.ok(learnPrompts()[1].includes('Reviewer: U1') && learnPrompts()[1].includes('Agent: A1'), 'learn for U3 gets U1 and A1');
    assert.ok(learnPrompts()[1].includes('Reviewer: U2') && learnPrompts()[1].includes('Reviewer: U3'));
    assert.ok(learnPrompts()[1].indexOf('Reviewer: U1') < learnPrompts()[1].indexOf('Previous response:'));
    assert.ok(!learnPrompts()[1].includes('Agent: A3') && !learnPrompts()[1].includes('Reviewer: U4'), 'nothing after the matched reviewer entry');

    // (h) delivery is acknowledged only after the model call succeeded, and a delta is used only for the session the cursor is bound to.
    {
        let session = 'S1'; sessionUsed = 'S1';
        const bound = new ValidatorTriggers(workspace, async () => observer, () => '007-demo', () => failures.push('failed'), () => [],
            { stacks, validatorSession: () => session, sessionContinues: () => { throw new Error('ignored when validatorSession is given'); } });
        await user('D', 'DU1', 'du1', bound); await agent('D', 'DA1', 'da1', bound);
        assert.ok(prompts.at(-1).includes('DU1') && prompts.at(-1).includes('DA1'), 'first call: the whole stack');
        await user('D', 'DU2', 'du2', bound);
        broken = true; await agent('D', 'DA2', 'da2', bound); broken = false;
        await user('D', 'DU3', 'du3', bound); await agent('D', 'DA3', 'da3', bound);
        const resent = prompts.at(-1);
        assert.ok(resent.includes('Reviewer: DU2') && resent.includes('Agent: DA2') && resent.includes('Reviewer: DU3'), 'a failed run leaves the cursor: the next call resends');
        assert.ok(!resent.includes('Reviewer: DU1') && !resent.includes('Agent: DA1'), 'delivered entries are not sent again');
        session = 'S2'; sessionUsed = 'S2';
        await user('D', 'DU4', 'du4', bound); await agent('D', 'DA4', 'da4', bound);
        assert.ok(prompts.at(-1).includes('Reviewer: DU1'), 'a different session than the cursor was bound to gets the full stack');
        await user('D', 'DU5', 'du5', bound); await agent('D', 'DA5', 'da5', bound);
        assert.ok(prompts.at(-1).includes('Reviewer: DU5') && !prompts.at(-1).includes('Reviewer: DU1'), 'the same session again gets the delta');
        session = null; sessionUsed = '';
        await user('D', 'DU6', 'du6', bound); await agent('D', 'DA6', 'da6', bound);
        assert.ok(prompts.at(-1).includes('Reviewer: DU1'), 'no reusable session: the full stack');
    }

    // (i) a reviewer reply that arrives while the prediction is still running is waited for, and learned from exactly once.
    {
        const before = learnPrompts().length;
        predictDelay = 300;
        await Promise.all([
            (async () => { await agent('W', 'WA1', 'wa1'); })(),
            (async () => { await new Promise(resolve => setTimeout(resolve, 20)); await user('W', 'WU2', 'wu2'); })(),
        ]);
        predictDelay = 0;
        assert.equal(learnPrompts().length, before + 1, 'learning happened once although the reply came first');
        const wa1 = stacks.read('W').find(e => e.text === 'WA1');
        assert.equal(typeof predictions().find(p => p.responseId === wa1.id).matched, 'boolean');
    }

    // (e) a failing model or observer never throws out of either method.
    broken = true;
    await agent('K', 'A5', 'a5');
    await user('K', 'U5', 'u5');
    const offline = new ValidatorTriggers(workspace, async () => { throw new Error('offline'); }, () => '007-demo', () => failures.push('failed'), () => [],
        { stacks, sessionContinues: () => false });
    await agent('K', 'A6', 'a6', offline);
    await user('K', 'U6', 'u6', offline);
    assert.ok(failures.length >= 1, 'failure surfaces through failed()');
    console.log('PASS EV-VALIDATOR-LEARN-LOOP: learn runs once per reviewer message, stacks stay apart, failures never throw');
})().catch(error => { console.error(error); process.exitCode = 1; });
