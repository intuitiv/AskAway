// Each enabled integration's models are discovered at its check, stored on disk and offered in the Team dropdowns (R-WORKERS-RUNTIME-MODELS).
// Run: node test-runtime-models.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/workers/runtimeModels.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
const { loadRuntimeModels, recordRuntimeModels, namespacedModels, parseOpenCodeModels } = loaded.exports;

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-models-')), 'nested', 'runtime-models.json');
assert.deepEqual(loadRuntimeModels(file), {}, 'no file: nothing stored');
assert.deepEqual(parseOpenCodeModels('github-copilot/claude-sonnet-5.5\nnoise line\n  github-copilot/gpt-6-luna \n'), ['github-copilot/claude-sonnet-5.5', 'github-copilot/gpt-6-luna']);

recordRuntimeModels('opencode', ['github-copilot/claude-sonnet-5.5'], 1000, file);
recordRuntimeModels('agy', ['gemini-4-argon-high', 'gemini-3.8-flash-low'], 2000, file);
recordRuntimeModels('claude', ['sonnet', 'opus', 'haiku'], 3000, file);
const stored = loadRuntimeModels(file);
assert.equal(stored.agy.checkedAt, 2000);
assert.deepEqual(namespacedModels(stored), ['github-copilot/claude-sonnet-5.5', 'agy/gemini-4-argon-high', 'agy/gemini-3.8-flash-low', 'claude/sonnet', 'claude/opus', 'claude/haiku']);
assert.deepEqual(namespacedModels(stored, runtime => runtime !== 'agy'), ['github-copilot/claude-sonnet-5.5', 'claude/sonnet', 'claude/opus', 'claude/haiku'], 'a runtime that is off offers no models');

recordRuntimeModels('agy', [], 4000, file);
assert.deepEqual(loadRuntimeModels(file).agy.models, ['gemini-4-argon-high', 'gemini-3.8-flash-low'], 'a failed check never wipes the last good list');
fs.writeFileSync(file, '{not json');
assert.deepEqual(loadRuntimeModels(file), {}, 'a corrupt file is ignored');
fs.writeFileSync(file, JSON.stringify({ agy: { checkedAt: 1, models: ['ok-model', 'bad id; rm -rf'] }, claude: 'x' }));
assert.deepEqual(loadRuntimeModels(file), { agy: { checkedAt: 1, models: ['ok-model'] } }, 'unsafe ids and bad entries are dropped');
console.log('test-runtime-models: passed (EV-RUNTIME-MODELS store)');
