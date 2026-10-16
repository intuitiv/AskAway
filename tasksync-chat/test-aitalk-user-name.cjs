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
    const { aitalkUserName, aitalkUserPhoto, gitGlobalUserName } = mod.exports;
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
        assert.equal(aitalkUserPhoto('', workspaces[0], home), '', 'missing photo retains initials');
        const profileDir = path.join(home, '.askaway', 'profile');
        fs.mkdirSync(profileDir, { recursive: true });
        const avatar = path.join(profileDir, 'avatar.png');
        const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
        fs.writeFileSync(avatar, image);
        const photo = 'data:image/png;base64,' + image.toString('base64');
        assert.deepEqual(workspaces.map(dir => aitalkUserPhoto('', dir, home)), [photo, photo]);
        const photoHeader = render.headerPresenceHtml({ presence: { name: 'Morgan', photo: aitalkUserPhoto('', workspaces[0], home) } });
        assert.ok(photoHeader.includes('<img src="' + photo + '" alt="">'), 'external photo renders as an image instead of initials');
        assert.doesNotMatch(photoHeader, /presence-avatar" aria-hidden="true">M<\/span>/);
        assert.equal(aitalkUserPhoto('~/.askaway/profile/avatar.png', workspaces[0], home), photo);
        assert.equal(aitalkUserPhoto('https://example.test/photo.jpg', workspaces[0], home), 'https://example.test/photo.jpg');
        const override = path.join(workspaces[0], 'custom.jpg');
        fs.writeFileSync(override, 'custom fixture');
        assert.equal(aitalkUserPhoto('custom.jpg', workspaces[0], home), 'data:image/jpeg;base64,' + Buffer.from('custom fixture').toString('base64'));
        assert.equal(aitalkUserPhoto('missing.png', workspaces[0], home), '');
        assert.deepEqual(fs.readdirSync(workspaces[1]).sort(), ['.git'], 'reading the shared photo must not copy it into a workspace');
        assert.match(provider, /aitalkUserPhoto\(config\.get<string>\('userPhoto', ''\), root\)/);
        console.log('PASS EV-AITALK-USER-PHOTO shared external avatar in two workspaces; explicit override; missing-file fallback; no workspace copy');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
