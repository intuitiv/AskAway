const fs = require('node:fs');

// A real reviewer correction (the Validator's prediction against the reviewer's reply) becomes a case,
// so every later run of the suites includes it (FR-015). The recorded output is what the prompt must now produce.
function addReviewerCorrection(casesFile, suite, testCase, now = () => new Date().toISOString()) {
    const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
    if (!Array.isArray(cases[suite])) throw new Error(`Unknown suite: ${suite}`);
    for (const field of ['id', 'input', 'expected', 'recorded']) if (testCase?.[field] === undefined) throw new Error(`Correction needs ${field}`);
    if (Object.values(cases).some(entries => entries.some(entry => entry.id === testCase.id))) throw new Error(`Duplicate case id: ${testCase.id}`);
    cases[suite].push({ ...testCase, origin: 'reviewer-correction', addedAt: now() });
    fs.writeFileSync(casesFile, JSON.stringify(cases, null, 2) + '\n');
    return cases;
}

// Plain-text result table for manual quality review; there is no baseline to compare with in beta (SC-009).
function reviewReport(records) {
    return records.map(row => {
        const lines = row.cases.map(grade => `  ${grade.pass ? 'pass' : 'FAIL'} ${grade.id}${grade.origin ? ` (${grade.origin})` : ''}`
            + (grade.pass ? '' : ` [${(grade.checks || []).filter(check => !check.pass).map(check => check.name).join(', ')}]`));
        return [`${row.suite} ${row.verdict} score=${row.score.toFixed(2)}`, ...lines].join('\n');
    }).join('\n');
}

if (require.main === module) {
    const [file, suite, json] = process.argv.slice(2);
    if (!file || !suite || !json) { console.error('Usage: node add-correction.cjs <cases.json> <answer|enhance|store> \'<case json>\''); process.exit(2); }
    addReviewerCorrection(file, suite, JSON.parse(json));
    console.log(`Added reviewer correction to ${suite}`);
}
module.exports = { addReviewerCorrection, reviewReport };
