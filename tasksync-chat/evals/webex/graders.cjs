const slop = /\b(?:i hope this|certainly|delve|great question|i wanted to reach out|please let me know if)\b/i;
const words = text => text.trim().split(/\s+/).filter(Boolean).length;
const casing = text => {
    const starts = text.split(/[.!?]\s+|\n+/).map(part => part.match(/[a-zA-Z]/)?.[0]).filter(Boolean);
    if (!starts.length) return 'unknown';
    const lower = starts.filter(letter => letter === letter.toLowerCase()).length;
    return lower > starts.length / 2 ? 'lower' : 'upper';
};
function gradeDraft(draft, testCase) {
    const text = draft.text || '';
    const expected = testCase.expected;
    const sampleCases = testCase.styleSamples.map(casing).filter(value => value !== 'unknown');
    const sampleCasing = sampleCases.filter(value => value === 'lower').length > sampleCases.length / 2 ? 'lower' : 'upper';
    return {
        wordCap: !expected.question || words(text) <= 30,
        hasExample: !expected.question || /\b(?:for example|e\.g\.|like|such as)[,:]?\s+\S+/i.test(text),
        noSlopPhrases: !slop.test(text),
        noEmDash: !text.includes('—'),
        matchesSampleCasing: !sampleCases.length || casing(text) === sampleCasing,
        correctRecipient: draft.roomId === expected.roomId && draft.toPersonEmail === expected.toPersonEmail,
        correctThread: draft.parentId === expected.parentId,
        styleSimilarity: { status: 'skipped', reason: 'Offline placeholder; no model calls.' },
    };
}
module.exports = { gradeDraft };
