// EV-VALIDATOR-LIVE-LEARN: a REAL cheap model (validatorProfile(): Luna) runs the learn and predict loops (ADR 0038, R-PLAN-39..43) through the real
// ValidatorTriggers, ValidatorObserver and ConversationStacks. Only the knowledge store is an in-memory fake (never the shared agentmemory server).
// Live only: ASKAWAY_VALIDATOR_LIVE=1 and an OpenCode server at 127.0.0.1:4096. Without it this test SKIPs, and a SKIP is not a pass.
const live = process.env.ASKAWAY_VALIDATOR_LIVE === '1';
if (!live) { console.log('SKIP EV-VALIDATOR-LIVE-LEARN (set ASKAWAY_VALIDATOR_LIVE=1)'); process.exit(0); }

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const MAX_RUNS = 12;
const RUN_TIMEOUT_MS = 120_000;
const WHOLE_TEST_MS = 10 * 60 * 1000;
const fixture = path.join(__dirname, 'build', `validator-live-learn-${Date.now()}-${process.pid}`);
fs.mkdirSync(fixture, { recursive: true });
function load(file) {
    const text = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', file)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(text, { module, exports: module.exports, require, console, process, Buffer, URL, fetch, AbortSignal, setTimeout, clearTimeout });
    return module.exports;
}
const { ValidatorObserver, validatorWorkerRun } = load('validator/observer.ts');
const { ValidatorTriggers } = load('validator/validatorTriggers.ts');
const { ConversationStacks } = load('validator/conversationStack.ts');
const { ValidatorRecords } = load('validator/records.ts');
const { CommentaryStore } = load('commentary/commentary.ts');
const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime.ts');
const { validatorProfile } = load('validator/profile.ts');
const { syncOpenCodeAgents } = load('workers/workerProfiles.ts');

const watchdog = setTimeout(() => { console.error(`FAIL EV-VALIDATOR-LIVE-LEARN: whole test exceeded ${WHOLE_TEST_MS / 60000} minutes`); process.exit(1); }, WHOLE_TEST_MS);

// In-memory knowledge store with the KnowledgeStore interface; recall returns every fact of the project and agent.
function fakeStore() {
    const items = [];
    return {
        items,
        async remember(fact, scope) { const item = { id: `fact-${items.length + 1}`, fact, scope, ts: Date.now(), rootId: `fact-${items.length + 1}` }; items.push(item); return item; },
        async recall(_query, scope, limit) { return items.filter(item => item.scope.project === scope.project && item.scope.agentId === scope.agentId).slice(0, limit); },
        async supersede(id, fact) { const old = items.find(item => item.id === id); const item = { ...old, id: `fact-${items.length + 1}`, fact, supersedesId: id }; items.push(item); return item; },
        async history(id) { return items.filter(item => item.id === id || item.supersedesId === id); },
        async export() { return items.slice(); },
    };
}

