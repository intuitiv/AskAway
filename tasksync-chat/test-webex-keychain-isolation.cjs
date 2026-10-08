process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');

async function main() {
    const root = fs.mkdtempSync(path.join(__dirname, 'build', 'keychain-isolation-'));
    const calls = path.join(root, 'security-calls');
    const security = path.join(root, 'security');
    fs.writeFileSync(security, `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.ASKAWAY_SECURITY_CALLS, 'called\\n');\nprocess.exitCode = 1;\n`, { mode: 0o755 });
    const env = { ...process.env, ASKAWAY_TEST_NO_KEYCHAIN: '1', ASKAWAY_SECURITY_CALLS: calls, PATH: root + path.delimiter + process.env.PATH };
    // Prove the recording binary works without accessing or recording credential arguments.
    const probe = spawnSync('security', [], { env });
    assert.equal(probe.status, 1);
    assert.equal(fs.readFileSync(calls, 'utf8'), 'called\n');
    fs.writeFileSync(calls, '');

    // Exercise the default runner's safety net and preserve injected runner coverage.
    const bundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/services/webexAuth.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    let executions = 0, injected = 0;
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'vscode' ? {} : name === 'child_process' ? { execFile: () => { executions++; throw new Error('Unexpected default runner'); } } : require(name), loaded, loaded.exports);
    const storage = { get: async () => undefined, store: async () => {} };
    const auth = new loaded.exports.WebexAuth(storage, undefined, 'darwin');
    await auth.store('fixture-access');
    await auth.mirror('webex-general-room-id', 'fixture-room');
    assert.equal(executions, 0);
    await new loaded.exports.WebexAuth(storage, async () => { injected++; }, 'darwin').mirror('webex-general-room-id', 'fixture-room');
    assert.equal(injected, 1);

    const tests = fs.readdirSync(__dirname).filter(name => /^test-webex-.*\.cjs$/.test(name) && name !== path.basename(__filename)).sort();
    assert.ok(tests.length > 0, 'Webex tests must be matched');
    const failures = [];
    for (const test of tests) {
        const child = spawnSync(process.execPath, [path.join(__dirname, test)], { cwd: __dirname, env, encoding: 'utf8', timeout: 60000 });
        try {
            assert.equal(fs.readFileSync(calls, 'utf8'), '', `${test} invoked security`);
            assert.equal(child.status, 0, `${test} failed: ${child.error?.message || ''}\n${child.stdout}\n${child.stderr}`);
            assert.match(child.stdout, /PASS/, `${test} must report executed assertions`);
            console.log(`PASS Keychain isolation: ${test} securityCalls=0`);
        } catch (error) { failures.push(error.message); }
    }
    assert.equal(failures.length, 0, failures.join('\n'));
    console.log(`PASS EV-WEBEX-KEYCHAIN-ISOLATION tests=${tests.length} securityCalls=0 defaultRunnerBlocked=true injectedRunnerPreserved=true`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
