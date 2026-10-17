// Copilot harness compatibility (VS Code 1.140+): sandbox-safe hooks, sandbox grants, /sk.* commands.
// Run: node test-copilot-harness.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadModule(relative) {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, relative)], bundle: true,
        platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, require, __dirname });
    return module.exports;
}

const hooks = loadModule('src/hooks/copilotHooks.ts');
const install = loadModule('src/specs/specKitInstall.ts');
const assets = loadModule('src/specs/specKitPromptAssets.ts');
const agent = loadModule('src/agents/askawayBuildAgent.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-copilot-harness-'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const sh = (command) => childProcess.spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });

// R-HOOKS-01: a hook script the sandbox cannot start must not fail the hook, because a failed
// preToolUse hook denies every tool call in the Copilot harness.
const missing = path.join(tmp, 'denied-gate.sh');
assert.equal(sh(missing).status, 127, 'baseline: an unstartable script fails');
assert.equal(sh(hooks.failOpenCommand(missing)).status, 0, 'fail-open command exits 0');
const unreadable = path.join(tmp, 'noexec.sh');
fs.writeFileSync(unreadable, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
assert.equal(sh(unreadable).status, 126, 'baseline: a non-executable script is the sandbox 126 failure');
assert.equal(sh(hooks.failOpenCommand(unreadable)).status, 0, 'exit 126 becomes 0');
const ok = path.join(tmp, 'ok.sh');
fs.writeFileSync(ok, '#!/bin/sh\ncat\n', { mode: 0o755 });
const piped = childProcess.spawnSync('/bin/sh', ['-c', hooks.failOpenCommand(ok)], { input: '{"a":1}', encoding: 'utf8' });
assert.equal(piped.stdout, '{"a":1}', 'a working hook still receives stdin and returns stdout');
assert.equal(hooks.failOpenCommand(hooks.failOpenCommand(ok)), hooks.failOpenCommand(ok), 'wrapping is idempotent');

const entry = hooks.copilotCommandHook('/x/gate.sh', 5);
assert.deepEqual(plain(entry), { type: 'command', command: '/x/gate.sh || exit 0', cwd: '.', timeout: 5 });
const shell = hooks.copilotShellHook('/x/gate.sh', 5);
assert.equal(shell.bash, '/x/gate.sh || exit 0');
assert.equal(shell.powershell, shell.bash);
assert.equal(shell.timeoutSec, 5);

// Conversation hooks are fail-open and quote a home directory with spaces.
const conversation = hooks.conversationHooksConfig('/Users/Some One/.askaway/hooks');
assert.equal(conversation.hooks.UserPromptSubmit[0].command, "node '/Users/Some One/.askaway/hooks/spec-context-inject.cjs' || exit 0");
assert.equal(conversation.hooks.Stop[0].command, "node '/Users/Some One/.askaway/hooks/compact-chat-capture.cjs' || exit 0");

// R-HOOKS-02: hooks get the sandbox paths they read and write; the reviewer's own entries are kept.
const wanted = hooks.hookSandboxPaths('/Users/m', '/Users/m/Library/Application Support/Code/User');
assert.deepEqual(plain(wanted.readwritePaths), ['/Users/m/.askaway']);
assert.ok(wanted.readonlyPaths.includes('/Users/m/Library/Application Support/Code/User/workspaceStorage'));
const merged = hooks.mergeSandboxPaths({ readwritePaths: ['/build'], deniedPaths: ['/secret'] }, wanted);
assert.deepEqual(plain(merged.readwritePaths), ['/build', '/Users/m/.askaway']);
assert.deepEqual(plain(merged.deniedPaths), ['/secret']);
assert.equal(hooks.mergeSandboxPaths(merged, wanted), undefined, 'second merge changes nothing');
assert.equal(hooks.mergeSandboxPaths({ deniedPaths: ['/Users/m/.askaway'], readonlyPaths: wanted.readonlyPaths }, wanted), undefined, 'a denied path stays denied');
assert.deepEqual(plain(hooks.mergeSandboxPaths(undefined, wanted).readwritePaths), plain(wanted.readwritePaths));

// R-SKFLOW-25: /sk.* reach every harness. Local reads prompt files, Copilot reads skills (no dots in names).
(async () => {
    const targets = { promptsDir: path.join(tmp, 'prompts'), copilotHome: path.join(tmp, '.copilot'), claudeHome: path.join(tmp, '.claude') };
    fs.mkdirSync(path.join(targets.copilotHome, 'skills', 'sk-check'), { recursive: true });
    fs.writeFileSync(path.join(targets.copilotHome, 'skills', 'sk-check', 'SKILL.md'), 'stale migrated copy');
    fs.mkdirSync(path.join(targets.copilotHome, 'skills', 'mine'), { recursive: true });
    fs.writeFileSync(path.join(targets.copilotHome, 'skills', 'mine', 'SKILL.md'), 'reviewer skill');

    const result = await install.installSpecKitCommands(targets);
    const names = Object.keys(assets.SPEC_KIT_PROMPTS);
    assert.equal(result.prompts, names.length);
    for (const name of names) {
        assert.equal(fs.readFileSync(path.join(targets.promptsDir, name), 'utf8'), assets.SPEC_KIT_PROMPTS[name], `${name} installed for the Local harness`);
        const skillName = name.replace(/\.prompt\.md$/, '').replace(/\./g, '-');
        const skill = fs.readFileSync(path.join(targets.copilotHome, 'skills', skillName, 'SKILL.md'), 'utf8');
        assert.match(skill, new RegExp(`^---\\nname: ${skillName}\\n`), `${skillName} skill name matches its folder`);
        assert.match(skill, /disable-model-invocation: true/);
        assert.doesNotMatch(skill, /^agent:/m, 'prompt-only frontmatter is dropped');
        assert.match(skill, /^# \/sk\./m, 'the command body is kept');
    }
    for (const name of Object.keys(assets.CLAUDE_SPEC_KIT_COMMANDS)) {
        assert.ok(fs.existsSync(path.join(targets.claudeHome, 'commands', name)), `${name} installed for Claude Code`);
    }
    assert.notEqual(fs.readFileSync(path.join(targets.copilotHome, 'skills', 'sk-check', 'SKILL.md'), 'utf8'), 'stale migrated copy', 'AskAway-owned sk-* skills are refreshed');
    assert.equal(fs.readFileSync(path.join(targets.copilotHome, 'skills', 'mine', 'SKILL.md'), 'utf8'), 'reviewer skill', 'other skills are untouched');
    const second = await install.installSpecKitCommands(targets);
    assert.deepEqual([second.prompts, second.skills, second.claudeCommands], [0, 0, 0], 'a second activation writes nothing');

    // The Copilot copy of the build agent gains the shipped tools it lacks, and nothing else changes.
    const before = '---\nname: "AskAway Build"\ntools: [execute, intuitiv.askaway/memory2]\n---\nBody\n';
    const after = agent.addMissingAskAwayTools(before, ['memory2', 'asks', 'worker']);
    assert.match(after, /^tools: \[execute, intuitiv\.askaway\/memory2, intuitiv\.askaway\/asks, intuitiv\.askaway\/worker\]$/m);
    assert.ok(after.endsWith('---\nBody\n'));
    assert.equal(agent.addMissingAskAwayTools(after, ['memory2', 'asks', 'worker']), after, 'idempotent');

    console.log('PASS EV-COPILOT-HARNESS hooksFailOpen=true sandboxGrants=true skCommands=true');
})().catch((error) => { console.error(error); process.exit(1); });
