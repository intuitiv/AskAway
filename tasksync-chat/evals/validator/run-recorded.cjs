const fs = require('node:fs');
const { gradeCase } = require('./graders.cjs');

// Recorded fixtures only: no dispatch, provider, baseline gate or credential reads.
function runRecordedSuites(cases, { evalScoreboard, resultsFile, now = () => new Date().toISOString() }) {
    const records = Object.entries(cases).map(([suite, entries]) => {
        if (!entries.length) throw new Error(`Empty suite: ${suite}`);
        const grades = entries.map(testCase => ({ id: testCase.id, ...gradeCase(suite, testCase, testCase.recorded) }));
        return { ts: now(), suite: `validator-${suite}`, model: 'recorded-fixture', variant: 'offline', offline: true,
            verdict: grades.every(grade => grade.pass) ? 'PASS' : 'FAIL', score: grades.filter(grade => grade.pass).length / grades.length,
            cases: grades, usage: { cost: 0 }, durationMs: 0 };
    });
    if (resultsFile) fs.appendFileSync(resultsFile, records.map(row => JSON.stringify(row)).join('\n') + '\n');
    return { records, scoreboard: evalScoreboard(records) };
}
module.exports = { runRecordedSuites };
