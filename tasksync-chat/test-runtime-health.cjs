// EV-RUNTIME-HEALTH: Settings toggles + health gate for worker runtimes (reviewer, 2026-10-16). Through the one `worker` tool and
// the webview message glue, with a fake agy (PATH, login token, `agy models`), a fake OpenCode probe and a fake clock: defaults,
// refusal reasons, at least one runtime stays on, the daily recheck after 06:00 and the `runtimeHealth` message.
// Run: node test-runtime-health.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-health-test-build-'));
const src = path.join(__dirname, 'src');
// Transpiles the modules reachable through relative requires, mirroring src/ so `../team/...` paths resolve.
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
transpile('workers/runtimeHealth.ts');
transpile('workers/workerTools.ts');
transpile('workers/workerRouter.ts');
const health = require(path.join(buildDir, 'workers', 'runtimeHealth.js'));
const { workerTool, setWorkerRuntimeGate } = require(path.join(buildDir, 'workers', 'workerTools.js'));
const { parseWorkerProfile, resolveSelection, toOpenCodeAgent } = require(path.join(buildDir, 'workers', 'workerProfiles.js'));
const { WorkerRouter } = require(path.join(buildDir, 'workers', 'workerRouter.js'));
const SOL = 'github-copilot/gpt-6.1-sol';
// A profile whose file still says agy by default, as the reviewer's ~/.askaway/worker-profiles did on 2026-10-16.
const agyDefaultProfile = parseWorkerProfile(`---\nname: build\ndescription: "b"\ntier: mid\nmodel: agy/gemini-4-argon-high\nthinking: high\nmodels: [${SOL}, agy/gemini-4-argon-high]\nthinkingOptions: [high]\nedit: allow\nbash: allow\n---\nBuild.\n`);
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });

const HOME = '/home/u';
const TOKEN = `${HOME}/.gemini/antigravity-cli/antigravity-oauth-token`;
const SIGNED_IN = 'Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n';
const FALLBACK = 'Fetching available models...\ngemini-3.1-pro-low\tGemini 3.1 Pro (Low)\n';

function fakeHost() {
    const host = { settings: { opencode: true, agy: false, claude: false }, files: new Set(['/fake/bin/agy', '/fake/bin/claude', TOKEN]), models: SIGNED_IN, server: true,
        claude: '{"loggedIn":true,"authMethod":"claude.ai"}', opencodeModelList: 'github-copilot/claude-sonnet-5.5\ngithub-copilot/gpt-6.1-sol\n', claudeCalls: 0, restarts: 0, order: [],
        clock: new Date(2026, 9, 15, 10, 0).getTime(), warnings: [], modelCalls: 0, probes: 0, started: [] };
    health.configureRuntimeHealth({
        enabled: (runtime) => host.settings[runtime],
        setEnabled: async (runtime, value) => { host.settings[runtime] = value; },
        warn: (message) => host.warnings.push(message),
        home: () => HOME,
        pathDirs: () => ['/fake/bin'],
        exists: (file) => host.files.has(file),
        agyModels: async (binary) => { assert.equal(binary, '/fake/bin/agy'); host.modelCalls++; if (host.modelsError) { throw new Error(host.modelsError); } return host.models; },
        opencodeModels: async () => { if (host.opencodeModelsError) { throw new Error(host.opencodeModelsError); } return host.opencodeModelList; },
        modelsFile: () => path.join(buildDir, 'runtime-models.json'),
        claudeAuth: async (binary) => { assert.equal(binary, '/fake/bin/claude'); host.claudeCalls++; if (host.claudeError) { throw new Error(host.claudeError); } return host.claude; },
        probeOpenCode: async () => { host.probes++; host.order.push('probe'); return host.server; },
        restartOpenCode: async () => { host.restarts++; host.order.push('restart'); if (host.restartError) { throw new Error(host.restartError); } host.server = true; },
        now: () => host.clock,
    });
    return host;
}

