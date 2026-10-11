const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, pass) => ({ name, pass: Boolean(pass) });
const ids = rows => rows.map(row => row.ref).sort();

function gradeCase(suite, testCase, output) {
    const checks = [check('betaIsolation', Array.isArray(output.agentInputs) && output.agentInputs.length === 0)];
    const expected = testCase.expected;
    if (testCase.kind === 'skip') {
        checks.push(check('cheapCheckSkip', output.skipped === true),
            check('noModelCall', output.modelCalls === 0), check('zeroCost', output.usage?.cost === 0));
    } else if (testCase.kind === 'secret') {
        const names = ['modelInput', 'storage', 'commentary', 'costRecords'];
        checks.push(check('noModelCall', output.modelCalls === 0));
        for (const name of names) {
            checks.push(check(`secretFree:${name}`, typeof output.sinks?.[name] === 'string'
                && !output.sinks[name].includes(testCase.input.seededSecret)));
        }
        checks.push(check('secretFree:output', !JSON.stringify(output).includes(testCase.input.seededSecret)));
    } else if (suite === 'answer') {
        checks.push(check('reviewerDecision', output.answer === expected.answer),
            check('exactSources', same(output.sources, expected.sources)),
            check('realSources', Array.isArray(output.sources) && output.sources.every(id => Object.hasOwn(testCase.input.sources, id))));
    } else if (suite === 'enhance') {
        const proposals = Array.isArray(output.proposals) ? output.proposals : [];
        checks.push(check('proposalShape', Array.isArray(output.proposals)),
            check('exactRelevantContext', same(ids(proposals), [...expected.refs].sort())),
            check('noDuplicate', new Set(ids(proposals)).size === proposals.length),
            check('knownContext', proposals.every(row => testCase.input.stored.some(item => item.id === row.ref && item.text === row.reason))),
            check('promptByteIdentical', output.prompt === testCase.input.prompt));
    } else if (suite === 'store') {
        const current = Array.isArray(output.current) ? output.current : [];
        const facts = current.map(({ text, example, supersedesId }) => ({ text, ...(example ? { example } : {}), ...(supersedesId ? { supersedesId } : {}) }));
        checks.push(check('storeShape', Array.isArray(output.current) && Array.isArray(output.history)),
            check('exactFactsAndExample', same(facts, expected.current)),
            check('concise', current.every(row => typeof row.text === 'string' && row.text.length <= 280 && (!row.example || row.example.length <= 280))),
            check('storedOnce', new Set(current.map(row => String(row.text).toLowerCase())).size === current.length),
            check('retainedHistory', same((output.history || []).map(row => row.id).sort(), [...expected.historyIds].sort())));
    } else { checks.push(check('knownSuite', false)); }
    return { pass: checks.every(row => row.pass), checks };
}
module.exports = { gradeCase };
