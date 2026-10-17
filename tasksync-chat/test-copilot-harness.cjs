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

// R-SKFLOW-25: /sk.* reach every harness through the chatSkills / chatPromptFiles contribution points
// (Copilot harness skills cannot contain dots, so the command there is /sk-plan).
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const files = install.contributedSpecKitFiles();
const names = Object.keys(assets.SPEC_KIT_PROMPTS);
assert.equal(Object.keys(files).length, names.length * 2);
const contributedSkills = pkg.contributes.chatSkills.map((entry) => entry.path);
const contributedPrompts = pkg.contributes.chatPromptFiles.map((entry) => entry.path);
for (const name of names) {
    const skillName = name.replace(/\.prompt\.md$/, '').replace(/\./g, '-');
    assert.ok(contributedSkills.includes(`./skills/${skillName}/SKILL.md`), `${skillName} is contributed as a skill`);
    assert.ok(contributedPrompts.includes(`./prompts/${name}`), `${name} is contributed as a prompt file`);
}
assert.equal(contributedSkills.length, names.length);
assert.equal(contributedPrompts.length, names.length);
for (const [relative, content] of Object.entries(files)) {
    assert.ok(fs.existsSync(path.join(__dirname, relative)), `${relative} ships in the extension folder`);
    assert.equal(fs.readFileSync(path.join(__dirname, relative), 'utf8'), content, `${relative} is current (run node tools/gen-spec-kit-assets.cjs)`);
    if (relative.endsWith('SKILL.md')) {
        const folder = path.basename(path.dirname(relative));
        assert.match(content, new RegExp(`^---\\nname: ${folder}\\n`), `${relative}: name matches its folder`);
        assert.match(content, /disable-model-invocation: true/);
        assert.doesNotMatch(content, /^agent:/m, 'prompt-only frontmatter is dropped');
        assert.match(content, /^# \/sk\./m, 'the command body is kept');
    }
}
assert.ok(!/^(skills|prompts)\b/m.test(fs.readFileSync(path.join(__dirname, '.vscodeignore'), 'utf8')), 'packaging does not exclude skills or prompts');

(async () => {
    // Legacy copies written by an earlier version are removed; the reviewer's other skills and prompts stay.
    const targets = { promptsDir: path.join(tmp, 'prompts'), copilotHome: path.join(tmp, '.copilot') };
    fs.mkdirSync(targets.promptsDir, { recursive: true });
    fs.writeFileSync(path.join(targets.promptsDir, 'sk.plan.prompt.md'), 'old');
    fs.writeFileSync(path.join(targets.promptsDir, 'mine.prompt.md'), 'mine');
    fs.mkdirSync(path.join(targets.copilotHome, 'skills', 'sk-check'), { recursive: true });
    fs.writeFileSync(path.join(targets.copilotHome, 'skills', 'sk-check', 'SKILL.md'), 'stale migrated copy');
    fs.mkdirSync(path.join(targets.copilotHome, 'skills', 'mine'), { recursive: true });
    fs.writeFileSync(path.join(targets.copilotHome, 'skills', 'mine', 'SKILL.md'), 'reviewer skill');
    assert.equal(await install.removeLegacySpecKitCopies(targets), 2);
    assert.ok(!fs.existsSync(path.join(targets.promptsDir, 'sk.plan.prompt.md')));
    assert.ok(!fs.existsSync(path.join(targets.copilotHome, 'skills', 'sk-check')));
    assert.equal(fs.readFileSync(path.join(targets.copilotHome, 'skills', 'mine', 'SKILL.md'), 'utf8'), 'reviewer skill');
    assert.equal(fs.readFileSync(path.join(targets.promptsDir, 'mine.prompt.md'), 'utf8'), 'mine');
    assert.equal(await install.removeLegacySpecKitCopies(targets), 0, 'second run removes nothing');

    const claudeHome = path.join(tmp, '.claude');
    const claude = await install.installClaudeSpecKitCommands(claudeHome);
    assert.equal(claude.claudeCommands, Object.keys(assets.CLAUDE_SPEC_KIT_COMMANDS).length);
    for (const name of Object.keys(assets.CLAUDE_SPEC_KIT_COMMANDS)) {
        assert.ok(fs.existsSync(path.join(claudeHome, 'commands', name)), `${name} installed for Claude Code`);
    }
    assert.equal((await install.installClaudeSpecKitCommands(claudeHome)).claudeCommands, 0, 'second activation writes nothing');

    // The Copilot copy of the build agent gains the shipped tools it lacks, and nothing else changes.
    const before = '---\nname: "AskAway Build"\ntools: [execute, intuitiv.askaway/memory2]\n---\nBody\n';
    const after = agent.addMissingAskAwayTools(before, ['memory2', 'asks', 'worker']);
    assert.match(after, /^tools: \[execute, intuitiv\.askaway\/memory2, intuitiv\.askaway\/asks, intuitiv\.askaway\/worker\]$/m);
    assert.ok(after.endsWith('---\nBody\n'));
    assert.equal(agent.addMissingAskAwayTools(after, ['memory2', 'asks', 'worker']), after, 'idempotent');

    console.log('PASS EV-COPILOT-HARNESS hooksFailOpen=true sandboxGrants=true skContributed=true');
})().catch((error) => { console.error(error); process.exit(1); });
