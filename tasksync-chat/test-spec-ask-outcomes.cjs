const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./node_modules/typescript');

const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const root = fs.mkdtempSync(path.join(build, 'spec-ask-outcomes-'));
fs.writeFileSync(path.join(root, 'askCapture.js'), ts.transpileModule(
    fs.readFileSync(path.join(__dirname, 'src/specs/askCapture.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText);
const { captureAsks, updateAskOutcome, askProgressReport } = require(path.join(root, 'askCapture.js'));
const slug = '005-outcomes';
fs.mkdirSync(path.join(root, 'specs', slug), { recursive: true });
fs.writeFileSync(path.join(root, 'specs', slug, 'spec.md'), '# Outcomes spec\n');
const taskFile = `specs/${slug}/tasks.md`;
const backlogFile = 'specs/BACKLOG.md';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const documents = () => ({ [taskFile]: read(taskFile), [backlogFile]: read(backlogFile) });
const [complete, blocked, open] = captureAsks(root, slug, [
    { kind: 'request', text: 'Show tracked coverage' },
    { kind: 'bug', text: 'Fix unavailable service' },
    { kind: 'correction', text: 'Keep unfinished work visible' }
]);
const [backlog] = captureAsks(root, undefined, [{ kind: 'side remark', text: 'Follow up after review' }]);
const before = read(taskFile);
for (const evidence of ['', '  \n\t ']) {
    assert.throws(() => updateAskOutcome(root, complete, { status: 'done', evidence }), /requires evidence/);
    assert.equal(read(taskFile), before);
}
assert.throws(() => updateAskOutcome(root, blocked, { status: 'waiting', reason: ' \n ' }), /requires a reason/);
assert.equal(read(taskFile), before);
console.log('PASS refusal: completion without evidence and waiting without reason leave persisted rows unchanged');

updateAskOutcome(root, complete, { status: 'done', evidence: 'test-coverage.cjs EV-COVERAGE PASS' });
updateAskOutcome(root, blocked, { status: 'waiting', reason: 'blocked: depends on service X' });
updateAskOutcome(root, backlog, { status: 'waiting', reason: 'needs reviewer | choose scope' });
assert.match(read(taskFile), /\[x\].*Show tracked coverage Evidence: test-coverage.cjs EV-COVERAGE PASS/);
assert.match(read(taskFile), /\[ \].*Fix unavailable service Waiting: blocked: depends on service X/);
assert.match(read(backlogFile), /WAITING \| needs reviewer &#124; choose scope/);
const report = askProgressReport(documents());
assert.deepEqual(report.map(row => [row.id, row.status, row.evidence, row.reason]), [
    [complete.id, 'done', 'test-coverage.cjs EV-COVERAGE PASS', ''],
    [blocked.id, 'waiting', '', 'blocked: depends on service X'],
    [open.id, 'open', '', ''],
    [backlog.id, 'waiting', '', 'needs reviewer | choose scope']
]);
assert.equal(captureAsks(root, slug, [{ kind: 'repeated ask', text: blocked.text }])[0].waitingReason, 'blocked: depends on service X');
console.log('PASS outcomes: persisted completion evidence and waiting reason match the pure done/waiting/open progress report');

const snapshot = documents();
assert.deepEqual(askProgressReport(snapshot), askProgressReport(snapshot));
assert.deepEqual(documents(), snapshot);
updateAskOutcome(root, blocked, { status: 'done', evidence: 'abc123 commit' });
updateAskOutcome(root, backlog, { status: 'done', evidence: 'test-review.cjs | EV-REVIEW PASS' });
const finished = askProgressReport(documents());
assert.equal(finished[1].status, 'done');
assert.equal(finished[1].reason, '');
assert.equal(finished[3].evidence, 'test-review.cjs | EV-REVIEW PASS');
assert.doesNotMatch(read(taskFile), /Waiting:/);
const doneSnapshot = read(backlogFile);
assert.throws(() => updateAskOutcome(root, backlog, { status: 'done', evidence: '' }), /requires evidence/);
assert.equal(read(backlogFile), doneSnapshot);
const legacy = askProgressReport({ [taskFile]: '- [x] T099 Legacy tick without evidence\n' });
assert.equal(legacy[0].status, 'waiting');
assert.equal(legacy[0].reason, 'Completion evidence missing');
console.log('PASS transitions: waiting asks close with evidence; backlog evidence survives pipes; evidence-free legacy ticks never report done');
const duplicates = '| ID | What | State | Evidence | Source |\r\n|---|---|---|---|---|\r\n| T005 | First ask | READY | None | first |\r\n| T005 | Second ask | READY | None | second |\r\n| T006 | Untouched | READY | None | third |\r\n';
fs.writeFileSync(path.join(root, backlogFile), duplicates);
for (const outcome of [{ status: 'done', evidence: 'PASS' }, { status: 'waiting', reason: 'blocked' }]) {
    assert.throws(() => updateAskOutcome(root, { file: backlogFile, id: 'T005' }, outcome), error => error.candidates.length === 2);
    assert.equal(read(backlogFile), duplicates);
}
updateAskOutcome(root, { file: backlogFile, id: 'T006' }, { status: 'waiting', reason: 'reviewer' });
assert.ok(read(backlogFile).startsWith(duplicates.slice(0, duplicates.indexOf('| T006'))));
fs.writeFileSync(path.join(root, taskFile), '* [ ] T004a First suffix\r\n- [ ] T009b Second suffix\r\n');
updateAskOutcome(root, { file: taskFile, id: 'T004a' }, { status: 'done', evidence: 'suffix PASS' });
assert.equal(read(taskFile), '* [x] T004a First suffix Evidence: suffix PASS\r\n- [ ] T009b Second suffix\r\n');
console.log('PASS outcomes review: ambiguous IDs refuse both outcomes without byte changes; suffixed ID closes exactly; unrelated rows remain byte-identical');
