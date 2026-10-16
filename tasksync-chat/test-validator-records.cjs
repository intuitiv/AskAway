// T002: validator redaction (reuses CREDENTIAL_ANYWHERE, drops uncertain items) and append-only records. Run: node test-validator-records.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.validator-records-build');
fs.rmSync(buildDir, { recursive: true, force: true });
require('./tools/transpile-src.cjs').transpileSrc(buildDir);
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools',
    'commentary/commentary', 'specs/specCostLedger', 'validator/redact', 'validator/records']) {
    const out = path.join(buildDir, `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const load = (name) => require(path.join(buildDir, `${name}.js`));
const { CREDENTIAL_ANYWHERE, CommentaryStore } = load('commentary/commentary');
const { redactOrDrop, hasCredential } = load('validator/redact');
const { ValidatorRecords } = load('validator/records');
const { recordSpecTurn } = load('specs/specCostLedger');

const SECRETS = ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'sk-abcdefghijklmnopqrstuvwxyz0123', 'squ_abcdefghijklmnopqrstuvwxyz0123'];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-records-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-rec-ws-')));

try {
    // Reuse, not a copy: the exported pattern is the commentary one and still redacts prompt excerpts.
    assert.ok(CREDENTIAL_ANYWHERE instanceof RegExp && CREDENTIAL_ANYWHERE.global, 'CREDENTIAL_ANYWHERE is exported');
    for (const secret of SECRETS) {
        assert.equal(redactOrDrop(`reply with ${secret} inside`), null, `item with ${secret.slice(0, 4)} is dropped whole`);
        assert.equal(hasCredential(`x ${secret}`), true);
        assert.equal(hasCredential(`x ${secret}`), true, 'repeat calls are stable (global regex lastIndex)');
    }
    assert.equal(redactOrDrop('plain reviewer reply'), 'plain reviewer reply');
    assert.equal(redactOrDrop(undefined), null, 'uncertain input is dropped');

    // Round trip.
    const records = new ValidatorRecords(workspace, '007-validator-agent');
    assert.equal(records.dir, path.join(workspace, '.askaway', 'specs', '007-validator-agent', 'validator'));
    const usage = { input: 10, output: 2, reasoning: 0, cacheRead: 5, cacheWrite: 0, cost: 0.01 };
    const response = { id: 'r1', observedId: 'o1', source: 'worker:w1', specSlug: '007-validator-agent', answer: 'Use X', observations: 'obs', summary: 's', impact: 'i',
        sources: ['Rules.md'], contextSuggestions: [], usage, skipped: false, error: null, ts: 1, workerId: 'w1', sessionId: 'ses_1' };
    assert.equal(records.appendResponse(response), true);
    assert.deepEqual(records.responses(), [response], 'responses round-trip incl. worker and session ids');
    assert.equal(records.appendPrediction({ id: 'p1', responseId: 'r1', decision: 'ship it', ts: 2 }), true);
    assert.equal(records.appendPrediction({ id: 'p1', responseId: 'r1', decision: 'ship it', ts: 2, matched: true, diff: '' }), true);
    assert.deepEqual(records.predictions(), [{ id: 'p1', responseId: 'r1', decision: 'ship it', ts: 2, matched: true, diff: '' }], 'append-only; reads fold to the newest line');
    assert.equal(fs.readFileSync(path.join(records.dir, 'predictions.jsonl'), 'utf8').trim().split('\n').length, 2, 'the file only grew');
    assert.equal(records.appendIndex({ memoryId: 'm1', kind: 'rule', specSlug: '007-validator-agent', ts: 3 }), true);
    assert.deepEqual(records.index().map((e) => e.memoryId), ['m1']);
    assert.throws(() => new ValidatorRecords(workspace, '../escape'), /invalid spec slug/);
    assert.equal(new ValidatorRecords(workspace, null).dir.includes('_no-spec'), true, 'no active spec has its own folder');

    // Secrets seeded in reply, response and a source reach no sink: jsonl, Commentary, cost.
    const [reply, observed, source] = SECRETS;
    assert.equal(records.appendResponse({ ...response, id: 'r2', answer: `from ${observed}` }), false, 'response with a secret is dropped');
    assert.equal(records.appendResponse({ ...response, id: 'r3', sources: [`file with ${source}`] }), false, 'source with a secret is dropped');
    assert.equal(records.appendPrediction({ id: 'p2', responseId: 'r1', decision: `reviewer said ${reply}`, ts: 4 }), false, 'reply with a secret is dropped');
    assert.equal(records.appendIndex({ memoryId: 'm2', kind: `rule ${reply}`, specSlug: 's', ts: 5 }), false);
    const store = new CommentaryStore({ dir: path.join(home, 'commentary') });
    assert.equal(store.postValidator(workspace, { text: 'summary', detail: { sources: [source] } }).status, 'REJECTED');
    const costFile = path.join(home, 'cost.json');
    recordSpecTurn(costFile, { specSlug: '007', turnKey: 'validator:r1', day: '2026-10-06', requests: 1, inputTokens: 1, outputTokens: 1, nanoAiu: 1, source: 'validator' });
    const sinks = [...fs.readdirSync(records.dir).map((f) => fs.readFileSync(path.join(records.dir, f), 'utf8')), fs.readFileSync(costFile, 'utf8'), JSON.stringify(store.read(workspace))].join('\n');
    for (const secret of SECRETS) { assert.ok(!sinks.includes(secret), `${secret.slice(0, 4)}... reached a sink`); }
    assert.equal(records.responses().length, 1);

    console.log('PASS EV-VALIDATOR-RECORDS');
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
}
