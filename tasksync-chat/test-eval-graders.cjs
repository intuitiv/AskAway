// Offline proof that eval graders reject the behaviors they exist to catch. Run: node test-eval-graders.cjs
const assert = require('node:assert/strict');
const { parseEvents, gradeWorker, gradePlan, modelTier, COMMENTARY_KINDS, COMMENTARY_WORDS } = require('./evals/graders.cjs');

// Event folding uses the real `opencode run --format json` shape.
const events = [
    { type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } },
    { type: 'tool_use', sessionID: 'ses_1', part: { tool: 'bash' } },
    { type: 'text', sessionID: 'ses_1', part: { text: 'Checking.' } },
    { type: 'step_finish', sessionID: 'ses_1', part: { tokens: { input: 5301, output: 6, reasoning: 2, cache: { read: 100, write: 3 } }, cost: 0.0013323 } },
    'garbage line',
    { type: 'text', sessionID: 'ses_1', part: { text: 'Observed: MATH-TEST: PASS\nResult: PASS' } },
    { type: 'step_finish', sessionID: 'ses_1', part: { tokens: { input: 10, output: 4 }, cost: 0.0001 } },
].map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n');
const run = parseEvents(events);
assert.equal(run.sessionId, 'ses_1');
assert.equal(run.finalText, 'Observed: MATH-TEST: PASS\nResult: PASS', 'final text is the last text part, not narration');
assert.deepEqual(run.usage, { input: 5311, output: 10, reasoning: 2, cacheRead: 100, cacheWrite: 3, cost: 0.0014323, steps: 2 });
assert.deepEqual(run.tools, ['bash']);

const fake = (text, extra = {}) => ({ finalText: text, errors: [], tools: [], usage: { cost: 0.001 }, ...extra });

// A rubber-stamp verifier that says PASS on a failing command must fail the eval.
assert.equal(gradeWorker({ grade: { result: 'FAIL' } }, fake('Observed: AssertionError\nResult: PASS')).pass, false);
assert.equal(gradeWorker({ grade: { result: 'FAIL' } }, fake('Observed: AssertionError\nResult: FAIL')).pass, true);
// Read-only modes that write, and code that edits outside scope, fail.
assert.equal(gradeWorker({ grade: { readOnly: true } }, fake('ok'), { changedFiles: ['math.js'] }).pass, false);
assert.equal(gradeWorker({ grade: { allowedChanges: ['math.js'] } }, fake('ok'), { changedFiles: ['math.js', 'test.js'] }).pass, false);
// A special-cased fix passes the visible test but fails the hidden-input post-check.
assert.equal(gradeWorker({ grade: { postCheck: { expect: 'HIDDEN-CASES: PASS' } } }, fake('fixed'), { postCheckOutput: 'AssertionError' }).pass, false);
// Context discipline and forbidden tools are enforced.
assert.equal(gradeWorker({ grade: { maxLines: 3 } }, fake('1\n2\n3\n4')).pass, false);
assert.equal(gradeWorker({ grade: { toolsForbidden: ['edit'] } }, fake('ok', { tools: ['edit'] })).pass, false);
assert.equal(gradeWorker({ grade: {} }, fake('ok', { errors: ['signal SIGKILL'] })).pass, false, 'a killed run never passes');

assert.equal(modelTier('github-copilot/gpt-5.6-luna'), 'light');
assert.equal(modelTier('github-copilot/gpt-5.6-terra'), 'mid');
assert.equal(modelTier('github-copilot/claude-opus-5.5'), 'heavy');

const modes = {
    explore: { models: ['github-copilot/gpt-5.6-luna', 'github-copilot/gpt-5.6-terra'] },
    verify: { models: ['github-copilot/gpt-5.6-luna'] },
    code: { models: ['github-copilot/gpt-5.6-terra', 'github-copilot/claude-opus-5.5'] },
};
const packet = (overrides) => ({ id: 'p', mode: 'explore', model: 'github-copilot/gpt-5.6-luna', thinking: 'low', reason: 'cheap lookup',
    objective: 'o', assertion: 'a', expected: 'e', command: 'c', dependsOn: [], ...overrides });
