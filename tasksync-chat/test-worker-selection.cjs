// CY-003 worker profile, selection, and registry behavior. Run: node test-worker-selection.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-worker-profiles-'));
for (const name of ['workerProfiles', 'workerRouter']) {
    fs.writeFileSync(
        path.join(buildDir, `${name}.js`),
        ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText
    );
}
const profiles = require(path.join(buildDir, 'workerProfiles.js'));
const { WorkerRouter } = require(path.join(buildDir, 'workerRouter.js'));

const profileText = (name, extra = '') => `---
name: ${name}
description: "fixture ${name}"
tier: light
model: github-copilot/gpt-5.6-luna
thinking: low
models: [github-copilot/gpt-5.6-luna, github-copilot/gpt-5.6-terra]
thinkingOptions: [low, high]
edit: deny
bash: allow
${extra}---
Body for ${name}.
`;

// Installed profiles are the product configuration: each must parse and offer a real selection.
const installedDir = path.join(os.homedir(), '.askaway', 'worker-profiles');
const installed = fs.existsSync(installedDir) ? profiles.loadWorkerProfiles(installedDir) : [];
for (const profile of installed) {
    assert.ok(profile.models.length > 0 && profile.thinkingOptions.length > 0, `${profile.name} has allowed selections`);
    assert.equal(profiles.resolveSelection(profile).status, 'SELECTED', `${profile.name} default selection resolves`);
}
const installedNames = installed.map((profile) => profile.name);
assert.equal(new Set(installedNames).size, installedNames.length, 'installed profile names are unique');

// Fixture profiles for deterministic behavior checks.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-profile-fixture-'));
fs.writeFileSync(path.join(fixtureDir, 'explore.md'), profileText('explore'));
fs.writeFileSync(path.join(fixtureDir, 'authoring.md'), profileText('authoring', 'mcp: ["authoring_*"]\nskills: ["launchpad-*"]\n'));
const fixtures = profiles.loadWorkerProfiles(fixtureDir);
assert.deepEqual(fixtures.map((profile) => profile.name), ['authoring', 'explore']);
const explore = fixtures.find((profile) => profile.name === 'explore');
const authoring = fixtures.find((profile) => profile.name === 'authoring');

// Exact selection: allowed values resolve, anything else is refused with no fallback.
assert.deepEqual(profiles.resolveSelection(explore, { model: 'github-copilot/gpt-5.6-terra', thinking: 'high' }),
    { status: 'SELECTED', profile: 'explore', model: 'github-copilot/gpt-5.6-terra', thinking: 'high' });
const refusedModel = profiles.resolveSelection(explore, { model: 'github-copilot/claude-opus-5.5' });
assert.equal(refusedModel.status, 'SELECTION_UNAVAILABLE');
assert.equal(refusedModel.model, undefined, 'refusal carries no substitute model');
assert.equal(profiles.resolveSelection(explore, { thinking: 'xhigh' }).status, 'SELECTION_UNAVAILABLE');

// A malformed profile fails loudly instead of being silently skipped.
assert.throws(() => profiles.parseWorkerProfile(profileText('bad').replace('thinking: low', 'thinking: max')), /thinking/);

// Workspace isolation: equal labels on two real paths are two workers; a symlink to the same path is one.
const pathA = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-ws-a-'));
const pathB = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-ws-b-'));
const linkA = path.join(os.tmpdir(), `askaway-ws-link-${process.pid}`);
fs.rmSync(linkA, { force: true });
fs.symlinkSync(pathA, linkA);
const selection = { model: explore.model, thinking: explore.thinking };
const keys = new Set([
    profiles.workerRegistryKey(pathA, 'explore', selection),
    profiles.workerRegistryKey(pathB, 'explore', selection),
    profiles.workerRegistryKey(linkA, 'explore', selection),
]);
assert.equal(keys.size, 2, 'two real paths yield exactly two registry keys');
// A model or thinking change is a cache boundary: a distinct worker key.
assert.notEqual(
    profiles.workerRegistryKey(pathA, 'explore', selection),
    profiles.workerRegistryKey(pathA, 'explore', { model: explore.model, thinking: 'high' })
);

