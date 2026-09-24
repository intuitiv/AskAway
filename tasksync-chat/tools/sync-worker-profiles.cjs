// Regenerates OpenCode worker agents from ~/.askaway/worker-profiles and links rule-authoring skills.
// Run: node tools/sync-worker-profiles.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'));

const home = os.homedir();
const profileDir = process.env.ASKAWAY_WORKER_PROFILES || path.join(home, '.askaway', 'worker-profiles');
const opencodeDir = process.env.OPENCODE_CONFIG_DIR || path.join(home, '.config', 'opencode');
// The generated bundle is complete; schema-skills/template lacks the generated rule-schema and expressions companions.
const skillSource = process.env.ASKAWAY_AUTHORING_SKILLS
    || path.join(home, 'VSProjects', 'vibecoding', 'build', 'skills-bundle');

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-sync-profiles-'));
fs.writeFileSync(
    path.join(buildDir, 'workerProfiles.js'),
    ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', 'workers', 'workerProfiles.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
);
const { loadWorkerProfiles, syncOpenCodeAgents } = require(path.join(buildDir, 'workerProfiles.js'));
fs.rmSync(buildDir, { recursive: true, force: true });

const profiles = loadWorkerProfiles(profileDir);
const agents = syncOpenCodeAgents(profiles, path.join(opencodeDir, 'agents'));

let linked = 0;
if (fs.existsSync(skillSource)) {
    const skillsDir = path.join(opencodeDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    for (const name of fs.readdirSync(skillSource)) {
        const source = path.join(skillSource, name);
        if (!fs.existsSync(path.join(source, 'SKILL.md'))) { continue; }
        const target = path.join(skillsDir, name);
        if (fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink()) { continue; }
        fs.rmSync(target, { force: true });
        fs.symlinkSync(source, target);
        linked++;
    }
}

console.log(`SYNCED agents=${agents.length} [${profiles.map((p) => `aa-${p.name}`).join(', ')}] skillsLinked=${linked}`);