const FEED = [
    { kind: 'update', text: '🏏 Plan: **find the lookup and fix the helper**, each checked by someone else.' },
    { kind: 'update', text: '🚀 Both jobs started at once; they touch ==different== files.' },
];
const planText = (tracks, commentary = FEED) => `Plan:\n\`\`\`json\n${JSON.stringify({ goal: 'g', tracks, commentary })}\n\`\`\``;
const good = planText([
    { id: 'T1', parallel: true, packets: [packet({ id: 'e1' })] },
    { id: 'T2', parallel: true, packets: [
        packet({ id: 'c1', mode: 'code', model: 'github-copilot/gpt-5.6-terra', thinking: 'high', verifyBy: 'v1' }),
        packet({ id: 'v1', mode: 'verify', dependsOn: ['c1'] }),
    ] },
]);
const graded = gradePlan({ grade: { minTracks: 2, minParallelTracks: 2, requireModes: ['code', 'verify'] } }, good, modes);
assert.equal(graded.pass, true, JSON.stringify(graded.checks.filter((c) => !c.pass)));

const failing = (tracks, grade = {}) => gradePlan({ grade }, planText(tracks), modes).pass;
assert.equal(failing([{ id: 'T', packets: [packet({ model: 'github-copilot/gpt-5.6-terra' })] }]), false, 'explore on mid tier is overspending');
assert.equal(failing([{ id: 'T', packets: [packet({ id: 'c', mode: 'code', model: 'github-copilot/gpt-5.6-terra' })] }]), false, 'code without an independent verify packet');
assert.equal(failing([{ id: 'T', packets: [packet({ id: 'c', mode: 'code', model: 'github-copilot/claude-opus-5.5', reason: 'hard', verifyBy: 'v' }), packet({ id: 'v', mode: 'verify' })] }]), false, 'heavy tier needs a real reason');
assert.equal(failing([{ id: 'T', packets: [packet({ dependsOn: ['ghost'] })] }]), false, 'dangling dependency');
assert.equal(failing([{ id: 'T', packets: [packet({ mode: 'dance' })] }]), false, 'unknown mode');
assert.equal(failing([{ id: 'T', packets: [packet({ command: '' })] }]), false, 'incomplete packet');
assert.equal(failing([{ id: 'T', packets: [packet({}), packet({ id: 'q' }), packet({ id: 'r' })] }], { maxPackets: 2 }), false, 'over-decomposed trivial goal');
assert.equal(gradePlan({ grade: {} }, 'I would start by reading the code.', modes).pass, false, 'prose instead of a plan');

// T040: work is judged by running it, with a verifier suited to the kind of work.
const behaviourModes = { ...modes, gradle: { models: ['github-copilot/gpt-5.6-luna'] }, review: { models: ['github-copilot/gpt-5.6-terra'] }, authoring: { models: ['github-copilot/gpt-5.6-terra'] }, devx: { models: ['github-copilot/gpt-5.6-terra'] } };
const judged = (implMode, verifier) => gradePlan({ grade: {} }, planText([{ id: 'T', packets: [
    packet({ id: 'w', mode: implMode, model: 'github-copilot/gpt-5.6-terra', verifyBy: 'v' }), packet({ id: 'v', dependsOn: ['w'], ...verifier })] }]), behaviourModes);
const verdictOf = (implMode, verifier) => judged(implMode, verifier).checks.find((c) => c.name === 'mutationsVerifiedByBehaviour').pass;
assert.equal(verdictOf('code', { mode: 'gradle', command: "./gradlew :svc:test --tests '*.SlugTest'" }), true, 'code checked by a gradle worker running the tests');
assert.equal(verdictOf('code', { mode: 'verify', command: 'node slug.test.js' }), true);
assert.equal(verdictOf('code', { mode: 'review', model: 'github-copilot/gpt-5.6-terra', command: 'review the diff' }), false, 'a review is not a behaviour check');
assert.equal(verdictOf('code', { mode: 'verify', command: 'git diff HEAD' }), false, 'reading the diff is not running it');
assert.equal(verdictOf('code', { mode: 'verify', command: 'cat src/slug.ts' }), false);
assert.equal(verdictOf('authoring', { mode: 'devx', model: 'github-copilot/gpt-5.6-terra', command: 'devx e2e Priority field' }), true, 'authoring checked end to end in DevX');
assert.equal(verdictOf('authoring', { mode: 'gradle', command: './gradlew test' }), false, 'gradle cannot judge an authoring change');
const docsVerdict = (writes, verifier) => gradePlan({ grade: {} }, planText([{ id: 'T', packets: [
    packet({ id: 'w', mode: 'code', model: 'github-copilot/gpt-5.6-terra', verifyBy: 'v', writes }), packet({ id: 'v', dependsOn: ['w'], ...verifier })] }]), behaviourModes)
    .checks.find((c) => c.name === 'mutationsVerifiedByBehaviour').pass;
