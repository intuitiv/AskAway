// Caller view: AITalk's avatar name comes from user-level sources only, identical in every workspace (2026-10-14).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
(async () => {
    const source = fs.readFileSync(path.join(__dirname, 'src/aitalk/userName.ts'), 'utf8');
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(require, mod, mod.exports);
    const { aitalkUserName, gitGlobalUserName } = mod.exports;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-aitalk-name-'));
    try {
        const home = path.join(temp, 'home'); fs.mkdirSync(home);
        const gitconfig = path.join(home, '.gitconfig');
        const env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: gitconfig, XDG_CONFIG_HOME: path.join(home, '.config') };
        const workspaces = [['ws-m', 'Morgan Local'], ['ws-y', 'You Elsewhere']].map(([name, local]) => {
            const dir = path.join(temp, name); fs.mkdirSync(dir);
            execFileSync('git', ['init', '-q'], { cwd: dir, env });
            execFileSync('git', ['config', 'user.name', local], { cwd: dir, env });
            return dir;
        });
        const nameIn = (dir, configured) => aitalkUserName(configured, () => gitGlobalUserName(dir, env), () => 'osaccount');
        // No global name yet: both workspaces fall back to the OS account, never their local repo names.
        assert.deepEqual(await Promise.all(workspaces.map(dir => nameIn(dir))), ['osaccount', 'osaccount']);
        execFileSync('git', ['config', '--global', 'user.name', 'Sam Morgan'], { cwd: home, env });
        assert.deepEqual(await Promise.all(workspaces.map(dir => nameIn(dir))), ['Sam Morgan', 'Sam Morgan'], 'global git name, same in both workspaces');
        assert.deepEqual(await Promise.all(workspaces.map(dir => nameIn(dir, 'Alex Kim'))), ['Alex Kim', 'Alex Kim'], 'user setting wins');
        const render = await import('./media/aitalk/talkRender.js');
        const initials = await Promise.all(workspaces.map(async dir => render.headerPresenceHtml({ members: [], presence: { name: await nameIn(dir) } }).match(/presence-avatar" aria-hidden="true">(\w+)</)[1]));
        assert.deepEqual(initials, ['SM', 'SM']);
        const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
        assert.match(provider, /aitalkUserName\(config\.get<string>\('userName', ''\), \(\) => gitGlobalUserName\(root\)\)/);
        assert.doesNotMatch(provider, /getConfig\('user\.name'\)/, 'workspace repo config is not read');
        const setting = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).contributes.configuration;
        const props = Object.assign({}, ...[].concat(setting).map(item => item.properties || {}));
        assert.equal(props['askaway.aitalk.userName'].scope, 'application');
        console.log('PASS EV-AITALK-USER-NAME user setting → global git → OS account; identical initials in two workspaces with different local git names');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
