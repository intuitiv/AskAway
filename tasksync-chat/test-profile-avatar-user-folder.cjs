const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

if (process.argv[2] === '--probe') {
    const { aitalkUserPhoto } = require(process.argv[3]);
    process.stdout.write(JSON.stringify(aitalkUserPhoto('', process.argv[4])));
} else {
    try {
        const root = fs.mkdtempSync(path.join(__dirname, 'build/profile-avatar-'));
        const home = path.join(root, 'home');
        const avatar = path.join(home, '.askaway/profile/avatar.png');
        fs.mkdirSync(path.dirname(avatar), { recursive: true });
        const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
        fs.writeFileSync(avatar, image);
        const expected = 'data:image/png;base64,' + image.toString('base64');
        const source = fs.readFileSync(path.join(__dirname, 'src/aitalk/userName.ts'), 'utf8');
        const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
        const workspaces = ['workspace-one', 'workspace-two'].map(name => {
            const folder = path.join(root, name);
            fs.mkdirSync(folder);
            return folder;
        });
        for (const version of ['1.0.0', '2.0.0']) {
            const extension = path.join(root, 'extensions', `intuitiv.askaway-${version}`);
            fs.mkdirSync(extension, { recursive: true });
            const modulePath = path.join(extension, 'userName.cjs');
            fs.writeFileSync(modulePath, compiled);
            for (const workspace of workspaces) {
                const result = spawnSync(process.execPath, [__filename, '--probe', modulePath, workspace], {
                    cwd: extension, env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000,
                });
                assert.equal(result.status, 0, `avatar reader exits successfully for ${version}`);
                assert.equal(JSON.parse(result.stdout), expected, `user-folder photo resolves in ${path.basename(workspace)} after installing ${version}`);
                assert.deepEqual(fs.readdirSync(workspace), [], 'lookup never copies the user photo into a workspace');
            }
            assert.deepEqual(fs.readdirSync(extension), ['userName.cjs'], 'extension install contains code, not the user photo');
        }
        assert.deepEqual(fs.readFileSync(avatar), image, 'upgrade leaves the user-owned photo unchanged');
        const listing = spawnSync('npx', ['--no-install', 'vsce', 'ls'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        assert.equal(listing.status, 0, 'vsce package listing must succeed');
        const files = listing.stdout.split('\n').map(line => line.trim()).filter(Boolean);
        assert.ok(files.length > 0, 'package listing must not be empty');
        assert.ok(!files.some(file => /(^|\/)avatar\.png$/i.test(file)), 'package never ships the user avatar.png');
        assert.ok(!files.some(file => /(^|\/)(?:\.askaway|user-profile|profile|user-photos)(\/|$)|(?:^|\/)(?:user|reviewer|cpo)[-_]?(?:photo|avatar)\.(?:png|jpe?g|webp)$/i.test(file)), 'package never ships user profile/photo files');
        const portraits = ['anika', 'bhaskar', 'cathy', 'diego', 'paolo', 'pavel', 'priya', 'sana', 'shreya', 'tara'].map(id => `media/team/avatars/${id}.png`).sort();
        assert.deepEqual(files.filter(file => file.startsWith('media/team/avatars/')).sort(), portraits, 'only the ten public roster portraits ship in the avatar directory');
        console.log('PASS EV-PROFILE-AVATAR-USER-FOLDER matched=5 two workspaces x two extension versions; user photo preserved; package excludes user photos and ships ten roster portraits');
    } catch (error) {
        console.error(`${error.message}\n${error.stack?.split('\n').filter(line => line.includes(__filename)).slice(0, 3).join('\n')}`);
        process.exitCode = 1;
    }
}
