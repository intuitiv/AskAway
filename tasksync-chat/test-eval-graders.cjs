// Offline proof that eval graders reject the behaviors they exist to catch. Run: node test-eval-graders.cjs
const assert = require('node:assert/strict');
const { parseEvents, gradeWorker, gradePlan, modelTier } = require('./evals/graders.cjs');

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
const planText = (tracks) => `Plan:\n\`\`\`json\n${JSON.stringify({ goal: 'g', tracks })}\n\`\`\``;
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
console.log('EV-040 VerifiedByBehaviour: PASS codeByGradle=true codeByReview=false inspectionOnly=false authoringByDevx=true authoringByGradle=false');

console.log('EV-EVALS GraderRejections: PASS workerRejections=8 planRejections=8 eventFolding=exact');
