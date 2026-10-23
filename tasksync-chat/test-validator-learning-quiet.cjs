const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
const root = fs.mkdtempSync(path.join(__dirname, 'build/validator-learning-quiet-'));
require('./tools/transpile-src.cjs').transpileSrc(root);
const ts = require('./node_modules/typescript');
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools',
    'commentary/commentary', 'specs/specCostLedger', 'validator/profile', 'validator/redact', 'validator/records', 'validator/observer',
    'validator/conversationStack', 'validator/validatorTriggers', 'team/validatorMatch']) {
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
const { withMatchScore, matchChipHtml, matchLabel } = require(path.join(root, 'team/validatorMatch.js'));

const workspace = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspace, 'specs/007-demo'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'specs/007-demo/Rules.md'), 'Prefer sequential work.');
const commentary = new CommentaryStore({ dir: path.join(root, 'commentary-state') });
const items = [];
const store = {
    async remember(fact, scope) { items.push({ fact, scope }); },
    async recall() { return []; },
};
const run = async input => {
    if (input.prompt.includes('Compare prediction with reviewer reply')) {
        return { text: JSON.stringify({ answer: null, sources: [], related: true, matched: true, diff: '', facts: [{ kind: 'rule', text: 'Learned.' }] }), usage: { input: 1, output: 1, cost: 0 } };
    }
    return { text: JSON.stringify({ answer: 'Guess.', sources: ['specs/007-demo/Rules.md'], observations: '', summary: '', impact: '' }), usage: { input: 1, output: 1, cost: 0 } };
};
const observer = new ValidatorObserver({ workspaceRoot: workspace, commentary, costFile: path.join(root, 'cost.json'), timeoutMs: 500,
    knowledgeStore: store, knowledgeScope: { project: 'fixture', agentId: 'validator', spec: '007-demo' }, run });
const stacks = new ConversationStacks({ dir: path.join(root, 'stacks') });
const triggers = new ValidatorTriggers(workspace, async () => observer, () => '007-demo', () => { throw new Error('failed'); }, () => [], { stacks, sessionContinues: () => false });
const texts = () => (commentary.read(workspace).validatorItems ?? []).map(i => i.text);
const priya = () => withMatchScore([{ id: 'priya' }, { id: 'tara' }], workspace);

(async () => {
    assert.equal(matchLabel({ matched: 2, compared: 4 }), 'Match: learning (4 compared)', 'under 10 compared: no ratio');
    assert.equal(matchLabel({ matched: 7, compared: 10 }), 'Match 7/10');
    assert.equal(priya()[0].match.compared, 0);
    assert.equal(priya()[1].match, undefined, 'only Priya carries the score');

    stacks.append('K', { role: 'agent', text: 'A1', turnId: 'a1', at: Date.now() });
    await triggers.onAgentFinal({ conversationKey: 'K', text: 'A1', turnId: 'a1' });
    const before = texts().length;
    stacks.append('K', { role: 'user', text: 'U2', turnId: 'u2', at: Date.now() });
    await triggers.onReviewerReply({ conversationKey: 'K', text: 'U2', turnId: 'u2' });

    assert.equal(texts().length, before, 'a reviewer reply after a prediction publishes no validator item');
    assert.ok(!texts().some(t => /match measure|not told me|no source answers|prediction (matched|mismatched)/i.test(t.replace(/^Validator: no source answers this question\.$/, ''))), 'no score or no-answer bubble');
    assert.ok(items.some(i => i.fact.text === 'Learned.'), 'facts are still recorded');

    const member = priya()[0];
    assert.deepEqual([member.match.matched, member.match.compared], [1, 1], 'the match total is recorded');
    assert.match(member.match.label, /^Match: learning/, 'fewer than 10 compared shows no ratio');
    assert.ok(!/\d\/\d/.test(matchChipHtml(member.match)), 'rendered chip shows no ratio');
    assert.ok(matchChipHtml(member.match).includes('team-chip'), 'reuses the team-chip block');

    const records = new ValidatorRecords(workspace, 'other-spec');
    for (let i = 0; i < 9; i++) records.appendPrediction({ id: 'p' + i, responseId: 'r' + i, decision: 'd', ts: i, matched: i < 5 });
    assert.equal(matchChipHtml(priya()[0].match).includes('Match 6/10'), true, 'summed over all specs: 1/1 + 5/9 shows Match 6/10');

    // The real Team render: workers state for this workspace -> Priya's compact row.
    const vm = require('node:vm');
    const { projectTeamMembers } = require(path.join(root, 'workers/workersState.js'));
    const source = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
    const browser = {
        acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
        document: { readyState: 'loading', addEventListener() {}, createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }), getElementById: () => null, querySelectorAll: () => [] },
        window: {}, console, setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {},
    };
    vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, 'globalThis.ui = { renderWorkersHtml }; }());'), browser);
    const rows = html => Object.fromEntries(html.split('<div class="team-member-row').slice(1).map(row => [/data-member-id="([^"]+)"/.exec(row)[1], row]));
    const render = ws => rows(browser.ui.renderWorkersHtml({ members: projectTeamMembers([], undefined, ws).map(m => ({ ...m, turnCost: 1 })), workers: [], generatedAt: Date.now() }, '', {}));
    const shown = render(workspace);
    assert.ok(shown.priya.includes('Match 6/10'), "Priya's compact row shows Match 6/10");
    for (const [id, row] of Object.entries(shown)) if (id !== 'priya') assert.ok(!row.includes('team-chip-match'), id + ' has no match chip');
    assert.ok(Object.keys(shown).length > 1, 'other members are rendered too');
    const fresh = fs.mkdtempSync(path.join(root, 'fresh-'));
    assert.ok(render(fresh).priya.includes('Match: learning (0 compared)'), 'a workspace without folders shows the learning text');
    fs.rmSync(fresh, { recursive: true });
    console.log('PASS EV-VALIDATOR-LEARNING-QUIET: learning comparison is silent, match total recorded and shown in Priya header model');
})().catch(error => { console.error(error); process.exitCode = 1; });