// OpenCode adapter: primary mode for `opencode run --agent`, scoped MCP/skill access, never a blanket bash allow.
const agent = profiles.toOpenCodeAgent(authoring);
assert.match(agent, /^mode: primary$/m);
assert.match(agent, /^model: github-copilot\/gpt-5\.6-luna$/m);
assert.match(agent, /^ {2}"authoring_\*": allow$/m);
assert.match(agent, /^ {4}"\*": deny$/m);
assert.match(agent, /^ {4}"launchpad-\*": allow$/m);
assert.match(agent, /^ {2}edit: deny$/m);
assert.doesNotMatch(agent, /bash: allow/, 'agent-level bash allow would override global denies');
for (const any of [agent, profiles.toOpenCodeAgent(explore)]) {
    assert.match(any, /^ {2}task: deny$/m, 'workers never spawn OpenCode subagents');
}
assert.doesNotMatch(profiles.toOpenCodeAgent(explore), /skill:/, 'profiles without skills get no skill access block');
const editor = profiles.parseWorkerProfile(profileText('code').replace('edit: deny', 'edit: allow'));
const editorAgent = profiles.toOpenCodeAgent(editor);
assert.match(editorAgent, /^ {2}edit:\n {4}"\*": allow\n {4}"\*\*\/\*\.env": deny/m, 'editing workers get explicit edit allow with .env still denied');
assert.doesNotMatch(editorAgent, /^ {2}edit: deny$/m);

const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-opencode-agents-'));
const written = profiles.syncOpenCodeAgents(fixtures, agentsDir);
assert.deepEqual(written.map((file) => path.basename(file)), ['aa-authoring.md', 'aa-explore.md']);

console.log(`EV-007 ProfileAndWorkspaceIsolation: PASS installedModes=${installed.length} allowedSelectionsPerMode=nonzero registryKeys=${keys.size} refusalsWithoutFallback=2`);

// ---- T008/T009 routing: every scenario through the public router, on a controllable clock. ----
let clock = 0;
const newRouter = () => { clock = 0; return new WorkerRouter(fixtures, { now: () => clock }); };
const req = (overrides = {}) => ({ workspacePath: pathA, profile: 'explore', packetId: 'p', estimatedSeconds: 30, ...overrides });

// Wait bound: exactly 120s reuses, 121s creates a new worker.
let router = newRouter();
const first = router.route(req({ estimatedSeconds: 120 }));
assert.equal(first.status, 'CREATED');
const atBound = router.route(req());
assert.deepEqual([atBound.status, atBound.workerId, atBound.queuePosition, atBound.estimatedWaitSeconds], ['REUSED', first.workerId, 1, 120]);
router = newRouter();
const slow = router.route(req({ estimatedSeconds: 121 }));
const overBound = router.route(req());
assert.equal(overBound.status, 'CREATED');
assert.notEqual(overBound.workerId, slow.workerId, 'over the bound yields a second worker of the same mode');
assert.match(overBound.reason, /estimated wait 121s > 120s/);
assert.equal(router.workers(pathA).filter((w) => w.profile === 'explore').length, 2, 'multiple workers per mode');

// Unavailable selection: explicit refusal and zero dispatches, never a substitute.
router = newRouter();
const refused = router.route(req({ model: 'github-copilot/claude-opus-5.5' }));
assert.equal(refused.status, 'SELECTION_UNAVAILABLE');
assert.equal(router.dispatches, 0, 'zero fallback dispatches');
assert.equal(router.route(req({ thinking: 'xhigh' })).status, 'SELECTION_UNAVAILABLE');
assert.equal(router.route(req({ profile: 'ghost' })).status, 'SELECTION_UNAVAILABLE');
assert.equal(router.dispatches, 0);

// Effective selection is recorded exactly; model or thinking change is a cache boundary.
router = newRouter();
const base = router.route(req());
router.complete(base.workerId, base.runId, { contextTokens: 1000 });
const sameSelection = router.route(req());
assert.equal(sameSelection.workerId, base.workerId, 'compatible idle warm worker is reused');
router.complete(sameSelection.workerId, sameSelection.runId, { contextTokens: 2000 });
const otherModel = router.route(req({ model: 'github-copilot/gpt-5.6-terra' }));
const otherThinking = router.route(req({ thinking: 'high' }));
assert.deepEqual([otherModel.status, otherModel.model], ['CREATED', 'github-copilot/gpt-5.6-terra']);
assert.deepEqual([otherThinking.status, otherThinking.thinking], ['CREATED', 'high']);
assert.equal(new Set([base.workerId, otherModel.workerId, otherThinking.workerId]).size, 3);
assert.equal(new Set([base.runId, sameSelection.runId, otherModel.runId, otherThinking.runId]).size, 4, 'every submission gets its own run');

