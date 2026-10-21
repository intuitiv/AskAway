// EV-WORKER-PROFILES-LIST: the worker tool's `profiles` action returns the enabled profiles, built-in and the user's own,
// with Team member and role (reviewer, 2026-10-16: "workers or some tool ... should send active(or enabled) profile details.").
// devx and authoring are the reviewer's own profiles and never ship; build (high) and build-lite (low) do.
// Run: node test-worker-profiles-list.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-profiles-list-build-'));
const src = path.join(__dirname, 'src');
function transpile(rel) {
    const out = path.join(buildDir, rel.replace(/\.ts$/, '.js'));
    if (fs.existsSync(out)) { return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(path.join(src, rel), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(out, js);
    for (const [, spec] of js.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
        const next = path.join(path.dirname(rel), spec);
        if (fs.existsSync(path.join(src, `${next}.ts`))) { transpile(`${next}.ts`); }
        else if (fs.existsSync(path.join(src, next, 'index.ts'))) { transpile(path.join(next, 'index.ts')); }
    }
}
transpile('workers/workerTools.ts');
const { workerTool, setWorkerProfileCatalog } = require(path.join(buildDir, 'workers', 'workerTools.js'));

const builtinDir = path.join(__dirname, 'worker-profiles');
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-profiles-list-user-'));
const profile = (name, model, extra = '') => `---\nname: ${name}\ndescription: "${name}"\ntier: mid\nmodel: ${model}\nthinking: high\nmodels: [${model}]\nthinkingOptions: [high]\n${extra}---\n${name}.\n`;
fs.writeFileSync(path.join(userDir, 'devx.md'), profile('devx', 'github-copilot/gpt-6.1-sol', 'member: Dev Expert\nrole: DevX Engineer\n'));
fs.writeFileSync(path.join(userDir, 'explore.md'), profile('explore', 'github-copilot/gpt-6-luna'));
fs.writeFileSync(path.join(userDir, 'gemini.md'), profile('gemini', 'agy/gemini-4-argon-high'));

(async () => {
    const call = (input) => workerTool(() => { throw new Error('profiles never starts a runtime'); }, '/ws').run(input);

    // Without a catalog the host says so, never an empty "no profiles".
    setWorkerProfileCatalog(undefined);
    assert.equal((await call({ action: 'profiles' })).status, 'PROFILES_UNAVAILABLE');

    // Built-in + user profiles, with Team members from the roster (user `member:`/`role:` frontmatter included).
    const enabled = { opencode: true, agy: false, claude: false };
    setWorkerProfileCatalog({ builtinDir, userDir, enabled: (runtime) => enabled[runtime] });
    const listed = await call({ action: 'profiles' });
    const by = Object.fromEntries(listed.map((entry) => [entry.profile, entry]));
    assert.deepEqual(by.build, { profile: 'build', member: 'Anika', role: by.build.role, model: 'github-copilot/claude-sonnet-5.5', thinking: 'high', runtime: 'opencode', source: 'builtin' });
    assert.deepEqual([by['build-lite'].model, by['build-lite'].thinking, by['build-lite'].source], ['github-copilot/gpt-6.1-sol', 'medium', 'builtin']);
    assert.deepEqual([by.devx.member, by.devx.role, by.devx.source], ['Dev Expert', 'DevX Engineer', 'user']);
    assert.deepEqual([by.explore.member, by.explore.source], ['Sana', 'user']);
    // An agy-default profile runs on the interim Sol default (R-WTOOL-40), so it is listed under OpenCode.
    assert.deepEqual([by.gemini.model, by.gemini.runtime], ['github-copilot/gpt-6.1-sol', 'opencode']);
    console.log('EV-WORKER-PROFILES-LIST built-in and user profiles with members: PASS');

    // build and build-lite share one tool policy; only model and thinking differ.
    const { parseWorkerProfile } = require(path.join(buildDir, 'workers', 'workerProfiles.js'));
    const read = (name) => parseWorkerProfile(fs.readFileSync(path.join(builtinDir, `${name}.md`), 'utf8'));
    const policy = ({ edit, bash, webfetch, mcp, skills, steps }) => ({ edit, bash, webfetch, mcp, skills, steps });
    // Reviewer 2026-10-21: the Developer (build-lite) also gets the Grafana MCP tools; nothing else differs.
    const lite = policy(read('build-lite'));
    assert.deepEqual(lite.mcp.filter((tool) => tool !== 'grafana_*'), read('build').mcp);
    assert.ok(lite.mcp.includes('grafana_*'));
    assert.deepEqual({ ...lite, mcp: [] }, { ...policy(read('build')), mcp: [] });
    console.log('EV-WORKER-PROFILES-LIST build-lite shares build tool policy: PASS');

    // A user file overrides the shipped one of the same name and keeps source builtin.
    fs.writeFileSync(path.join(userDir, 'build.md'), profile('build', 'github-copilot/claude-sonnet-5.5'));
    const overridden = (await call({ action: 'profiles' })).find((entry) => entry.profile === 'build');
    assert.deepEqual([overridden.model, overridden.source], ['github-copilot/claude-sonnet-5.5', 'builtin']);

    // Only enabled profiles: with OpenCode off nothing that runs on OpenCode is listed.
    enabled.opencode = false;
    enabled.agy = true;
    assert.deepEqual(await call({ action: 'profiles' }), []);
    console.log('EV-WORKER-PROFILES-LIST only enabled profiles: PASS');

    // devx and authoring never ship: no built-in file and no hard-coded mode list in the tool or its manifest.
    const shipped = fs.readdirSync(builtinDir).map((file) => file.replace(/\.md$/, ''));
    assert.ok(!shipped.includes('devx') && !shipped.includes('authoring'), shipped.join(','));
    const tool = workerTool(() => null, '');
    const pkg = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    for (const text of [JSON.stringify(require('zod-to-json-schema').zodToJsonSchema(tool.inputSchema)), tool.description, pkg]) {
        assert.ok(!/\b(devx|authoring)\b/.test(text), 'no devx/authoring in the worker tool contract or package.json');
    }
    console.log('EV-WORKER-PROFILES-LIST devx/authoring not shipped: PASS');
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
})().catch((error) => { console.error(error); process.exit(1); });
