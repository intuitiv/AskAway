const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const esbuild = require('esbuild');
function load(name) {
    const loaded = { exports: {} };
    vm.runInNewContext(esbuild.buildSync({ entryPoints: [path.join(__dirname, `src/workers/${name}.ts`)],
        bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text,
        { module: loaded, exports: loaded.exports, require, process, Buffer, console, setTimeout, clearTimeout });
    return loaded.exports;
}
const { loadWorkerProfiles } = load('workerProfiles');
const { OpenCodeWorkerRuntime } = load('openCodeRuntime');
const root = fs.mkdtempSync(path.join(__dirname, '.worker-profile-refresh-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const profileDir = path.join(root, 'profiles');
fs.mkdirSync(profileDir);
const file = path.join(profileDir, 'build.md');
const a = 'github-copilot/claude-sonnet-5.5', b = 'github-copilot/gpt-6.1-sol';
const text = model => `---\nname: build\ntier: mid\nmodel: ${model}\nthinking: high\nmodels: [${a}, ${b}]\nthinkingOptions: [high]\n---\nFixture build.\n`;
fs.writeFileSync(file, text(a));
const children = [];
const runtime = new OpenCodeWorkerRuntime(loadWorkerProfiles(profileDir), {
    ledgerDir: path.join(root, 'ledger'), now: () => 1000, setTimer: () => () => {},
    spawner: args => {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => true;
        child.args = args; children.push(child); return child;
    },
});
const packet = { workspacePath: root, profile: 'build', dispatchTurnId: 'turn', baseRevision: 'fe9f8c4',
    objective: 'Verify refresh', allowedFiles: [], acceptance: 'proof', expected: 'PASS', command: 'true' };
const first = runtime.start(packet);
assert.equal(first.model, a);
children[0].stdout.write(JSON.stringify({ type: 'text', sessionID: 'session-a', part: { text: 'Result: PASS\nEvidence: fixture' } }) + '\n');
children[0].emit('exit', 0, null);
assert.equal(runtime.router.worker(first.workerId).state, 'IDLE');
fs.writeFileSync(file, text(b));
const second = runtime.start(packet);
assert.equal(second.model, b, 'no-model start reads the edited profile default');
assert.notEqual(second.workerId, first.workerId, 'idle A must not override the new B default');
assert.equal(runtime.router.worker(first.workerId).model, a, 'existing worker config survives refresh');
assert.equal(runtime.router.worker(first.workerId).state, 'IDLE');
assert.equal(children[1].args[children[1].args.indexOf('--model') + 1], b);
console.log('PASS EV-WORKER-PROFILE-REFRESH: edited default selected without restart; idle worker preserved');
