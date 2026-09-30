// 005 US7: readiness results never report PASS without evidence; readinessLines is deterministic plain text.
// Run: node test-spec-readiness.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-spec-readiness-'));
for (const name of ['stages', 'runRecords', 'readiness']) {
    const source = fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8');
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(source,
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { normalizeReadiness, readinessLines } = require(path.join(buildDir, 'readiness.js'));

const input = {
    checks: [
        { name: 'tests', status: 'PASS', evidence: 'npm test: 12 passed' },
        { name: 'lint', status: 'PASS' },
        { name: 'e2e', status: 'BLOCKED', reason: 'tool unavailable' },
        { name: 'perf', status: 'FAIL', reason: 'too slow', evidence: 'p95 900ms' },
        { name: 'docs', status: 'N/A' }
    ],
    openFindings: ['flaky retry'],
    residualRisk: []
};
const snapshot = JSON.stringify(input);
const normalized = normalizeReadiness(input);
assert.equal(JSON.stringify(input), snapshot, 'input not mutated');
const byName = Object.fromEntries(normalized.checks.map(c => [c.name, c]));
assert.equal(byName.e2e.status, 'BLOCKED');
assert.equal(byName.e2e.reason, 'tool unavailable');
assert.equal(byName.lint.status, 'BLOCKED');
assert.equal(byName.lint.reason, 'no evidence');
assert.equal(byName.tests.status, 'PASS');

const lines = readinessLines(input);
assert.deepEqual(lines, [
    'Readiness: 1 PASS · 1 FAIL · 2 BLOCKED · 1 N/A',
    'PASS tests (evidence: npm test: 12 passed)',
    'BLOCKED lint — no evidence',
    'BLOCKED e2e — tool unavailable',
    'FAIL perf — too slow (evidence: p95 900ms)',
    'N/A docs',
    'Open findings:',
    '- flaky retry',
    'Residual risk: none'
]);
assert.deepEqual(readinessLines(input), lines, 'deterministic');
assert.ok(!lines.join('\n').includes('<'), 'no markup');
console.log('PASS test-spec-readiness: no-evidence PASS downgraded, counts exact, lines deterministic plain text');
