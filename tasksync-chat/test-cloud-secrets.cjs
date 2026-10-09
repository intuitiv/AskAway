// Packets sent to the cloud must be scanned for credentials first; each pattern and any known env secret has to be reported by field.
// Run: node test-cloud-secrets.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-cloud-secrets-'));
fs.writeFileSync(path.join(buildDir, 'packet.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'cloud', 'packet.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const { knownSecretValues, secretFindings, buildPacket, buildComment } = require(path.join(buildDir, 'packet.js'));

const samples = {
    'github-token': 'here ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2',
    'aws-key': 'key AKIA' + 'ABCDEFGHIJKLMNOP',
    'slack-token': 'xoxb-' + '1234567890-abcdef',
    'api-key': 'sk-' + 'abcdefghijklmnopqrstuv',
    'private-key': '-----BEGIN RSA PRIVATE KEY-----\nMIIB',
    jwt: 'eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2',
};
for (const [kind, text] of Object.entries(samples)) {
    assert.deepEqual(secretFindings({ comment: text }), [{ field: 'comment', kind }], kind);
}

const known = knownSecretValues({ MY_TOKEN: 'abcdefgh12345', SHORT_KEY: 'short', PLAIN: 'notasecretvalue', DB_PASSWORD: undefined });
assert.deepEqual(known, ['abcdefgh12345']);
assert.deepEqual(secretFindings({ body: 'use abcdefgh12345 here' }, known), [{ field: 'body', kind: 'known-credential' }]);

const twice = secretFindings({ a: samples['aws-key'] + ' ' + samples['aws-key'], b: 'clean' });
assert.deepEqual(twice, [{ field: 'a', kind: 'aws-key' }], 'one finding per field and kind');
assert.deepEqual(secretFindings({ title: 'Fix the parser', body: 'Nothing secret here' }, known), []);

console.log('PASS test-cloud-secrets: patterns, known credentials, clean text');

const Module = require('node:module');
const modules = {};
function load(name) {
    if (modules[name]) return modules[name].exports;
    const filename = path.join(__dirname, 'src/cloud', name + '.ts');
    const loaded = modules[name] = new Module(filename, module);
    loaded.paths = module.paths;
    loaded.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return loaded.exports;
}
const { queueTask } = load('cloudQueue');
const { createGh } = load('gh');
const request = {
    root: '/fixture/cloud-secrets', slug: '006-cloud-tasks', pr: 'https://github.com/fixture/project/pull/18',
    explicitRequest: true, enabled: true,
    task: { taskId: 'T018', stage: 'implement', details: 'Add caller-view regression tests', tags: ['cloud'],
        allowedPaths: ['test-cloud-secrets.cjs'], verify: ['node test-cloud-secrets.cjs'], expect: 'PASS',
        ceilingMinutes: 45, stopCondition: 'Stop when verification passes' },
    story: { story: 'US5', independentTest: 'Refuse secrets before GitHub calls' },
};
const facts = { slug: request.slug, attempt: 1, base: '1234567890abcdef', knownValues: known };
const reference = { slug: request.slug, taskId: request.task.taskId, story: request.story.story,
    stage: request.task.stage, packetPath: '.askaway/specs/006-cloud-tasks/packets/T018-1.md',
    packetSha: facts.base, knownValues: known };
function fixture() {
    const calls = [], files = new Map();
    const io = {
        gh: createGh(async args => {
            calls.push(['gh', ...args]);
            if (args[0] === 'auth') return { code: 0, stdout: '', stderr: '' };
            if (args[0] === 'api') return { code: 0, stderr: '', stdout: JSON.stringify(args[1].includes('/pulls/')
                ? { state: 'open', head: { ref: 'active-pr', sha: facts.base,
                    repo: { full_name: 'fixture/project', clone_url: 'https://github.com/fixture/project.git' } } }
                : { permissions: { push: true } }) };
            return { code: 0, stderr: '', stdout: request.pr + '#issuecomment-1' };
        }),
        async git(args) { calls.push(['git', ...args]); return args[0] === 'rev-parse' ? 'abcdef0123456789' : ''; },
        async load() { return []; }, async save() { calls.push(['save']); },
        async write(file, text) { files.set(file, text); }, async temporary() { return '/fixture/cloud-secrets/tmp'; },
        async cleanup() {}, knownValues() { return known; },
    };
    return { io, calls, files };
}
let matched = 10, passed = 10;
function check(name, action) {
    matched++;
    action();
    passed++;
}
function refusal(action, field, value) {
    assert.throws(action, error => {
        assert.ok(error.message === `secret detected in ${field}`, `refusal must name only ${field}`);
        assert.ok(!error.message.includes(value), 'refusal must not echo the synthetic credential');
        return true;
    }, `secret in ${field} must be refused`);
}
(async () => {
    const credentials = { ...samples, 'known-credential': known[0] };
    for (const [kind, value] of Object.entries(credentials)) {
        for (const field of ['stage', 'story', 'task', 'details', 'base', 'allowedPaths', 'verify', 'expect', 'stopCondition', 'independentTest', 'packetPath']) {
            check(`packet ${kind} ${field}`, () => {
                const task = structuredClone(request.task), story = { ...request.story }, packetFacts = { ...facts };
                if (field === 'task') task.taskId = value;
                else if (field === 'story' || field === 'independentTest') story[field] = value;
                else if (field === 'base') packetFacts.base = value;
                else if (field === 'packetPath') packetFacts.slug = value;
                else task[field] = ['allowedPaths', 'verify'].includes(field) ? [value] : value;
                refusal(() => buildPacket(task, story, packetFacts), field, value);
            });
        }
        for (const field of ['task', 'story', 'stage', 'slug', 'packetPath', 'packetSha']) {
            check(`comment ${kind} ${field}`, () => refusal(
                () => buildComment({ ...reference, [field === 'task' ? 'taskId' : field]: value }), field, value));
        }
    }
    console.log('PASS T018 packet/comment: 119 field cases refuse seeded patterns and known credentials without echoing values');
    check('clean packet', () => assert.ok(buildPacket(request.task, request.story, facts).text.includes(request.task.details)));
    check('clean comment', () => assert.ok(buildComment(reference).includes(reference.packetPath)));
    console.log('PASS T018 clean packet/comment: caller text retained');
    matched++;
    const clean = fixture();
    const result = await queueTask(request, clean.io);
    assert.equal(result.refusal, undefined, 'clean request must not be refused');
    assert.equal(result.run?.state, 'Queued', 'clean request must queue');
    assert.equal(clean.files.size, 2, 'clean request must write packet and comment');
    assert.equal(clean.calls.filter(call => call[0] === 'gh' && call[1] === 'pr').length, 1, 'clean request must post one PR comment');
    passed++;
    console.log('PASS T018 clean queue: packet and PR comment posted once');
    for (const [field, change] of [
        ['details', { task: { ...request.task, details: samples['github-token'] } }],
        ['packetPath', { slug: 'ghp_' + 'a'.repeat(24) }],
    ]) {
        matched++;
        const refused = fixture();
        const response = await queueTask({ ...request, ...change }, refused.io);
        assert.ok(response.refusal === `secret detected in ${field}`, `queue refusal must name only ${field}`);
        assert.equal(refused.calls.filter(call => call[0] === 'gh').length, 0,
            `T018 secret in ${field} must be refused before any GitHub call`);
        assert.equal(refused.calls.length, 0, 'refusal must not commit, push or save');
        assert.equal(refused.files.size, 0, 'refusal must not write packet or comment');
        passed++;
        console.log(`PASS T018 secret in ${field}: field-only refusal before any GitHub call or write`);
    }
    console.log(`test-cloud-secrets: ${passed} passed, 0 failed, ${matched} matched`);
})().catch(error => {
    console.error(error.message);
    console.error((error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 3).join('\n'));
    console.log(`test-cloud-secrets: ${passed} passed, 1 failed, ${matched} matched`);
    process.exitCode = 1;
});
