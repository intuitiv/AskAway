'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const block = source.slice(source.indexOf("            case 'openAgentFile':"), source.indexOf("            case 'setRuntimeEnabled':"));
const code = ts.transpileModule(`async function receive(message) { switch(message.type) { ${block} } }`, { compilerOptions: { target: 9 } }).outputText;
const prompts = '/home/test/Code/User/prompts';
const files = new Set(['/workspace/.github/agents/build.agent.md', '/home/test/.askaway/worker-profiles/build.md', '/outside/escape.md', `${prompts}/askaway-build.agent.md`, '/ext/worker-profiles/build-lite.md']);
const opened = [];
const receiveFn = vm.runInNewContext(code + ';receive', { path, os: { homedir: () => '/home/test' }, fs: { existsSync: file => files.has(file) || ['/workspace', '/home/test/.askaway/worker-profiles', prompts, '/ext/worker-profiles'].includes(file), realpathSync: file => file, statSync: () => ({ isFile: () => true }) }, vscode: { Uri: { file: file => file }, Range: class { constructor(...args) { this.args = args; } }, workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], openTextDocument: async file => file }, window: { showTextDocument: async (file, options) => opened.push({ file, options }) } } });
// The provider instance: only its VS Code user prompts folder is read by this handler.
const receive = message => receiveFn.call({ _userPromptsDir: () => prompts, _extensionUri: { fsPath: '/ext' } }, message);
(async () => {
    await receive({ type: 'openAgentFile', path: '.github/agents/build.agent.md', profile: 'build' });
    assert.equal(opened.at(-1).file, '/workspace/.github/agents/build.agent.md');
    assert.equal(opened.at(-1).options.selection.args.join(','), '0,0,0,0');
    await receive({ type: 'openAgentFile', path: '../../outside/escape.md' });
    assert.equal(opened.length, 1);
    await receive({ type: 'openAgentFile', path: 'missing.md', profile: 'build' });
    assert.equal(opened.at(-1).file, '/home/test/.askaway/worker-profiles/build.md');
    // Reviewer 2026-10-16 item 10: the main agent row (no worker profile) opens the AskAway Build chat agent's own file.
    await receive({ type: 'openAgentFile', path: `${prompts}/askaway-build.agent.md`, profile: '' });
    assert.equal(opened.at(-1).file, `${prompts}/askaway-build.agent.md`);
    // A built-in profile (shipped in the extension) opens from the extension's worker-profiles folder.
    await receive({ type: 'openAgentFile', path: '.github/agents/build-lite.agent.md', profile: 'build-lite' });
    assert.equal(opened.at(-1).file, '/ext/worker-profiles/build-lite.md');
    // Edit is the member's profile form (R-TEAM-48): the host never opens a file for it.
    const before = opened.length;
    await receive({ type: 'editTeamMember', path: '.github/agents/askaway-build.agent.md', profile: '' });
    assert.equal(opened.length, before, 'Edit never opens a file');
    console.log('PASS EV-TEAM-ACTIONS agent link opens allowed files at the top; Edit opens no file; main agent opens its chat agent file; traversal refused');
})().catch(error => { console.error(error); process.exitCode = 1; });
