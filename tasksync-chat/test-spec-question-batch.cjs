const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./node_modules/typescript');
const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const root = fs.mkdtempSync(path.join(build, 'spec-question-batch-'));
fs.writeFileSync(path.join(root, 'askCapture.js'), ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'src/specs/askCapture.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText);
const { captureAsks, updateAskOutcome, updateAskQuestions, batchAskQuestions } = require(path.join(root, 'askCapture.js'));
const slug = '005-questions';
fs.mkdirSync(path.join(root, 'specs', slug), { recursive: true });
fs.writeFileSync(path.join(root, 'specs', slug, 'spec.md'), '# Questions spec\n');
const taskFile = `specs/${slug}/tasks.md`;
const backlogFile = 'specs/BACKLOG.md';
const q = (text, options, recommendation) => ({ text, options, recommendation });
const firstQuestions = [q('Which format?', ['Table', 'List'], 'Table'), q('Which order?', ['Newest', 'Oldest'], 'Newest')];
const backlogQuestions = [q('Which scope | now?', ['Local | only', 'All'], 'Local | only')];
const [first, done] = captureAsks(root, slug, [
    { kind: 'request', text: 'Show coverage', questions: firstQuestions },
    { kind: 'bug', text: 'Fix completed issue', questions: [q('Completed question?', ['Yes', 'No'], 'Yes')] }
]);
const [waiting] = captureAsks(root, undefined, [{ kind: 'side remark', text: 'Review scope', questions: backlogQuestions }]);
updateAskOutcome(root, waiting, { status: 'waiting', reason: 'needs reviewer' });
updateAskOutcome(root, done, { status: 'done', evidence: 'test-fix.cjs PASS' });
const documents = () => Object.fromEntries([taskFile, backlogFile].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const snapshot = documents();
const message = batchAskQuestions(snapshot);
assert.equal(typeof message, 'string');
for (const question of [...firstQuestions, ...backlogQuestions]) {
    assert.ok(message.includes(question.text));
    assert.ok(message.includes(`Options: ${question.options.join(' / ')}`));
    assert.ok(message.includes(`Recommendation: ${question.recommendation}`));
}
assert.deepEqual([...message.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1])), [1, 2, 3]);
assert.ok(message.indexOf(first.text) < message.indexOf(firstQuestions[0].text));
assert.ok(message.indexOf(waiting.text) < message.indexOf(backlogQuestions[0].text));
assert.doesNotMatch(message, /Completed question/);
assert.deepEqual(documents(), snapshot);
assert.equal(batchAskQuestions(snapshot), message);
console.log('PASS batch: one numbered reviewer message contains every seeded open question across open and waiting asks, grouped with options and recommendations');

const extra = q('Which theme?', ['Light', 'Dark'], 'Light');
captureAsks(root, slug, [{ kind: 'repeated ask', text: waiting.text, questions: [extra] }]);
const enlarged = batchAskQuestions(documents());
assert.ok(enlarged.includes(extra.text));
assert.ok(enlarged.includes(firstQuestions[0].text));
assert.ok(enlarged.includes(backlogQuestions[0].text));
assert.equal([...enlarged.matchAll(/^\d+\. /gm)].length, 4);
assert.equal(captureAsks(root, undefined, [{ kind: 'repeated ask', text: waiting.text }])[0].questions.length, 2);
console.log('PASS single-ask addition: a question added to one ask joins the whole batch, never a separate message');

updateAskQuestions(root, first, firstQuestions.map((question, index) => index === 0 ? { ...question, answer: 'Table' } : question));
const partial = batchAskQuestions(documents());
assert.ok(!partial.includes(firstQuestions[0].text));
assert.ok(partial.includes(firstQuestions[1].text));
assert.deepEqual([...partial.matchAll(/^(\d+)\. /gm)].map(match => Number(match[1])), [1, 2, 3]);
updateAskQuestions(root, first, firstQuestions.map(question => ({ ...question, answer: question.recommendation })));
updateAskQuestions(root, waiting, [...backlogQuestions, extra].map(question => ({ ...question, answer: question.recommendation })));
assert.equal(batchAskQuestions(documents()), null);
assert.equal(batchAskQuestions({}), null);
assert.equal(captureAsks(root, slug, [{ kind: 'repeated ask', text: first.text }])[0].questions[0].answer, 'Table');
console.log('PASS answers: persisted answers drop out, numbering stays consecutive, and no open questions returns null');
