// Team model/thinking (reviewer, 2026-10-21): one saved choice for every workspace, model and thinking listed separately
// and merged across opencode/agy/claude, a signed-out CLI asks for a manual sign-in, build is Sonnet or Argon, grafana tools.
// Run: node test-team-model-selection.cjs
const strict = require('node:assert/strict');
const assert = Object.assign((...args) => strict(...args), strict, { deepEqual: require('node:assert').deepEqual });
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function bundle(file) {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true, external: ['vscode'], platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const loaded = { exports: {} };
    vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require, __dirname, Buffer, console, process });
    return loaded.exports;
}
const roster = bundle('src/team/roster.ts');
const profiles = bundle('src/workers/workerProfiles.ts');
const router = bundle('src/workers/workerRouter.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-model-'));
const file = path.join(dir, 'team', 'members.json');
const none = path.join(dir, 'no-profiles');

// 1. One choice, saved in the home-level file: any workspace reads the same model and thinking.
assert.deepEqual(roster.memberSelections(file), {}, 'nothing saved yet');
roster.saveMemberSelection('diego', { model: 'agy/gemini-4-argon-low', thinking: 'low' }, file);
roster.saveMemberSelection('tara', { model: 'claude/sonnet', thinking: 'high' }, file);
assert.deepEqual(roster.memberSelections(file), { diego: { model: 'agy/gemini-4-argon-low', thinking: 'low' }, tara: { model: 'claude/sonnet', thinking: 'high' } });
const diego = roster.teamRoster(none, file).find((m) => m.id === 'diego');
assert.deepEqual([diego.model, diego.thinking], ['agy/gemini-4-argon-low', 'low'], 'the roster shows the saved choice');
assert.equal(roster.teamRoster(none, file).find((m) => m.id === 'anika').model, 'github-copilot/claude-sonnet-5.5', 'a member without a choice keeps its own default, and build (Anika) is Sonnet, not Opus');
assert.throws(() => roster.saveMemberSelection('diego', { model: 'bad model; rm', thinking: 'low' }, file), /invalid model/);
assert.throws(() => roster.saveMemberSelection('../x', { model: 'claude/opus', thinking: 'low' }, file), /invalid member id/);
roster.saveMemberProfile('diego', { name: 'Diego' }, file, path.join(dir, 'avatars'));
assert.equal(roster.memberSelections(file).diego.model, 'agy/gemini-4-argon-low', 'saving the profile form keeps the model choice');

// 2. The choice drives the member's worker tasks: the profile owner's pick replaces the profile default, agy included.
assert.deepEqual(roster.memberSelectionForProfile('code', none, file), { model: 'agy/gemini-4-argon-low', thinking: 'low' }, 'Diego owns the code profile');
assert.deepEqual(roster.memberSelectionForProfile('test', none, file), { model: 'claude/sonnet', thinking: 'high' }, 'Tara owns the test profile');
assert.equal(roster.memberSelectionForProfile('explore', none, file), undefined, 'a member without a choice leaves the profile default');
const base = profiles.parseWorkerProfile(`---
name: code
description: "x"
tier: mid
model: github-copilot/gpt-6.1-sol
thinking: medium
models: [github-copilot/gpt-6.1-sol]
thinkingOptions: [low, medium, high]
---
body`);
const picked = profiles.withSelection(base, { model: 'agy/gemini-4-argon-low', thinking: 'low' });
assert.equal(profiles.defaultModel(picked), 'agy/gemini-4-argon-low', 'an explicit Team pick is honored even for agy');
assert.equal(profiles.defaultModel(profiles.parseWorkerProfile(`---
name: code
description: "x"
tier: mid
model: agy/gemini-4-argon-high
thinking: high
models: [agy/gemini-4-argon-high]
thinkingOptions: [high]
---
b`)), profiles.INTERIM_DEFAULT_MODEL, 'without a pick agy is still not chosen silently');
const routed = new router.WorkerRouter([base], { memberSelection: (name) => (name === 'code' ? { model: 'claude/opus', thinking: 'high' } : undefined) });
const result = routed.route({ workspacePath: dir, profile: 'code', cwd: dir, packetId: 'p', estimatedSeconds: 1 });
assert.deepEqual([result.status, result.model, result.thinking], ['CREATED', 'claude/opus', 'high'], 'the router runs the member\'s model and thinking');

