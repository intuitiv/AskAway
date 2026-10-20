// Beta quality review (FR-015, SC-009): results are readable by a person, no baseline gate, and a real reviewer correction joins later runs.
// Run: node test-validator-eval-baseline.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('./node_modules/typescript');
const { runRecordedSuites } = require('./evals/validator/run-recorded.cjs');
const { addReviewerCorrection, reviewReport } = require('./evals/validator/add-correction.cjs');
const loaded = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/evalScoreboard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(require, loaded, loaded.exports);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-review-'));
const casesFile = path.join(dir, 'cases.json');
fs.copyFileSync(path.join(__dirname, 'evals/validator/cases.json'), casesFile);
const run = () => runRecordedSuites(JSON.parse(fs.readFileSync(casesFile, 'utf8')), { evalScoreboard: loaded.exports.evalScoreboard, resultsFile: path.join(dir, 'results.jsonl') });
const before = run();
const counts = Object.fromEntries(before.records.map(row => [row.suite, row.cases.length]));

// The prediction said "Use network."; the reviewer replied "Run tests offline." That pair is the correction.
const correction = { id: 'reviewer-offline-tests', input: { response: 'Should CI use the network?', sources: { 'Rules.md': 'Tests must run offline.' } },
    expected: { answer: 'Run tests offline.', sources: ['Rules.md'] }, recorded: { answer: 'Run tests offline.', sources: ['Rules.md'], agentInputs: [] } };
addReviewerCorrection(casesFile, 'answer', correction, () => '2026-10-20T00:00:00.000Z');
const after = run();
assert.equal(after.records.find(row => row.suite === 'validator-answer').cases.length, counts['validator-answer'] + 1, 'the correction is part of the next run');
const added = after.records.find(row => row.suite === 'validator-answer').cases.find(grade => grade.id === correction.id);
assert.equal(added.origin, 'reviewer-correction');
assert.equal(added.pass, true);
assert.equal(JSON.parse(fs.readFileSync(casesFile, 'utf8')).answer.at(-1).addedAt, '2026-10-20T00:00:00.000Z');
assert.throws(() => addReviewerCorrection(casesFile, 'answer', correction), /Duplicate case id/);
assert.throws(() => addReviewerCorrection(casesFile, 'nope', { ...correction, id: 'x' }), /Unknown suite/);
assert.throws(() => addReviewerCorrection(casesFile, 'answer', { id: 'y' }), /needs input/);

// A regressing case is reported for a person to read, never thrown as a baseline failure.
const regressed = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
regressed.answer.find(row => row.id === correction.id).recorded.answer = 'Use network.';
const result = runRecordedSuites(regressed, { evalScoreboard: loaded.exports.evalScoreboard });
const report = reviewReport(result.records);
assert.match(report, /validator-answer FAIL/);
assert.match(report, /FAIL reviewer-offline-tests \(reviewer-correction\) \[reviewerDecision\]/);
assert.match(report, /validator-enhance PASS score=1\.00/);
console.log('test-validator-eval-baseline: passed (results readable for manual review; reviewer correction included in later runs; no baseline gate)');
