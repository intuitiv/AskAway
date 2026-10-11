const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('./node_modules/typescript');
const cases = require('./evals/validator/cases.json');
const { gradeCase } = require('./evals/validator/graders.cjs');
const { runRecordedSuites } = require('./evals/validator/run-recorded.cjs');
const loaded = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/evalScoreboard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(require, loaded, loaded.exports);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-offline-evals-'));
const resultsFile = path.join(root, 'results.jsonl');
let modelCalls = 0;
const originalFetch = global.fetch;
global.fetch = () => { modelCalls++; throw Error('Offline test forbids network'); };
try {
    const result = runRecordedSuites(cases, { evalScoreboard: loaded.exports.evalScoreboard, resultsFile });
    assert.equal(result.records.length, 3);
    assert.deepEqual(result.scoreboard.map(row => row.mode), ['validator-answer', 'validator-enhance', 'validator-store']);
    for (const row of result.records) {
        assert.equal(row.verdict, 'PASS', JSON.stringify(row.cases)); assert.equal(row.score, 1);
        console.log(`PASS ${row.suite.replace('validator-', '')} suite cases=${row.cases.length} recorded offline score=1`);
    }
    assert.deepEqual(loaded.exports.loadEvalScoreboard(resultsFile), result.scoreboard);
    assert.ok(result.scoreboard.every(row => row.runs === 1 && row.passed === 1 && row.avgCost === 0));
    const skip = cases.answer.find(row => row.kind === 'skip'); assert.ok(skip);
    assert.equal(gradeCase('answer', skip, { ...skip.recorded, modelCalls: 1 }).pass, false);
    assert.equal(gradeCase('answer', skip, { ...skip.recorded, skipped: false }).pass, false);
    assert.equal(gradeCase('answer', skip, { ...skip.recorded, usage: { cost: 1 } }).pass, false);
    console.log('PASS skip case present; model call and skip regressions rejected');
    const secret = cases.answer.find(row => row.kind === 'secret'); assert.ok(secret);
    for (const sink of ['modelInput', 'storage', 'commentary', 'costRecords']) {
        assert.equal(gradeCase('answer', secret, { ...secret.recorded, sinks: { ...secret.recorded.sinks, [sink]: secret.input.seededSecret } }).pass, false);
    }
    assert.doesNotMatch(fs.readFileSync(resultsFile, 'utf8'), /SYNTHETIC_SECRET_CANARY/);
    console.log('PASS secret-leak case present; every seeded sink leak rejected; ledger secret-free');
    const answer = cases.answer[0];
    assert.equal(gradeCase('answer', answer, { ...answer.recorded, answer: 'Use network.' }).pass, false);
    assert.equal(gradeCase('answer', answer, { ...answer.recorded, sources: ['invented.md'] }).pass, false);
    const enhance = cases.enhance[0];
    assert.equal(gradeCase('enhance', enhance, { ...enhance.recorded, proposals: [...enhance.recorded.proposals, ...enhance.recorded.proposals] }).pass, false);
    assert.equal(gradeCase('enhance', enhance, { ...enhance.recorded, prompt: 'changed' }).pass, false);
    const store = cases.store[0];
    assert.equal(gradeCase('store', store, { ...store.recorded, current: [...store.recorded.current, ...store.recorded.current] }).pass, false);
    const reversal = cases.store.at(-1);
    assert.equal(gradeCase('store', reversal, { ...reversal.recorded, history: [] }).pass, false);
    for (const suite of Object.keys(cases)) {
        const testCase = cases[suite][0];
        assert.equal(gradeCase(suite, testCase, { ...testCase.recorded, agentInputs: ['leaked advice'] }).pass, false);
    }
    assert.equal(modelCalls, 0);
    console.log('PASS EV-VALIDATOR-EVALS three scoreboard results offline; negative fixtures rejected; no model call');
} finally { global.fetch = originalFetch; }
