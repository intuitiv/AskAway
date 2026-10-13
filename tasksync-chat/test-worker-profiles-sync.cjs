const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const home = fs.mkdtempSync(path.join(build, 'profiles-home-'));
const load = name => {
    const exports = {};
    new Function('require', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, exports);
    return exports;
};
const profiles = load('workers/workerProfiles.ts');
const user = path.join(home, '.config/opencode/agents');
const workspace = path.join(home, 'workspace/.opencode/agents');
fs.mkdirSync(workspace, { recursive: true });
const fixtures = ['validator', 'build'].map(name => ({ name, description: name, model: 'fixture/model', steps: 5, tier: 'mid', prompt: 'Fixture prompt', mcp: [], skills: [], permissions: {} }));
for (const profile of fixtures) fs.writeFileSync(path.join(workspace, `aa-${profile.name}.md`), profiles.toOpenCodeAgent(profile));
fs.writeFileSync(path.join(workspace, 'aa-user.md'), 'User-owned agent');
fs.writeFileSync(path.join(workspace, 'custom.md'), 'User custom agent');
const written = profiles.syncOpenCodeAgents(fixtures, user, workspace);
assert.equal(written.length, 2);
for (const profile of fixtures) {
    assert.ok(fs.existsSync(path.join(user, `aa-${profile.name}.md`)));
    assert.equal(fs.existsSync(path.join(workspace, `aa-${profile.name}.md`)), false);
}
assert.equal(fs.readFileSync(path.join(workspace, 'aa-user.md'), 'utf8'), 'User-owned agent');
assert.equal(fs.readFileSync(path.join(workspace, 'custom.md'), 'utf8'), 'User custom agent');
profiles.syncOpenCodeAgents(fixtures, user, workspace);
const extension = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
assert.match(extension, /syncOpenCodeAgents\(\[profile\], path.join\(os.homedir\(\), '\.config', 'opencode', 'agents'\)/);
console.log('PASS worker profiles sync: validator/build global agents; generated workspace agents removed; user files preserved; repeated sync safe');