const packet = { profile: 'build', dispatchTurnId: 't1', baseRevision: 'HEAD', objective: 'o', allowedFiles: ['src/o.ts'], acceptance: 'a', expected: 'e', command: 'npm test' };
function tool(host, workers = {}, runs = {}) {
    host.sourceCalls = 0;
    const live = { router: { worker: (id) => workers[id], profile: (name) => name === 'build' ? agyDefaultProfile : undefined }, now: () => host.clock,
        status: (runId) => runs[runId],
        start: async (p) => { host.started.push(p); return { status: 'QUEUED', runId: 'run-1' }; },
        resume: async (runId) => { host.started.push({ runId }); return { status: 'RUNNING', runId }; },
        submitForking: async (id, p) => { host.started.push(p); return { status: 'QUEUED', runId: 'run-2' }; } };
    // `source` is the starting getter (it would start the shared OpenCode server); the inspector never starts anything.
    const source = () => { host.sourceCalls++; return live; };
    setWorkerRuntimeGate(health.runtimeRefusal, () => live);
    return (input) => workerTool(source, '/ws').run(input);
}

(async () => {
    // Defaults (reviewer 2026-10-16 "Why did we disable it?"): OpenCode and agy on, Claude off; outside VS Code the same.
    const props = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).contributes.configuration.properties;
    assert.equal(props['askaway.workers.opencode.enabled'].default, true);
    assert.equal(props['askaway.workers.agy.enabled'].default, true);
    assert.equal(props['askaway.workers.claude.enabled'].default, false);
    health.configureRuntimeHealth({ probeOpenCode: async () => true });
    const defaults = health.getRuntimeHealth();
    assert.equal(defaults.opencode.enabled, true);
    assert.equal(defaults.agy.enabled, true);
    assert.equal(defaults.claude.enabled, false);
    assert.equal(defaults.claude.enabled, false);
    console.log('EV-RUNTIME-HEALTH defaults: PASS');

    // Refusal reasons, from the worker tool's caller.
    let host = fakeHost();
    let call = tool(host);
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).reason, 'agy is off in Settings');
    host.settings.agy = true;
    host.files.delete(TOKEN);
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).reason, 'agy login expired: run agy and sign in');
    host.files.add(TOKEN);
    host.models = FALLBACK;
    const fallback = await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' });
    assert.deepEqual([fallback.status, fallback.reason], ['RUNTIME_UNHEALTHY', 'agy login expired: run agy and sign in']);
    host.models = SIGNED_IN;
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).status, 'QUEUED');
    assert.deepEqual(health.runtimeDetail('agy').models, ['gemini-4-argon-high', 'gemini-3.8-flash-low']);
    // A submit without a model follows the warm worker's agy model.
    call = tool(host, { 'w-agy': { model: 'agy/gemini-4-argon-high' } });
    host.settings.agy = false;
    assert.equal((await call({ action: 'submit', workerId: 'w-agy', ...packet })).reason, 'agy is off in Settings');
    host.server = false;
    assert.equal((await call({ action: 'start', ...packet })).reason, 'OpenCode server is not up');
    host.server = true;
    assert.equal((await call({ action: 'start', ...packet })).status, 'QUEUED');
    host.settings.agy = true;
    host.settings.opencode = false;
    assert.equal((await call({ action: 'start', ...packet })).reason, 'OpenCode is off in Settings');
    host.settings.agy = false;
    const off = await call({ action: 'start', ...packet });
    assert.deepEqual([off.status, off.reason], ['WORKERS_DISABLED', 'WORKERS_DISABLED: enable OpenCode, agy or Claude in Settings']);
    assert.equal(host.started.length, 2, 'only the two healthy dispatches reached the runtime');

    // The gate uses the effective model: an agy-default profile without a model runs on Sol (OpenCode); resume follows its run.
    host = fakeHost();
    call = tool(host, {}, { 'run-agy': { model: 'agy/gemini-4-argon-high' }, 'run-oc': { model: SOL } });
    assert.equal((await call({ action: 'start', ...packet })).status, 'QUEUED', 'agy off never blocks the Sol default');
    host.sourceCalls = 0;
    assert.equal((await call({ action: 'resume', runId: 'run-agy' })).reason, 'agy is off in Settings');
    assert.equal(host.sourceCalls, 0, 'a refused dispatch never starts the OpenCode server');
    host.server = false;
    assert.equal((await call({ action: 'resume', runId: 'run-oc' })).reason, 'OpenCode server is not up');
    host.settings.agy = true;
    host.sourceCalls = 0;
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).status, 'QUEUED');
    assert.equal(host.sourceCalls, 1, 'an agy dispatch is gated without starting the OpenCode server first');
    host.modelsError = 'timed out after 30s';
    host.clock += 24 * 3600_000;
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).reason, 'agy models check failed: timed out after 30s');
    console.log('EV-RUNTIME-HEALTH effective model, resume, no server start before refusal, models-check failure: PASS');

    // Interim Sol default (reviewer 2026-10-16): an omitted model never selects agy, so `start` never reuses an idle agy worker.
    assert.equal(resolveSelection(agyDefaultProfile).model, SOL);
    assert.equal(resolveSelection(agyDefaultProfile, { model: 'agy/gemini-4-argon-high' }).model, 'agy/gemini-4-argon-high');
    assert.match(toOpenCodeAgent(agyDefaultProfile), new RegExp(`^model: ${SOL}$`, 'm'));
    const router = new WorkerRouter([agyDefaultProfile]);
    const route = (model) => router.route({ workspacePath: os.tmpdir(), profile: 'build', model, packetId: 'p', estimatedSeconds: 60 });
    const agyRun = route('agy/gemini-4-argon-high');
    router.complete(agyRun.workerId, agyRun.runId, { contextTokens: 1000 });
    const plain = route(undefined);
    assert.deepEqual([plain.status, plain.model], ['CREATED', SOL]);
    assert.notEqual(plain.workerId, agyRun.workerId, 'start without a model does not reuse the idle agy worker');
    assert.equal(route('agy/gemini-4-argon-high').workerId, agyRun.workerId, 'an explicit agy start still reuses it');
    console.log('EV-RUNTIME-HEALTH interim Sol default, no agy reuse without explicit model: PASS');

    // A check that throws is reported as a warning, never an unhandled rejection.
    host = fakeHost();
    health.configureRuntimeHealth({ enabled: () => { throw new Error('settings unreadable'); }, warn: (message) => host.warnings.push(message) });
    health.startRuntimeHealth(1e9).dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(host.warnings.pop() ?? '', /Worker runtime check failed: settings unreadable/);
    assert.equal(unhandled, 0);
    console.log('EV-RUNTIME-HEALTH failed check warns, no unhandled rejection: PASS');
    console.log('EV-RUNTIME-HEALTH refusal reasons: PASS');

    // At least one runtime stays on: the last enabled toggle is refused with a warning, from the webview and settings.json.
    host = fakeHost();
    await health.handleRuntimeHealthMessage({ type: 'setRuntimeEnabled', runtime: 'opencode', enabled: false });
    assert.equal(host.settings.opencode, true);
    assert.match(host.warnings.pop(), /at least one worker runtime/);
    await health.handleRuntimeHealthMessage({ type: 'setRuntimeEnabled', runtime: 'agy', enabled: true });
    await health.handleRuntimeHealthMessage({ type: 'setRuntimeEnabled', runtime: 'opencode', enabled: false });
    assert.deepEqual(host.settings, { opencode: false, agy: true, claude: false });
    host.settings.agy = false;
    await health.runtimeSettingChanged('agy');
    assert.equal(host.settings.agy, true);
    assert.match(host.warnings.pop(), /agy stays on/);
    // The rule spans all three integrations: Claude on lets the last worker runtime go off, then Claude itself is kept.
    host.settings = { opencode: true, agy: false, claude: true };
    assert.equal(await health.setRuntimeEnabled('opencode', false), true);
    assert.equal(await health.setRuntimeEnabled('claude', false), false);
    assert.equal(host.settings.claude, true);
    const call2 = tool(host);
    assert.notEqual((await call2({ action: 'start', ...packet })).status, 'WORKERS_DISABLED', 'Claude on is a worker runtime');
    console.log('EV-RUNTIME-HEALTH last runtime refused: PASS');

    // Daily recheck: once per day after 06:00 local, and before an agy task whose last ok check predates 06:00 today.
    host = fakeHost();
    host.settings.agy = true;
    await health.recheckRuntimeHealth();
    assert.equal(host.modelCalls, 1);
    host.clock = new Date(2026, 9, 16, 5, 0).getTime();
    assert.equal(await health.runtimeHealthTick(), false);
    host.clock = new Date(2026, 9, 16, 7, 0).getTime();
    assert.equal(await health.runtimeHealthTick(), true);
    assert.equal(host.modelCalls, 2);
    host.clock = new Date(2026, 9, 16, 8, 0).getTime();
    assert.equal(await health.runtimeHealthTick(), false);
    call = tool(host);
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).status, 'QUEUED');
    assert.equal(host.modelCalls, 2, 'a check from this morning is reused');
    host.clock = new Date(2026, 9, 17, 6, 30).getTime();
    host.models = FALLBACK;
    assert.equal((await call({ action: 'start', ...packet, runtime: 'agy', model: 'gemini-4-argon-high' })).reason, 'agy login expired: run agy and sign in');
    assert.equal(host.modelCalls, 3, 'yesterday\'s ok check is rechecked before the agy task');
    console.log('EV-RUNTIME-HEALTH daily recheck: PASS');

    // The webview gets `runtimeHealth` at once and on every change, including a recheck request.
    host = fakeHost();
    const posted = [];
    const view = health.bindRuntimeHealthView((message) => posted.push(message));
    assert.equal(posted[0].type, 'runtimeHealth');
    assert.equal(posted[0].health.agy.enabled, false);
    await health.handleRuntimeHealthMessage({ type: 'setRuntimeEnabled', runtime: 'agy', enabled: true });
    const last = posted.at(-1);
    assert.deepEqual([last.type, last.health.agy.enabled, last.health.agy.ok], ['runtimeHealth', true, true]);
    host.server = false;
    await health.handleRuntimeHealthMessage({ type: 'recheckRuntimeHealth' });
    assert.deepEqual([posted.at(-1).health.opencode.ok, health.runtimeDetail('opencode').reason], [false, 'OpenCode server is not up']);
    view.dispose();
    const count = posted.length;
    await health.recheckRuntimeHealth();
    assert.equal(posted.length, count, 'a disposed view gets no more messages');
    const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
    assert.match(provider, /case 'setRuntimeEnabled':\s*case 'recheckRuntimeHealth':\s*void handleRuntimeHealthMessage\(message\)/);
    assert.match(provider, /onDidChangeRuntimeHealth\(\(health\) => this\._broadcast\(\{ type: 'runtimeHealth', health, models: getRuntimeModelIds\(\) \}\)\)/);
    console.log('EV-RUNTIME-HEALTH runtimeHealth message: PASS');

    // Model discovery (reviewer 2026-10-20): every check of an enabled integration refreshes its stored model list, the
    // runtimeHealth message carries the ids the Team dropdowns offer, and a failed check keeps the last good list.
    host = fakeHost();
    fs.rmSync(path.join(buildDir, 'runtime-models.json'), { force: true });
    host.settings = { opencode: true, agy: true, claude: true };
    const modelMessages = [];
    const modelView = health.bindRuntimeHealthView((message) => modelMessages.push(message));
    await health.recheckRuntimeHealth();
    const offered = modelMessages.at(-1).models;
    for (const id of ['github-copilot/claude-sonnet-5.5', 'github-copilot/gpt-6.1-sol', 'agy/gemini-4-argon-high', 'agy/gemini-3.8-flash-low', 'claude/sonnet', 'claude/opus', 'claude/haiku']) {
        assert.ok(offered.includes(id), `${id} is offered`);
    }
    assert.ok(JSON.parse(fs.readFileSync(path.join(buildDir, 'runtime-models.json'), 'utf8')).claude.models.includes('haiku'), 'the list is stored on disk');
    host.settings.agy = false;
    await health.recheckRuntimeHealth('agy');
    assert.ok(!modelMessages.at(-1).models.some((id) => id.startsWith('agy/')), 'a runtime that is off offers no models');
    host.settings.agy = true;
    host.models = FALLBACK;
    host.clock += 1000;
    await health.recheckRuntimeHealth('agy');
    assert.ok(health.getRuntimeModelIds().includes('agy/gemini-4-argon-high'), 'a signed-out check (fallback list only) keeps the last good agy list');
    assert.ok(!health.getRuntimeModelIds().includes('agy/gemini-3.1-pro-low'), 'the signed-out fallback list is never stored');
    host.opencodeModelsError = 'boom';
    await health.recheckRuntimeHealth('opencode');
    assert.ok(health.getRuntimeModelIds().includes('github-copilot/gpt-6.1-sol'), 'a failed model listing keeps the stored OpenCode list');
    modelView.dispose();
    const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
    assert.match(webview, /runtimeModelIds = Array\.isArray\(message\.models\) \? message\.models : runtimeModelIds/);
    assert.match(webview, /var ids = runtimeModelIds\.length \? runtimeModelIds : TEAM_MODELS;/);
    console.log('EV-RUNTIME-HEALTH model discovery: PASS');

    // Integrations (reviewer 2026-10-16): Claude is checked through its CLI login; every integration shows the same
    // {enabled, ok, checkedAt}; one refresh per integration (OpenCode restarts its server first, agy/Claude only check).
    host = fakeHost();
    const integrationsView = [];
    const integrations = health.bindRuntimeHealthView((message) => integrationsView.push(message));
    await health.handleRuntimeHealthMessage({ type: 'setRuntimeEnabled', runtime: 'claude', enabled: true });
    assert.deepEqual(integrationsView.at(-1).health.claude, { enabled: true, ok: true, checkedAt: host.clock, signIn: false });
    host.claude = '{"loggedIn":false,"authMethod":"none"}';
    host.clock += 1000;
    await health.handleRuntimeHealthMessage({ type: 'refreshIntegration', runtime: 'claude' });
    assert.deepEqual(integrationsView.at(-1).health.claude, { enabled: true, ok: false, checkedAt: host.clock, signIn: true }, 'a signed-out CLI asks for a manual sign-in');
    assert.equal(health.runtimeDetail('claude').reason, 'Claude is not signed in');
    host.claudeError = 'timed out after 20s';
    await health.refreshIntegration('claude');
    assert.equal(health.runtimeDetail('claude').reason, 'Claude auth check failed: timed out after 20s');
    host.claudeError = undefined;
    host.files.delete('/fake/bin/claude');
    await health.refreshIntegration('claude');
    assert.match(health.runtimeDetail('claude').reason, /not installed/);
    assert.equal(host.restarts, 0, 'refreshing Claude never restarts the OpenCode server');
    host.settings.agy = true;
    const agyCalls = host.modelCalls;
    await health.handleRuntimeHealthMessage({ type: 'refreshIntegration', runtime: 'agy' });
    assert.deepEqual([host.modelCalls, host.restarts, integrationsView.at(-1).health.agy.ok], [agyCalls + 1, 0, true]);
    host.server = false;
    host.order.length = 0;
    await health.handleRuntimeHealthMessage({ type: 'refreshIntegration', runtime: 'opencode' });
    assert.deepEqual([host.restarts, host.order, integrationsView.at(-1).health.opencode.ok], [1, ['restart', 'probe'], true]);
    host.restartError = 'port busy';
    host.server = false;
    await health.refreshIntegration('opencode');
    assert.deepEqual([host.restarts, health.getRuntimeHealth().opencode.ok], [2, false]);
    assert.match(host.warnings.pop(), /OpenCode restart failed: port busy/);
    host.settings.opencode = false;
    await health.refreshIntegration('opencode');
    assert.equal(host.restarts, 2, 'a disabled OpenCode is checked, not restarted');
    const uniform = health.getRuntimeHealth();
    assert.deepEqual(Object.keys(uniform).sort(), ['agy', 'claude', 'opencode']);
    for (const name of ['opencode', 'agy', 'claude']) { assert.deepEqual(Object.keys(uniform[name]).sort(), ['checkedAt', 'enabled', 'ok', 'signIn'], name); }
    integrations.dispose();
    console.log('EV-RUNTIME-HEALTH integrations: claude check, refreshIntegration per runtime, uniform state: PASS');
    fs.rmSync(buildDir, { recursive: true, force: true });
})().catch((error) => { console.error(error); process.exit(1); });
