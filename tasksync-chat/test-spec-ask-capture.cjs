const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./node_modules/typescript');

const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const fixture = fs.mkdtempSync(path.join(build, 'spec-ask-capture-'));
const source = fs.readFileSync(path.join(__dirname, 'src/specs/askCapture.ts'), 'utf8');
fs.writeFileSync(path.join(fixture, 'askCapture.js'), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText);
const { captureAsks, captureAskRows } = require(path.join(fixture, 'askCapture.js'));
const slug = '005-sample';
const tasksFile = `specs/${slug}/tasks.md`;
fs.mkdirSync(path.join(fixture, 'specs', slug), { recursive: true });
fs.writeFileSync(path.join(fixture, 'specs', slug, 'spec.md'), '# Sample spec\n');
fs.writeFileSync(path.join(fixture, tasksFile), '# Tasks\n- [ ] T009 [US8] Keep unfinished work\n- [x] T010 [US8] Completed fix Evidence: test-fix.cjs PASS\n');
const mixed = [
    { kind: 'request', text: 'Add progress display' },
    { kind: 'bug', text: 'Fix missing totals' },
    { kind: 'correction', text: 'Use dollars instead of credits' },
    { kind: 'side remark', text: 'Also preserve the draft' },
    { kind: 'repeated ask', text: 'Keep unfinished work' }
];
const first = captureAsks(fixture, slug, mixed);
assert.equal(first.length, mixed.length);
assert.equal(first[4].id, 'T009');
const persisted = fs.readFileSync(path.join(fixture, tasksFile), 'utf8');
for (const ask of mixed) { assert.ok(persisted.includes(ask.text)); }
assert.equal((persisted.match(/^- \[/gm) || []).length, 6);
assert.equal(first[0].id, 'T011');
console.log('PASS mixed asks: request, bug, correction, side remark and repeated ask accounted for in persisted task rows');
const repeated = captureAsks(fixture, slug, mixed);
assert.deepEqual(repeated, first);
assert.equal(fs.readFileSync(path.join(fixture, tasksFile), 'utf8'), persisted);
const done = captureAsks(fixture, slug, [{ kind: 'repeated ask', text: 'Completed fix' }])[0];
assert.equal(done.done, true);
assert.equal(done.evidence, 'test-fix.cjs PASS');
const paraphrase = captureAsks(fixture, slug, [{ kind: 'repeated ask', text: 'Please finish that earlier work', existingRow: { file: tasksFile, id: 'T009' } }])[0];
assert.equal(paraphrase.id, 'T009');
assert.equal(paraphrase.done, false);
assert.equal(fs.readFileSync(path.join(fixture, tasksFile), 'utf8'), persisted);
console.log('PASS repeats: open rows reused without duplication or lost unfinished work; done ask returns evidence');
const backlogAsk = { kind: 'side remark', text: 'Track unrelated work | later' };
const backlogRow = captureAsks(fixture, undefined, [backlogAsk])[0];
const backlogFile = path.join(fixture, 'specs/BACKLOG.md');
const backlog = fs.readFileSync(backlogFile, 'utf8');
assert.match(backlog, /ASK-001.*Track unrelated work &#124; later.*READY/);
assert.equal(captureAsks(fixture, slug, [backlogAsk])[0].id, backlogRow.id);
assert.equal(fs.readFileSync(backlogFile, 'utf8'), backlog);
fs.writeFileSync(backlogFile, backlog.replace('READY | Awaiting work', 'DONE | test-backlog.cjs PASS'));
assert.equal(captureAsks(fixture, undefined, [backlogAsk])[0].evidence, 'test-backlog.cjs PASS');
const fresh = captureAsks(fixture, undefined, [{ kind: 'request', text: 'Another backlog ask' }]);
assert.equal(fresh[0].id, 'ASK-002');
assert.equal(captureAsks(fixture, undefined, [{ kind: 'repeated ask', text: '  ADD progress   display ' }])[0].file, tasksFile);
assert.deepEqual(captureAskRows({}, 'specs/BACKLOG.md', []).rows, []);
console.log('PASS backlog: persisted rows, cross-file repeats, normalized repeats and completed evidence accounted for without /sk');
const missingSlug = '195-ping';
const [missingSpecAsk] = captureAsks(fixture, missingSlug, [{ kind: 'request', text: 'Capture an ad-hoc slug without creating a spec' }]);
assert.equal(missingSpecAsk.file, 'specs/BACKLOG.md');
assert.ok(fs.readFileSync(backlogFile, 'utf8').includes(missingSpecAsk.text));
assert.equal(fs.existsSync(path.join(fixture, 'specs', missingSlug)), false);
const emptySlug = '011-empty';
fs.mkdirSync(path.join(fixture, 'specs', emptySlug));
assert.equal(captureAsks(fixture, emptySlug, [{ kind: 'request', text: 'Existing folder without a spec also uses backlog' }])[0].file, 'specs/BACKLOG.md');
assert.equal(fs.existsSync(path.join(fixture, 'specs', emptySlug, 'tasks.md')), false);
console.log('PASS missing spec: asks persist in BACKLOG.md without creating a slug folder or tasks.md');
const suffixRoot = path.join(fixture, 'suffix');
fs.mkdirSync(path.join(suffixRoot, 'specs', slug), { recursive: true });
fs.writeFileSync(path.join(suffixRoot, 'specs', slug, 'spec.md'), '# Suffix spec\n');
const suffixFile = path.join(suffixRoot, tasksFile);
const suffixBytes = '* [ ] T004a Fix alpha\n- [ ] T009b Fix beta\n';
fs.writeFileSync(suffixFile, suffixBytes);
assert.equal(captureAsks(suffixRoot, slug, [{ kind: 'repeated ask', text: 'Fix alpha' }])[0].id, 'T004a');
assert.equal(captureAsks(suffixRoot, slug, [{ kind: 'repeated ask', text: 'Fix beta' }])[0].id, 'T009b');
assert.equal(fs.readFileSync(suffixFile, 'utf8'), suffixBytes);
assert.equal(captureAsks(suffixRoot, slug, [{ kind: 'correction', text: 'Unnumbered correction' }])[0].id, 'T010');
const { askProgressReport } = require(path.join(fixture, 'askCapture.js'));
const table = '| ID | What | State | Evidence | Source |\n|---|---|---|---|---|\n| ASK-001 | Real work | READY | Later | user |\n\n| What | State | Evidence | Source | Other |\n|---|---|---|---|---|\n';
assert.deepEqual(askProgressReport({ 'specs/BACKLOG.md': table }).map(row => row.text), ['Real work']);
console.log('PASS capture review: suffixed scanner IDs reused exactly; unnumbered correction persisted; backlog headers are not tracked rows');
const escapeRoot = path.join(fixture, 'escape');
const outside = path.join(fixture, 'outside');
fs.mkdirSync(path.join(escapeRoot, 'specs'), { recursive: true });
fs.mkdirSync(outside);
fs.symlinkSync(outside, path.join(escapeRoot, 'specs', slug));
assert.throws(() => captureAsks(escapeRoot, slug, [{ kind: 'request', text: 'Escape' }]), /escapes/);
assert.equal(fs.existsSync(path.join(outside, 'tasks.md')), false);
console.log('PASS capture containment: symlinked parent refuses a not-yet-existing write target');
