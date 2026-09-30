// The gh wrapper must pass args as an array, parse JSON, and turn failures into classified GhErrors without leaking more than the first stderr line.
// Run: node test-cloud-gh.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-cloud-gh-'));
fs.writeFileSync(path.join(buildDir, 'gh.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'cloud', 'gh.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const { createGh, GhError, classifyGhFailure } = require(path.join(buildDir, 'gh.js'));

(async () => {
    let received;
    const ok = createGh(async (args) => { received = args; return { stdout: '{"a":[1,2]}', stderr: '', code: 0 }; });
    assert.deepEqual(await ok.json(['api', 'repos/x/y']), { a: [1, 2] });
    assert.ok(Array.isArray(received), 'exec receives an args array');
    assert.deepEqual(received, ['api', 'repos/x/y']);
    assert.equal(await ok.text(['--version']), '{"a":[1,2]}');

    const samples = {
        unauthenticated: ['To get started with GitHub CLI, please run:  gh auth login', 'You are not logged into any GitHub hosts', 'authentication required'],
        'rate-limited': ['API rate limit exceeded for user'],
        network: ['error connecting: could not resolve host api.github.com', 'request timed out', 'connection refused'],
        failed: ['HTTP 404: Not Found', ''],
    };
    for (const [kind, list] of Object.entries(samples)) {
        for (const stderr of list) {
            assert.equal(classifyGhFailure(stderr), kind, `classify ${stderr}`);
            const gh = createGh(async () => ({ stdout: '', stderr: `${stderr}\nsecond line token=abc`, code: 1 }));
            await assert.rejects(gh.text(['x']), (error) => {
                assert.ok(error instanceof GhError);
                assert.equal(error.kind, kind);
                assert.ok(!error.message.includes('second line'), 'only the first stderr line is kept');
                return true;
            });
            await assert.rejects(gh.json(['x']), (error) => error instanceof GhError && error.kind === kind);
        }
    }
    console.log('PASS test-cloud-gh: json parsing, array args, and failure classification');
})().catch((error) => { console.error(error); process.exit(1); });
