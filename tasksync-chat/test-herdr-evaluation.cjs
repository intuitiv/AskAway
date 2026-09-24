// AC-T006a: Herdr adapter evaluation completeness. Run: node test-herdr-evaluation.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const research = fs.readFileSync(
    path.join(__dirname, '..', 'specs', '001-async-subagent-runner', 'research.md'), 'utf8');

const section = research.split('## Herdr Adapter Evaluation')[1];
assert.ok(section, 'research.md must contain a Herdr Adapter Evaluation section');
const body = section.split(/\n## /)[0];

const rows = body.split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line) && !line.includes('| Capability |'));

const required = [
    'worker_start', 'worker_submit', 'worker_list', 'worker_status', 'worker_wait',
    'worker_cancel', 'worker_resume', 'worker_logs',
    'Session persistence', 'Reload and restart recovery', 'Blocked-state detection',
    'Per-run token, cost, and cache usage',
];
for (const capability of required) {
    assert.equal(rows.filter((row) => row.includes(capability)).length, 1, `one row for ${capability}`);
}
assert.equal(rows.length, required.length, `expected ${required.length} capability rows`);

const cited = rows.filter((row) => /https:\/\/herdr\.dev\/\S+/.test(row));
assert.equal(cited.length, rows.length, 'every capability row cites a source URL');

for (const row of rows) {
    const support = row.split('|')[2].trim();
    assert.ok(/^(Supported|Unsupported|Partial|Unknown)$/.test(support), `invalid support value: ${support}`);
    if (support === 'Unknown') {
        assert.match(row, /not fetched|unverified/i, 'Unknown rows must justify why');
    }
}

const recommendations = body.split('\n').filter((line) => line.includes('**Recommendation:**'));
assert.equal(recommendations.length, 1, 'exactly one recommendation');
assert.match(recommendations[0], /\b(adapter|reject|defer)\b/i, 'recommendation states a decision');
assert.ok(recommendations[0].length > 120, 'recommendation states rationale');

console.log(`EV-006a HerdrAdapterEvaluation: PASS rows=${rows.length} citedRows=${cited.length} unknownRowsJustified=true recommendations=1`);
