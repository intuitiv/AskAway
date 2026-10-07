const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyse } = require('./tools/worker-analyst.cjs');

const lines = fs.readFileSync(path.join(__dirname, 'test-fixtures/worker-analyst/workers.jsonl'), 'utf8').split('\n');
const report = analyse(lines);
let matched = 0;
function test(name, check) {
    try { check(); matched++; }
    catch (error) {
        console.error(`${name}: ${error.message}\n${error.stack.split('\n').slice(1, 4).join('\n')}`);
        process.exit(1);
    }
}

test('ping reuse must precede expiry, including reuse after expiry as a miss', () => {
    assert.ok(report.includes('Pings: 2; spent: $0.75; pinged workers: 2; hits: 1; HIT RATE: 50.0% (1/2); expired with no ping: 1'), 'ping count, spend, worker hit rate or unpinged expiry is incorrect');
});
test('harness ratios are weighted by tokens and completed runs', () => {
    const ratios = report.split('#### 6. Harness ratios')[1];
    assert.ok(ratios.includes('| model-a | 10.00 | 1.00 | 86.7 |'), 'model-a ratios must include the ping and three completed runs');
    assert.ok(ratios.includes('| model-b | 5.71 | 1.33 | 70.0 |'), 'model-b ratios must include the missed ping');
    assert.ok(ratios.includes('| code | 10.00 | 1.00 | 86.7 |'), 'code profile ratios incorrect');
    assert.ok(ratios.includes('| test | 5.71 | 1.33 | 70.0 |'), 'test profile ratios incorrect');
    assert.ok(ratios.includes('| Overall | 7.00 | 1.17 | 77.1 |'), 'overall ratios must use summed tokens rather than average model ratios');
});
test('end-of-life and reused workers remain visible', () => {
    assert.ok(report.includes('Workers: 6; ended: expired idle >5min 3, archived 1, retired 1, still live 1'), 'worker end-of-life counts incorrect');
    assert.ok(report.includes('| <30K | 6 |'), 'end-of-life context bucket count incorrect');
    assert.ok(report.includes('| hit | 2 | 100 | expired idle >5min |'), 'real reused worker must have two runs, not a separate ping run');
});
test('malformed lines are skipped without changing the report', () => {
    assert.equal(analyse(lines.filter((line) => line !== 'not valid JSON')), report, 'malformed ledger line altered analysis');
    assert.equal(analyse([...lines].reverse()), report, 'analysis must sort ledger timestamps');
});
test('empty ledgers produce finite zero rates', () => {
    const empty = analyse(['bad JSON']);
    assert.ok(empty.includes('HIT RATE: 0.0% (0/0)'), 'empty ping population must have zero hit rate');
    assert.ok(!/NaN|Infinity/.test(empty), 'empty report contains non-finite ratios');
});
console.log(`PASS EV-WORKER-ANALYST matched=${matched}`);