// Cache freshness: reuse inside the TTL, new worker after it.
router = newRouter();
const warm = router.route(req());
router.complete(warm.workerId, warm.runId, { contextTokens: 10 });
clock = 299000;
const stillWarm = router.route(req());
assert.equal(stillWarm.workerId, warm.workerId);
router.complete(stillWarm.workerId, stillWarm.runId, { contextTokens: 20 });
clock += 301000;
const cold = router.route(req());
assert.equal(cold.status, 'CREATED');
assert.match(cold.reason, /cache expired/);

// Context above 300000 retires the worker; it is never reused.
router = newRouter();
const heavy = router.route(req());
router.complete(heavy.workerId, heavy.runId, { contextTokens: 300001 });
assert.equal(router.worker(heavy.workerId).state, 'RETIRED');
assert.match(router.worker(heavy.workerId).retiredReason, /300001/);
assert.notEqual(router.route(req()).workerId, heavy.workerId);

// Workspace isolation: same mode and selection on two real paths never share a worker.
router = newRouter();
const inA = router.route(req());
router.complete(inA.workerId, inA.runId, { contextTokens: 1 });
const inB = router.route(req({ workspacePath: pathB }));
assert.notEqual(inB.workerId, inA.workerId);
assert.equal(router.route(req({ workspacePath: linkA })).workerId, inA.workerId, 'a symlink resolves to the same workspace worker');
assert.deepEqual(router.workers(pathB).map((w) => w.workerId), [inB.workerId]);

// Serial queue: visible positions, cancel only before start, completion advances the queue.
router = newRouter();
const running = router.route(req({ estimatedSeconds: 10 }));
const q1 = router.route(req({ packetId: 'q1', estimatedSeconds: 10 }));
const q2 = router.route(req({ packetId: 'q2', estimatedSeconds: 10 }));
assert.deepEqual([q1.queuePosition, q2.queuePosition], [1, 2]);
assert.deepEqual(router.cancelQueued(running.workerId, running.runId), { status: 'NOT_QUEUED' }, 'running work is never cancelled by queue cancel');
assert.deepEqual(router.cancelQueued(running.workerId, q1.runId), { status: 'CANCELLED' });
assert.equal(router.complete(running.workerId, running.runId, { contextTokens: 5 }).runId, q2.runId, 'next queued entry starts, skipping the cancelled one');
assert.equal(router.worker(running.workerId).active.runId, q2.runId);

// Same inputs yield the same route. Worker IDs are host-unique, so compare which worker each route lands on, not its ID.
const replay = () => {
    const r = newRouter();
    const ids = [];
    return [r.route(req()), r.route(req({ estimatedSeconds: 200 })), r.route(req())].map((x) => {
        if (!ids.includes(x.workerId)) { ids.push(x.workerId); }
        return `${x.status}:worker#${ids.indexOf(x.workerId)}`;
    });
};
assert.deepEqual(replay(), replay());

console.log('EV-008 BoundedReuseSelection: PASS reuseAt120s=REUSED createAt121s=CREATED unavailable=SELECTION_UNAVAILABLE fallbackDispatches=0 cacheBoundaryWorkers=3');
console.log('EV-009 SelectionBehavior: PASS scenarios=9 effectiveSelectionExact=true workspaceIsolation=true queueCancelBeforeStartOnly=true deterministic=true');
console.log('CAC-CY-003 WorkspaceBoundDispatchReady: PASS');

const p1 = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'test-shared-opencode-server.cjs')], { encoding: 'utf8', timeout: 60000 });
assert.match(p1.stdout, /PAC-P1 OneServerTwoLiveSessions: PASS/, 'PAC-P2 requires PAC-P1');
console.log('PAC-P2 EligibleReuseAndPerModeSelection: PASS pacP1=PASS fallbackDispatches=0');

for (const dir of [buildDir, fixtureDir, pathA, pathB, agentsDir]) { fs.rmSync(dir, { recursive: true, force: true }); }
fs.rmSync(linkA, { force: true });