(async () => {
    const profile = validatorProfile();
    syncOpenCodeAgents([profile], path.join(fixture, '.opencode', 'agents'));
    const runtime = new OpenCodeWorkerRuntime([profile], { ledgerDir: path.join(fixture, 'worker-ledger') });
    runtime.setServerEndpoint('http://127.0.0.1:4096');
    const realRun = validatorWorkerRun(async () => runtime, fixture, () => 'validator-live-learn');

    // A neutral source so the first prediction can cite something; it says nothing about the reviewer's preference.
    fs.writeFileSync(path.join(fixture, 'GOALS.md'), '# Goals\n\nShip AskAway releases safely. Deploys run through the release pipeline; confirm the target environment when it is not known.\n');

    const runs = [];
    let overBudget = false;
    const run = async input => {
        if (runs.length >= MAX_RUNS) { overBudget = true; throw new Error(`more than ${MAX_RUNS} model runs needed`); }
        const entry = { learn: input.prompt.includes('Compare prediction with reviewer reply'), prompt: input.prompt, reply: '' };
        runs.push(entry);
        const result = await realRun(input);
        entry.reply = result.text;
        return result;
    };

    const commentary = new CommentaryStore({ dir: path.join(fixture, 'commentary') });
    const scope = { project: 'live-learn', agentId: 'validator' };
    const storeA = fakeStore(), storeB = fakeStore();
    const observer = store => new ValidatorObserver({ workspaceRoot: fixture, commentary, costFile: path.join(fixture, 'cost.json'), timeoutMs: RUN_TIMEOUT_MS,
        knowledgeStore: store, knowledgeScope: scope, run });
    const stacks = new ConversationStacks({ dir: path.join(fixture, 'stacks') });
    const failures = [];
    const triggersFor = store => { const o = observer(store); return new ValidatorTriggers(fixture, async () => o, () => '007-demo', () => failures.push('failed'), () => [], { stacks, validatorSession: () => null }); };
    const triggersA = triggersFor(storeA);
    const records = () => new ValidatorRecords(fixture, '007-demo');
    const user = (t, key, text, turnId) => { stacks.append(key, { role: 'user', text, turnId, at: Date.now() }); return t.onReviewerReply({ conversationKey: key, text, turnId }); };
    const agent = (t, key, text, turnId) => t.onAgentFinal({ conversationKey: key, text, turnId });
    const U1 = 'For every deploy question, the target is always staging-east; never ask me which environment.';
    const A1 = 'The build is ready. Which environment should I deploy it to?';
    const U2 = 'staging-east, as always.';
    const A2 = 'Deploy finished. Which environment should I run the smoke test in?';

    // Conversation A: U1 (nothing to learn yet), A1 (predict), U2 (learn once), A2 (respond).
    await user(triggersA, 'convA', U1, 'u1');
    assert.equal(runs.length, 0, 'U1 has no earlier agent entry: no model run');
    await agent(triggersA, 'convA', A1, 'a1');
    const a1 = stacks.read('convA').find(entry => entry.text === A1);
    assert.ok(a1?.id, 'A1 is stacked');
    assert.ok(records().predictions().some(p => p.responseId === a1.id), `a prediction for A1 was recorded; model reply: ${runs[0]?.reply}`);
    await user(triggersA, 'convA', U2, 'u2');
    const compared = records().predictions().filter(p => typeof p.matched === 'boolean');
    assert.equal(compared.length, 1, `exactly one match/miss record after U2; learn reply: ${runs.find(r => r.learn)?.reply}`);
    assert.equal(compared[0].responseId, a1.id);
    assert.ok(storeA.items.some(item => /staging-east|deploy/i.test(item.fact.text)), `facts store got a staging-east/deploy item: ${JSON.stringify(storeA.items.map(i => i.fact))}`);
    await agent(triggersA, 'convA', A2, 'a2');
    const a2 = stacks.read('convA').find(entry => entry.text === A2);
    assert.equal(JSON.stringify(stacks.read('convA').map(entry => entry.text)), JSON.stringify([U1, A1, U2, A2]), `convA holds exactly U1 A1 U2 A2 in order: ${JSON.stringify(stacks.read('convA').map(entry => [entry.role, entry.text.slice(0, 30)]))}`);
    const output = records().responses().find(r => r.observedId === a2.id && !r.error);
    assert.ok(output, `A2 has a validator response; last reply: ${runs.at(-1)?.reply}`);
    assert.match(JSON.stringify([output.answer, output.observations, output.summary]), /staging-east/i, 'the output for A2 mentions staging-east');
    assert.ok(output.sources.length > 0, 'the output for A2 cites a source');
    const afterA = runs.length;
    await triggersA.onReviewerReply({ conversationKey: 'convA', text: U2, turnId: 'u2' });
    assert.equal(runs.length, afterA, 'repeating onReviewerReply(U2) does not call the model');

    // Conversation B: same workspace, started afterwards, no U1: it never sees convA.
    const triggersB = triggersFor(storeB);
    const B = 'Tests are green. Which environment should I run the smoke test in?';
    await agent(triggersB, 'convB', B, 'b1');
    assert.equal(JSON.stringify(stacks.read('convB').map(entry => entry.text)), JSON.stringify([B]), 'convB holds only its own agent final');
    const modelInputB = runs.at(-1).prompt;
    assert.ok(modelInputB.includes(B), 'the last run was convB\'s');
    assert.ok(!/staging-east/i.test(modelInputB), 'the model input for convB does not contain staging-east');
    assert.ok(!stacks.read('convB').some(entry => [U1, A1, U2, A2].includes(entry.text)));

    assert.ok(!overBudget && runs.length <= MAX_RUNS, `model runs ${runs.length} within budget ${MAX_RUNS}`);
    assert.equal(failures.length, 0, 'no trigger failure surfaced');
    console.log(`model runs: ${runs.length} (budget ${MAX_RUNS})`);
    console.log(`PASS EV-VALIDATOR-LIVE-LEARN real ${profile.model} learned staging-east from U2 and used it for A2; convB stayed separate; ${runs.length} model runs`);
    clearTimeout(watchdog);
})().catch(error => { console.error('FAIL EV-VALIDATOR-LIVE-LEARN:', error); clearTimeout(watchdog); process.exitCode = 1; });
