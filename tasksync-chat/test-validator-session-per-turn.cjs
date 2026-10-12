const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const esbuild = require('esbuild');
const files = new Map();
const fakeFs = { ...fs, mkdirSync() {}, realpathSync: file => file,
    renameSync(from, to) { files.set(to, files.get(from)); },
    writeFileSync(file, text, options) {
        if (options?.flag === 'wx' && files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
        files.set(file, text);
    }, appendFileSync(file, text) { files.set(file, (files.get(file) || '') + text); },
    readFileSync(file) { if (files.has(file)) return files.get(file); throw new Error('absent'); },
    existsSync: () => false };
function load(file) {
    const module = { exports: {} };
    const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', file + '.ts')], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'fs' ? fakeFs : require(name),
        console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval });
    return module.exports;
}
(async () => {
    const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime');
    const { validatorProfile } = load('validator/profile');
    const { ValidatorObserver, validatorWorkerRun } = load('validator/observer');
    const { ValidatorTriggers } = load('validator/validatorTriggers');
    const { CommentaryStore } = load('commentary/commentary');
    let sessions = 0, clock = 1000000, promptTokens = 1000;
    const calls = [];
    const options = { ledgerDir: 'fixture-ledger', now: () => clock,
        attachUrl: 'http://127.0.0.1:4096', setTimer: () => () => {}, spawner: args => {
            const session = args.includes('--session') ? args[args.indexOf('--session') + 1] : 'ses_' + ++sessions;
            calls.push({ session, prompt: args.at(-1) });
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
            queueMicrotask(() => {
                child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'step_finish', sessionID: session,
                    part: { tokens: { input: promptTokens, output: 0 }, cost: 0 } }) + '\n'));
                child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'text', sessionID: session,
                    part: { text: '{"answer":null,"sources":[],"summary":"checked"}\nResult: PASS' } }) + '\n'));
                child.emit('exit', 0);
            });
            return child;
        } };
    const runtime = new OpenCodeWorkerRuntime([validatorProfile()], options);
    const commentary = new CommentaryStore({ storageDir: 'commentary-fixture' });
    const observer = new ValidatorObserver({ workspaceRoot: 'fixture', commentary,
        run: validatorWorkerRun(async () => runtime, 'fixture', () => 'fallback') });
    const triggers = new ValidatorTriggers('fixture', async () => observer, () => '007-fixture', () => assert.fail('trigger failed'));
    await triggers.turnStart('Previous final', 'User instruction', 'turn-1');
    for (let i = 0; i < 10; i++) commentary.post('fixture', { kind: 'update', text: 'AITalk commentary ' + i + ': should this cause a run?' });
    assert.equal(calls.length, 0, 'message storage makes no model call');
    await Promise.all([triggers.validatorCall('Question one?'), triggers.validatorCall('Question two?')]);
    await triggers.turnEnd('Whole final response', 'end-1');
    assert.equal(sessions, 1);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.session === 'ses_1'));
    assert.ok(calls[2].prompt.includes('AITalk commentary 9'));
    await triggers.turnEnd('Whole final response', 'end-1');
    assert.equal(calls.length, 3, 'end batch is deduplicated');
    await triggers.turnStart('Whole final response', 'Next instruction', 'turn-2');
    await triggers.validatorCall('Next question?');
    assert.equal(sessions, 1, 'a new turn reuses the warm small validator session');
    await triggers.memoryCall('Which memory rule?', 'agent');
    assert.equal(calls.at(-1).session, 'ses_1');
    assert.equal(calls.length, 5, 'no keep-alive calls');
    assert.equal(runtime.keepWarmWorkers('fixture').length, 0);
    assert.equal((await runtime.ping(runtime.list('fixture')[0].workerId, () => assert.fail('no ping requests'))).status, 'SKIPPED');
    const { VALIDATOR_CACHE_TTL_MS, VALIDATOR_MAX_INPUT_TOKENS } = load('workers/workerRouter');
    const call = (activeRuntime, turn) => validatorWorkerRun(async () => activeRuntime, 'fixture', () => turn)({ prompt: 'Check', profile: validatorProfile(), observedId: turn, turnId: turn });
    clock += VALIDATOR_CACHE_TTL_MS - 1;
    promptTokens = VALIDATOR_MAX_INPUT_TOKENS;
    await call(runtime, 'turn-boundary'); assert.equal(sessions, 1, 'TTL below boundary and 100K eligible');
    clock += VALIDATOR_CACHE_TTL_MS - 1;
    const reloaded = new OpenCodeWorkerRuntime([validatorProfile()], options);
    await call(reloaded, 'turn-reload'); assert.equal(sessions, 1, 'reload restores refreshed last use and inclusive 100K');
    promptTokens = VALIDATOR_MAX_INPUT_TOKENS + 1;
    await call(reloaded, 'turn-grow'); assert.equal(sessions, 1);
    const oversizedReload = new OpenCodeWorkerRuntime([validatorProfile()], options);
    promptTokens = 1000;
    await call(oversizedReload, 'turn-over-limit'); assert.equal(sessions, 2, 'persisted oversized input starts fresh');
    clock += VALIDATOR_CACHE_TTL_MS;
    await call(oversizedReload, 'turn-expired'); assert.equal(sessions, 3, 'expired cache starts fresh even for small input');
    await call(oversizedReload, 'turn-current'); assert.equal(calls.at(-1).session, 'ses_3', 'replacement remains current');
    assert.equal(oversizedReload.keepWarmWorkers('fixture').length, 0);
    console.log('PASS EV-VALIDATOR-SESSION-PER-TURN: same/new turns reuse; TTL refreshed <30m; inclusive 100K; expiry/oversize fresh; reload persists; no pings');
})().catch(error => { console.error(error); process.exitCode = 1; });
