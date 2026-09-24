const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-code-nav-timeout-'));
const bundledHelper = path.join(temporaryDirectory, 'operationDeadline.cjs');

try {
    esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'src', 'utils', 'operationDeadline.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: bundledHelper
    });

    const { withTimeout } = require(bundledHelper);
    const settings = require('./package.json').contributes.configuration.properties;
    assert.equal(settings['askaway.codeNavTimeoutSeconds'].default, 90);
    assert.equal(settings['askaway.codeNavTimeoutSeconds'].maximum, 120);

    const startedAt = Date.now();
    const neverCompletes = new Promise(() => {});
    assert.rejects(
        withTimeout(neverCompletes, 25, 'code_nav workspace_symbols'),
        error => error.name === 'OperationTimeoutError'
            && error.message === 'code_nav workspace_symbols timed out after 1 seconds'
    ).then(() => {
        assert.ok(Date.now() - startedAt < 500, 'A stuck provider must return control at its deadline.');
        return withTimeout(Promise.resolve('ok'), 25, 'code_nav hover');
    }).then(result => {
        assert.equal(result, 'ok');
        console.log('PASS: code_nav defaults to 90s, caps at 120s, and returns control at the deadline');
    }).finally(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });
} catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
}