// 3. The Model dropdown lists each model once, the Thinking dropdown its efforts, merged across integrations.
const web = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const block = web.slice(web.indexOf('    // Models the enabled integrations offered'), web.indexOf('    function isValidatorWorker(w)'));
const kit = new Function(`${block}\nreturn { teamModelCatalog, effortsForModel, composeModelId, splitModelId, set(ids) { runtimeModelIds = ids; } };`)();
kit.set(['github-copilot/gpt-6.1-sol', 'github-copilot/claude-opus-5.5', 'agy/gemini-4-argon-high', 'agy/gemini-4-argon-low', 'agy/gemini-4-argon-medium',
    'agy/gemini-3.1-pro-high', 'agy/gemini-3.1-pro-low', 'claude/sonnet', 'claude/haiku']);
const catalog = kit.teamModelCatalog();
assert.deepEqual(catalog.map((m) => m.id), ['github-copilot/gpt-6.1-sol', 'github-copilot/claude-opus-5.5', 'agy/gemini-4-argon', 'agy/gemini-3.1-pro', 'claude/sonnet', 'claude/haiku'], 'thinking is stripped from the model name');
assert.deepEqual(kit.effortsForModel('agy/gemini-4-argon-high'), ['low', 'medium', 'high'], 'the efforts come from the listed variants');
assert.deepEqual(kit.effortsForModel('agy/gemini-3.1-pro'), ['low', 'high']);
assert.deepEqual(kit.effortsForModel('claude/sonnet'), ['low', 'medium', 'high', 'xhigh', 'max']);
assert.deepEqual(kit.effortsForModel('github-copilot/gpt-6.1-sol'), ['low', 'medium', 'high']);
assert.equal(kit.composeModelId('agy/gemini-4-argon', 'low'), 'agy/gemini-4-argon-low', 'an agy model is saved with its effort in the name');
assert.equal(kit.composeModelId('agy/gemini-4-argon-high', 'medium'), 'agy/gemini-4-argon-medium');
assert.equal(kit.composeModelId('claude/sonnet', 'max'), 'claude/sonnet', 'other models are saved by name; the effort rides separately');
assert.ok(!catalog.some((m) => /-(low|medium|high)$/.test(m.id)), 'no model entry carries a thinking suffix');

// 4. Wiring: the choice is saved once for all workspaces, the Team state carries it, and Settings offers a manual sign-in.
const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
assert.match(provider, /case 'setMemberModel':\s*this\._setMemberModel\(message\)/);
assert.match(provider, /saveMemberSelection\(String\(message\.memberId\)/);
assert.match(provider, /memberSettings: memberSelections\(\)/, 'every workspace\'s Team state carries the saved choices');
assert.match(provider, /this\._workersStateSource\(root, this\._lastSubmitTs\)/, 'the Team members get the turn start, so their Turn is not $0');
assert.match(fs.readFileSync(path.join(__dirname, 'src/mcp/mcpServer.ts'), 'utf8'), /projectWorkersState\(this\.getWorkerRuntime\(\), workspacePath, Date\.now, turnStartedAt\)/);
assert.match(web, /data-signin-integration/);
assert.match(provider, /case 'signInIntegration'/);

// 5. Profiles: build is Sonnet or Argon, never Opus; Grafana reaches Test, Performance and Developer workers.
for (const name of ['build']) {
    const built = profiles.parseWorkerProfile(fs.readFileSync(path.join(__dirname, 'worker-profiles', name + '.md'), 'utf8'));
    assert.equal(built.model, 'github-copilot/claude-sonnet-5.5');
    assert.ok(built.models.every((m) => !/opus/.test(m)), 'the build profile offers no Opus');
    assert.ok(built.models.includes('agy/gemini-4-argon-high'));
}
const lite = profiles.parseWorkerProfile(fs.readFileSync(path.join(__dirname, 'worker-profiles', 'build-lite.md'), 'utf8'));
assert.ok(lite.mcp.includes('grafana_*'), 'Diego (Developer, build-lite) has Grafana');
const grafana = profiles.toOpenCodeAgent(lite);
assert.match(grafana, /"grafana_\*": allow/, 'OpenCode workers are allowed the grafana tools');
assert.equal(profiles.toAgyPermissions({ mcp: ['grafana_*'], bash: 'deny' }).length, 0, 'agy rules cover AskAway tools only');
console.log('test-team-model-selection: passed (EV-TEAM-MODEL-SELECTION)');
