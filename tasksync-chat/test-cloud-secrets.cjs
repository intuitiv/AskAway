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
const { knownSecretValues, secretFindings } = require(path.join(buildDir, 'packet.js'));

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
