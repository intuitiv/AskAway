const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));
const buildDir = path.join(__dirname, '.validator-tool-build');
fs.mkdirSync(buildDir, { recursive: true });
require('./tools/transpile-src.cjs').transpileSrc(buildDir);
for (const name of ['validator/validatorTool', 'validator/liveDecisions', 'validator/validatorTriggers', 'validator/observer', 'validator/records', 'validator/redact', 'validator/profile',
    'workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools', 'commentary/commentary', 'specs/specCostLedger']) {
    const out = path.join(buildDir, `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { validatorTool } = require(path.join(buildDir, 'validator/validatorTool'));
const { ValidatorTriggers } = require(path.join(buildDir, 'validator/validatorTriggers'));
const { ValidatorObserver } = require(path.join(buildDir, 'validator/observer'));
const { CommentaryStore, buildOpener } = require(path.join(buildDir, 'commentary/commentary'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const ack = { queued: true, note: "The validator's prediction goes to Commentary for the reviewer." };

(async () => {
    try {
        const calls = [];
        let release;
        const pending = new Promise(resolve => { release = resolve; });
        const triggers = new ValidatorTriggers(buildDir, async () => ({ observe: response => { calls.push(response); return pending; } }), () => '007-demo', () => {});
        const tool = validatorTool(text => triggers.validatorCall(text));
        assert.equal(tool.name, 'askaway_validator');
        const result = await tool.run({ message: 'Review this approach', context: 'Active task context' });
        assert.deepEqual(result, ack, 'acknowledgement resolves while the observer is still pending');
        await flush();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].force, true);
        assert.equal(calls[0].text, 'Review this approach\nContext:\nActive task context');
        assert.equal(calls[0].specSlug, '007-demo');
        release({ answer: 'PRIVATE_PREDICTION', sources: ['PRIVATE_SOURCE'] });
        await flush();
        assert.deepEqual(result, ack, 'observer output never changes the tool result');
        let failed = 0;
        const broken = new ValidatorTriggers(buildDir, async () => ({ observe: () => { throw new Error('PRIVATE_FAILURE'); } }), () => '007-demo', () => { failed++; });
        assert.deepEqual(await validatorTool(text => broken.validatorCall(text)).run({ message: 'Review this' }), ack);
        await flush();
        assert.equal(failed, 1, 'observer failure follows trigger failure handling');
        assert.deepEqual(await validatorTool(() => { throw new Error('PRIVATE_FAILURE'); }).run({ message: 'Review this' }), ack);
        await flush();

        const workspace = path.join(buildDir, 'workspace');
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(path.join(workspace, 'GOALS.md'), 'Reviewer goals');
        const commentary = new CommentaryStore({ dir: path.join(buildDir, 'commentary-fixture') });
        const observer = new ValidatorObserver({ workspaceRoot: workspace, commentary,
            run: async () => ({ text: JSON.stringify({ answer: 'PRIVATE_PREDICTION', sources: ['GOALS.md'], observations: 'PRIVATE_OBSERVATIONS', summary: 'PRIVATE_SUMMARY', impact: 'PRIVATE_IMPACT' }) }) });
        const realTriggers = new ValidatorTriggers(workspace, async () => observer, () => '007-demo', () => {});
        assert.deepEqual(await validatorTool(text => realTriggers.validatorCall(text)).run({ message: 'Review this approach' }), ack);
        await flush();
        const state = commentary.read(workspace);
        assert.ok(JSON.stringify(state.validatorItems).includes('PRIVATE_PREDICTION'), 'prediction reaches Commentary');
        assert.ok(!buildOpener(state).includes('PRIVATE_'), 'prediction never reaches agent-facing opener');
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        const manifest = pkg.contributes.languageModelTools.find(item => item.name === tool.name);
        assert.deepEqual(manifest.inputSchema.required, ['message']);
        assert.ok(pkg.scripts['test:workers'].includes('node test-validator-observer.cjs && node test-validator-tool.cjs'));
        console.log('PASS EV-VALIDATOR-TOOL forced nonblocking observation; Commentary only');
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exit(1); });
