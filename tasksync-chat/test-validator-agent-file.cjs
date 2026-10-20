// Priya has an agent file: the link creates the default on first use and the validator follows the user's edits (R-TEAM-47).
// Run: node test-validator-agent-file.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/validator/profile.ts')], bundle: true, external: ['vscode'],
    platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const loaded = { exports: {} };
vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require, __dirname, Buffer, console, process });
const { validatorProfile, ensureValidatorAgentFile, VALIDATOR_AGENT_FILE, VALIDATOR_PROFILE_MARKDOWN } = loaded.exports;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'priya-'));
const file = path.join(dir, 'nested', 'validator.md');
assert.equal(validatorProfile(file).name, 'validator', 'no file: the built-in profile applies');
assert.equal(ensureValidatorAgentFile(file), file);
assert.equal(fs.readFileSync(file, 'utf8'), VALIDATOR_PROFILE_MARKDOWN, 'the first click writes the default');
fs.writeFileSync(file, VALIDATOR_PROFILE_MARKDOWN.replace('thinking: low', 'thinking: medium').replace('thinkingOptions: [low]', 'thinkingOptions: [low, medium]'));
ensureValidatorAgentFile(file);
assert.equal(validatorProfile(file).thinking, 'medium', 'the file is not overwritten and its edits apply');
fs.writeFileSync(file, 'not a profile');
assert.equal(validatorProfile(file).name, 'validator', 'a broken edit falls back to the built-in profile');
assert.ok(VALIDATOR_AGENT_FILE.endsWith(path.join('.askaway', 'validator', 'validator.md')));
const roster = fs.readFileSync(path.join(__dirname, 'src/team/roster.ts'), 'utf8');
assert.match(roster, /agentFile: '~\/\.askaway\/validator\/validator\.md'/, 'Priya\'s Team card points at that file');
const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
assert.match(provider, /message\.profile === 'validator' \|\| message\.memberId === 'priya'[\s\S]{0,200}ensureValidatorAgentFile\(\)/);
console.log('test-validator-agent-file: passed (EV-VALIDATOR-AGENT-FILE)');
