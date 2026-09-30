// The chat banner's tracker reads Copilot's main.jsonl incrementally. When Copilot rewrites that file, new requests must
// still be seen; a stale offset froze the Age past 5:00 even after new messages.
// Run: node test-log-cursor.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-log-cursor-'));
fs.writeFileSync(path.join(buildDir, 'logCursor.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'observability', 'logCursor.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const { reconcileLogCursor, readLogIncrement } = require(path.join(buildDir, 'logCursor.js'));

assert.deepEqual(reconcileLogCursor(undefined, 20, undefined, 'file-1'), { byteOffset: 0, lineCount: 0, headHash: undefined, fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 20, lineCount: 1, fileId: 'file-1' }, 40, undefined, 'file-1'), { byteOffset: 20, lineCount: 1, headHash: undefined, fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' }, 150, 'same', 'file-1'), { byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' }, 25, undefined, 'file-1'), { byteOffset: 0, lineCount: 0, headHash: undefined, fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'old', fileId: 'file-1' }, 100, 'new', 'file-1'), { byteOffset: 0, lineCount: 0, headHash: 'new', fileId: 'file-1' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5, headHash: 'same', fileId: 'file-1' }, 150, 'same', 'file-2'), { byteOffset: 0, lineCount: 0, headHash: 'same', fileId: 'file-2' });
assert.deepEqual(reconcileLogCursor({ byteOffset: 100, lineCount: 5 }, 150, 'baseline', 'file-1'), { byteOffset: 100, lineCount: 5, headHash: 'baseline', fileId: 'file-1' });
(async () => {
    const log = path.join(buildDir, 'main.jsonl');
    const req = (ts, pad = '') => JSON.stringify({ type: 'llm_request', ts, attrs: { inputTokens: 100, pad } }) + '\n';
    const lines = (raw) => raw.split('\n').filter(Boolean).map((l) => JSON.parse(l).ts);
    fs.writeFileSync(log, Array.from({ length: 50 }, (_, i) => req(i + 1, 'x'.repeat(40))).join(''));
    let read = await readLogIncrement(log, undefined);
    assert.equal(lines(read.raw).length, 50, 'first poll reads the whole log');
    fs.appendFileSync(log, req(51));
    read = await readLogIncrement(log, read.cursor);
    assert.deepEqual(lines(read.raw), [51], 'an append yields only the new request');
    read = await readLogIncrement(log, read.cursor);
    assert.equal(read.raw, '', 'nothing new, nothing read');

    // Copilot rewrites the log shorter: the new requests are read, not skipped behind the old offset.
    fs.writeFileSync(log, req(900) + req(901));
    const shrunk = await readLogIncrement(log, read.cursor);
    assert.deepEqual([lines(shrunk.raw), shrunk.lineIndexBase], [[900, 901], 0], 'a shrunk log is read from the start');

    // Replaced by a new file of the same or larger size: identity changed, so it is read from the start.
    fs.writeFileSync(log + '.new', Array.from({ length: 60 }, (_, i) => req(1000 + i, 'y'.repeat(40))).join(''));
    fs.renameSync(log + '.new', log);
    const replaced = await readLogIncrement(log, shrunk.cursor);
    assert.equal(lines(replaced.raw)[0], 1000, 'a replaced log is read from the start');

    // A cursor persisted before identity was recorded keeps its place on the same file.
    const legacy = await readLogIncrement(log, { byteOffset: replaced.cursor.byteOffset, lineCount: replaced.cursor.lineCount });
    assert.equal(legacy.raw, '', 'old persisted cursors do not re-read the log');

    // A partially flushed last line waits for the next poll.
    fs.appendFileSync(log, '{"type":"llm_req');
    const partial = await readLogIncrement(log, replaced.cursor);
    assert.equal(partial.raw, '');
    console.log('EV-LOG-CURSOR TrackerSurvivesRewrite: PASS append=1 shrunk=readFromStart replaced=readFromStart legacyCursor=kept partialLine=deferred');
})().catch((e) => { console.error(e); process.exit(1); });
console.log('PASS log cursor append, shrink, replacement, and migration');