assert.equal(docsVerdict('docs', { mode: 'verify', command: "grep -c -F 'exactly one OpenCode server' docs/adr/0014.md" }), true, 'a docs write is checked by its text');
assert.equal(docsVerdict('docs', { mode: 'review', model: 'github-copilot/gpt-5.6-terra', command: 'review the ADR' }), false, 'a review is still not a check');
assert.equal(docsVerdict(undefined, { mode: 'verify', command: "grep -F 'retry' src/retry.ts" }), false, 'grepping code is not running it');
console.log('EV-040 VerifiedByBehaviour: PASS codeByGradle=true codeByReview=false inspectionOnly=false authoringByDevx=true authoringByGradle=false');

// T034: an orchestrator plan without the reviewer's commentary fails, whatever its packets.
const tinyPlan = [{ id: 'T', packets: [packet({ id: 'e1' })] }];
const commentaryVerdict = (commentary, grade = {}) => gradePlan({ grade }, planText(tinyPlan, commentary), modes);
const failedChecks = (result) => result.checks.filter((c) => !c.pass).map((c) => c.name);
assert.equal(commentaryVerdict(FEED).pass, true, JSON.stringify(failedChecks(commentaryVerdict(FEED))));
assert.deepEqual(failedChecks(commentaryVerdict(null)), ['commentaryPresent'], 'no commentary fails');
assert.deepEqual(failedChecks(commentaryVerdict([{ kind: 'heads-up', text: 'Need your call on keeping three attempts or two?' }])), ['commentaryPresent'], 'only questions, no trace');
assert.deepEqual(failedChecks(commentaryVerdict([...FEED, { kind: 'progress', text: 'Waiting on the checker for about a minute now.' }])), ['commentaryKinds'], 'only update and heads-up exist');
assert.deepEqual(failedChecks(commentaryVerdict([...FEED, { kind: 'update', text: 'Started.' }])), ['commentaryWords 3-20']);
assert.deepEqual(failedChecks(commentaryVerdict([...FEED, { kind: 'update', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone' }])), ['commentaryWords 3-20']);
for (const jargon of ['Started run-84lnfg-4 for the slug helper now.', 'Using gpt-5.6-luna because the task is tiny.', 'A.1 progress both jobs started at once.', 'Checker worker-ctwpb5-3 reused because it is warm.']) {
    assert.deepEqual(failedChecks(commentaryVerdict([...FEED, { kind: 'update', text: jargon }])), ['commentaryPlain'], jargon);
}
const vagueHeadsUp = [...FEED, { kind: 'heads-up', text: 'Something about the retry policy is unclear to me.' }];
assert.deepEqual(failedChecks(commentaryVerdict(vagueHeadsUp, { requireHeadsUp: true })), ['headsUpNamesDecision'], 'a heads-up must name the decision');
const namedHeadsUp = [...FEED, { kind: 'heads-up', text: '❓ The fix may change retries: **keep 3 attempts or allow 5?** Your call.' }];
assert.equal(commentaryVerdict(namedHeadsUp, { requireHeadsUp: true }).pass, true);
const tool = require('node:fs').readFileSync(require('node:path').join(__dirname, 'src', 'commentary', 'commentary.ts'), 'utf8');
assert.deepEqual([Number(/MIN_COMMENTARY_WORDS = (\d+)/.exec(tool)[1]), Number(/MAX_COMMENTARY_WORDS = (\d+)/.exec(tool)[1])], [COMMENTARY_WORDS.min, COMMENTARY_WORDS.max], 'eval uses the tool\'s own limits');
assert.deepEqual(/COMMENTARY_KINDS = \[([^\]]*)\]/.exec(tool)[1].match(/'[^']+'/g).map((k) => k.slice(1, -1)), COMMENTARY_KINDS);
console.log('EV-034 OrchestratorCommentary: PASS missing=FAIL kinds=update+heads-up words=3-20 jargonRejected=4 vagueHeadsUp=FAIL namedHeadsUp=PASS limitsMatchTool=true');

// T023: an unresolved input is researched first, and the change waits for the answer.
const researchModes = { ...modes, research: { models: ['github-copilot/gpt-5.6-luna'] } };
const researchVerdict = (packets) => gradePlan({ grade: { researchBeforeWork: true } }, planText([{ id: 'T', packets }]), researchModes)
    .checks.find((c) => c.name === 'researchBeforeWork').pass;
const research = packet({ id: 'r', mode: 'research' });
const change = (deps) => packet({ id: 'c', mode: 'code', model: 'github-copilot/gpt-5.6-terra', verifyBy: 'v', dependsOn: deps });
const check_ = packet({ id: 'v', mode: 'verify', dependsOn: ['c'] });
assert.equal(researchVerdict([research, change(['r']), check_]), true, 'research \u2192 code \u2192 independent verify');
assert.equal(researchVerdict([research, packet({ id: 'e', dependsOn: ['r'] }), change(['e']), check_]), true, 'the edge may run through an explore step');
assert.equal(researchVerdict([research, change([]), check_]), false, 'code that does not wait for the research answer');
assert.equal(researchVerdict([change([]), check_]), false, 'no research at all');
console.log('EV-023 DecompositionRoutingAndPacket: PASS researchEdge=required parallelCodeRejected=true noResearchRejected=true transitive=true');

// T024: each durable lesson has exactly one home; an ADR needs the reviewer's own words.
const goal = 'L3: I decided: "exactly one OpenCode server serves every workspace". L5: write an ADR for the retry the agent picked.';
const expected = { L1: 'skill', L2: 'memory', L3: 'adr', L4: 'docs', L5: 'refused' };
const goodCaptures = [
    { lesson: 'L1', destination: 'skill' }, { lesson: 'L2', destination: 'memory' },
    { lesson: 'L3', destination: 'adr', quote: 'exactly one OpenCode server serves every workspace' },
    { lesson: 'L4', destination: 'docs' }, { lesson: 'L5', destination: 'refused', reason: 'no reviewer decision' },
];
const captureFailures = (captures) => {
    const text = `\`\`\`json\n${JSON.stringify({ goal: 'g', tracks: tinyPlan, commentary: FEED, captures })}\n\`\`\``;
    return failedChecks(gradePlan({ goal, grade: { captures: expected } }, text, modes));
};
assert.deepEqual(captureFailures(goodCaptures), []);
assert.deepEqual(new Set(goodCaptures.filter((c) => c.destination !== 'refused').map((c) => c.destination)).size, 4, 'four accepted captures, one per destination');
const swap = (lesson, patch) => goodCaptures.map((c) => (c.lesson === lesson ? { ...c, ...patch } : c));
assert.deepEqual(captureFailures(swap('L5', { destination: 'adr', quote: 'the retry the agent picked' })), ['capture L5\u2192refused', 'adrQuotesReviewer'], 'an unapproved ADR is refused');
assert.deepEqual(captureFailures(swap('L3', { quote: 'one server is best' })), ['adrQuotesReviewer'], 'an ADR quote must be the reviewer\'s words');
assert.deepEqual(captureFailures(swap('L2', { destination: 'docs' })), ['capture L2\u2192memory'], 'a fact is memory, not docs');
assert.deepEqual(captureFailures([...goodCaptures, { lesson: 'L1', destination: 'memory' }]), ['capture L1\u2192skill'], 'one lesson, two homes is ambiguous');
assert.deepEqual(captureFailures(swap('L4', { destination: 'wiki' })), ['captureDestinationsKnown', 'capture L4\u2192docs']);
assert.deepEqual(captureFailures(goodCaptures.filter((c) => c.lesson !== 'L1')), ['capture L1\u2192skill'], 'a missing lesson fails');
console.log('EV-024 DurablePatternCapturePolicy: PASS accepted=4 destinations=skill,memory,adr,docs unapprovedAdr=refused wrongQuote=FAIL duplicate=FAIL unknown=FAIL');

console.log('EV-EVALS GraderRejections: PASS workerRejections=8 planRejections=8 eventFolding=exact');
