// EV-ORCHESTRATOR-DISPATCH (spec 005 T041, R-SKFLOW-23): write packets need allowedFiles, overlapping write scopes never run together,
// and scopeCheck flags changed files outside scope. Driven through the public worker tool with a stubbed runtime. Run: node test-orchestrator-dispatch.cjs
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.orchestrator-dispatch-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir);
const src = path.join(__dirname, 'src');
function transpile(rel) {
    const out = path.join(buildDir, rel.replace(/\.ts$/, '.js'));
    if (fs.existsSync(out)) { return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(path.join(src, rel), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(out, js);
    for (const [, spec] of js.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
        const next = path.join(path.dirname(rel), spec);
        if (fs.existsSync(path.join(src, `${next}.ts`))) { transpile(`${next}.ts`); }
        else if (fs.existsSync(path.join(src, next, 'index.ts'))) { transpile(path.join(next, 'index.ts')); }
    }
}
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) { transpile(`workers/${name}.ts`); }
transpile('specs/scopeCheck.ts');
const { parseWorkerProfile } = require(path.join(buildDir, 'workers', 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'workers', 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workers', 'workerTools.js'));
const { scopeCheck } = require(path.join(buildDir, 'specs', 'scopeCheck.js'));

const header = (name, edit) => `---\nname: ${name}\ndescription: "d"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: low\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [low]\nedit: ${edit}\n---\nBody.\n`;
const profiles = [parseWorkerProfile(header('build', 'allow')), parseWorkerProfile(header('verify', 'deny'))];
const spawner = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = (signal) => { setImmediate(() => child.emit('exit', null, signal)); return true; };
    return child;
};
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-dispatch-ledger-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-dispatch-ws-'));
const runtime = new OpenCodeWorkerRuntime(profiles, { ledgerDir, spawner });
const tools = new Map();
registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
const call = async (action, args) => {
    const tool = tools.get('worker');
    const parsed = tool.config.inputSchema.parse({ action, ...args });
    return JSON.parse((await tool.handler(parsed)).content[0].text);
};
const packet = (profile, allowedFiles) => ({ profile, dispatchTurnId: 'turn-1', baseRevision: 'abc', objective: 'Do', allowedFiles, acceptance: 'a', expected: 'e', command: 'true' });

(async () => {
    // scopeCheck: the changed files outside the allowed globs.
    assert.deepEqual(scopeCheck(['src/a/**', 'README.md'], ['src/a/x.ts', 'src/a/deep/y.ts', 'README.md', 'src/b/z.ts', 'package.json']), ['src/b/z.ts', 'package.json']);
    assert.deepEqual(scopeCheck(['src/*.ts'], ['src/a.ts', 'src/sub/b.ts']), ['src/sub/b.ts'], '* stops at a slash');
    assert.deepEqual(scopeCheck([], ['a.ts']), ['a.ts'], 'empty scope allows nothing');

    // A write profile without allowedFiles is refused; a read-only profile keeps an empty list.
    const empty = await call('start', packet('build', []));
    assert.equal(empty.status, 'REFUSED', 'build with empty allowedFiles refused');
    assert.match(empty.reason, /allowedFiles/);
    assert.equal((await call('start', packet('verify', []))).state, 'STARTING', 'read-only profile runs with empty allowedFiles');

    // Overlapping write scopes are refused while the first run is live; disjoint ones run.
    const first = await call('start', packet('build', ['src/a/**']));
    assert.equal(first.state, 'STARTING');
    const overlap = await call('start', packet('build', ['src/a/x.ts']));
    assert.equal(overlap.status, 'REFUSED', 'overlapping globs refused');
    assert.match(overlap.reason, /src\/a\/x\.ts/);
    const disjoint = await call('start', packet('build', ['src/b/**']));
    assert.equal(disjoint.state, 'STARTING', 'disjoint globs run');
    assert.equal((await call('start', packet('build', ['src/*.ts', 'docs/x.md']))).state, 'STARTING', 'src/*.ts does not reach src/a/** or src/b/**');
    assert.equal((await call('start', packet('verify', []))).state, 'STARTING', 'read-only workers never conflict');

    // Once the first run ends, its scope is free again.
    await call('cancel', { runId: first.runId });
    for (let i = 0; i < 20; i++) { if (!['STARTING', 'RUNNING'].includes((await call('status', { runId: first.runId })).state)) { break; } await new Promise((r) => setTimeout(r, 10)); }
    assert.equal((await call('start', packet('build', ['src/a/x.ts']))).state, 'STARTING', 'scope free after the run ended');
    console.log('PASS EV-ORCHESTRATOR-DISPATCH');
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
