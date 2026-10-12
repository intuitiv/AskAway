const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const files = new Map();
const fakeFs = { ...fs, mkdirSync() {}, writeFileSync(file, text, options) {
    if (options?.flag === 'wx' && files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    files.set(file, text);
}, appendFileSync(file, text) { files.set(file, (files.get(file) || '') + text); },
    realpathSync(file) { return file; },
    readFileSync(file, ...args) { if (files.has(file)) return files.get(file); return fs.readFileSync(file, ...args); } };
function load(file, extra = {}) {
    const module = { exports: {} };
    const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', file + '.ts')], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'fs' ? fakeFs : name === 'vscode' ? extra.vscode : require(name),
        console, Buffer, process, setTimeout, clearTimeout, setInterval, clearInterval, ...extra });
    return module.exports;
}
(async () => {
    const { ValidatorTriggers } = load('validator/validatorTriggers');
    const seen = [], errors = [];
    let release;
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const slow = new Promise(resolve => { release = resolve; });
    const observer = { observe: async response => { seen.push(response); if (response.id === 'turn-2') { signalStarted(); await slow; } return { answer: 'Source-backed memory answer' }; } };
    const make = () => new ValidatorTriggers('fixture-workspace', async () => observer, () => '007-fixture', () => errors.push('visible failure'));
    const first = make(), second = make();
    assert.equal(seen.length, 0, 'intermediate and worker replies have no trigger entry point');
    const { HandoffNotifier, fullResponseMarkdown } = load('services/handoffNotifier', { vscode: { workspace: { getConfiguration: () => ({ get: () => true }) } } });
    const parts = { details: 'Whole reply before the handoff.', handoff: 'Result: PASS' };
    const sent = [];
    const notifier = new HandoffNotifier([{ name: 'Telegram', setting: 'on', get: () => ({ isConfigured: () => true, postText: async text => { sent.push(text); return true; } }) }], undefined, () => {}, undefined,
        (text, id) => first.turnEnd(text, id));
    notifier._readStamp = () => 10000;
    notifier._findHandoff = () => parts;
    await notifier._onTurnEnd();
    await first.turnEnd(fullResponseMarkdown(parts), require('node:crypto').createHash('sha256').update(fullResponseMarkdown(parts)).digest('hex'));
    await second.turnEnd(fullResponseMarkdown(parts), seen[0].id);
    assert.equal(seen.length, 1, 'retry and another window claim the same final only once');
    assert.equal(seen[0].text, '\nFinal response:\n' + fullResponseMarkdown(parts));
    assert.ok(seen[0].text.includes(parts.details) && seen[0].text.includes('Response Handoff'));
    assert.equal(sent.length, 1);
    assert.equal(second.previousFinal(), fullResponseMarkdown(parts));
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    const start = provider.indexOf('    private _userMessageDelivered(');
    const end = provider.indexOf('\n    }', start) + 6;
    const method = provider.slice(start, end).replace('private _userMessageDelivered(toolCallId: string | null, text: string): void', '_userMessageDelivered(toolCallId, text)');
    const bridge = { vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: 'fixture-workspace' } }] } }, sharedCommentaryStore: () => ({ markTurnStart() {} }), out: {} };
    vm.runInNewContext('out.Provider = class {' + method + '};', bridge);
    const p = new bridge.out.Provider();
    let pending;
    p._validatorTurnStart = (text, id) => { pending = second.turnStart(second.previousFinal(), text, id); };
    p._userMessageDelivered('turn-2', 'Use the shared store.');
    await pending;
    assert.equal(seen.length, 1, 'turn start stores context with zero additional model runs');
    await first.turnStart(first.previousFinal(), 'duplicate', 'turn-2');
    assert.equal(seen.length, 1, 'duplicate turn ids do not run the model');
    pending = second.turnEnd('Updated final response.', 'turn-2');
    await started;
    assert.equal(seen.length, 2, 'turn end runs one batch');
    assert.ok(seen[1].text.includes(parts.details) && seen[1].text.includes('Use the shared store.'), 'end batch includes the previous final and delivered user request');
    assert.ok(seen[1].text.includes('Updated final response.'), 'end batch includes the current final');
    assert.equal(seen[1].batch, true);
    assert.equal(seen[1].turnId, 'turn-2');
    assert.equal(seen[1].text.split('Use the shared store.').length - 1, 1, 'delivered request is stored once');
    assert.ok(!seen[1].text.includes('duplicate'), 'duplicate turn ids do not store another request');
    await first.turnEnd('Updated final response.', 'turn-2');
    assert.equal(seen.length, 2, 'duplicate turn end ids do not run another batch');
    release(); await pending;
    const { memoryTool } = load('validator/memoryTool');
    const store = { export: async () => [], recall: async () => [] };
    const tool = memoryTool(async () => store, 'fixture-workspace', (query, agent) => first.memoryCall(query, agent));
    const result = await tool.run({ action: 'search', query: 'Which rule?', agentId: 'calling-agent' });
    assert.equal(result.answer, 'Source-backed memory answer');
    assert.equal(seen.at(-1).source, 'memory:calling-agent');
    assert.equal(errors.length, 0);
    const broken = new ValidatorTriggers('broken-workspace', async () => { throw new Error('offline'); }, () => '007-fixture', () => errors.push('visible failure'));
    await broken.turnEnd('Final response', 'broken');
    assert.equal(errors.length, 1);
    const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
    assert.match(extension, /provider\.setValidatorTurnStart/);
    assert.match(extension, /triggers\.turnEnd\(text, id\)/);
    assert.match(extension, /triggers\.memoryCall\(query, agentId\)/);
    assert.match(extension, /run: validatorWorkerRun\(/, 'production uses the tested worker port');
    const { EventEmitter } = require('node:events');
    let child;
    const { OpenCodeWorkerRuntime } = load('workers/openCodeRuntime');
    const { validatorProfile } = load('validator/profile');
    const { ValidatorObserver, validatorWorkerRun } = load('validator/observer');
    const runtime = new OpenCodeWorkerRuntime([validatorProfile()], { ledgerDir: 'ledger-fixture', now: () => 11000,
        attachUrl: 'http://127.0.0.1:4096', setTimer: () => () => {}, spawner: args => {
            assert.ok(args.includes('--attach') && args.includes('github-copilot/gpt-5.6-luna') && args.includes('aa-validator'));
            child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
            return child;
        } });
    const billed = new ValidatorObserver({ workspaceRoot: 'billed-workspace', commentary: { postValidator() {} },
        run: validatorWorkerRun(async () => runtime, 'billed-workspace', () => 'turn-billed') });
    const billingTrigger = new ValidatorTriggers('billed-workspace', async () => billed, () => '007-fixture', () => assert.fail('billing failed'));
    const complete = billingTrigger.turnEnd('Whole final reply\n## Response Handoff\nDone', 'final-billed');
    while (!child) await Promise.resolve();
    const emit = event => child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
    emit({ type: 'step_finish', sessionID: 'ses_validator', part: { cost: .02, tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 80, write: 10 } } } });
    emit({ type: 'text', sessionID: 'ses_validator', part: { text: '{"answer":null,"sources":[],"summary":"done"}\nResult: PASS' } });
    child.emit('exit', 0);
    await complete;
    const spend = runtime.usageSince('billed-workspace', 10000);
    assert.equal(spend.requests, 1); assert.equal(spend.dollars, .02);
    assert.equal(spend.inputTokens, 190); assert.equal(spend.outputTokens, 20); assert.equal(spend.cachedTokens, 80);
    assert.equal(runtime.list('billed-workspace')[0].dispatchTurnId, 'turn-billed');
    const bannerSource = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
    const banner = {};
    vm.runInNewContext(bannerSource.slice(bannerSource.indexOf('// ── Usage banner'), bannerSource.indexOf('// ── end Usage banner')) + ';out.html=chatBannerHtml;', { out: banner });
    assert.match(banner.html({ lastRequest: {}, workers: spend }, 11000), /\$0\.02/);
    console.log('PASS EV-VALIDATOR-WORKER-SPEND: turn=turn-billed requests=1 dollars=0.02 input=190 output=20 cached=80 banner=0.02');
    assert.match(require('./package.json').scripts['pretest:workers'], /test-validator-triggers\.cjs/);
    console.log('PASS EV-VALIDATOR-TRIGGERS: whole-final, previous-pair, caller-only memory, cross-window dedupe, nonblocking failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
