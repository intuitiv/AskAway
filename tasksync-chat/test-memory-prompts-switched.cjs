const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const src = path.join(__dirname, 'src');
const templateFile = path.join(src, 'agents', 'askawayBuildAgent.ts');
const compiled = ts.transpileModule(fs.readFileSync(templateFile, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
const voiceExports = {};
const voiceCompiled = ts.transpileModule(fs.readFileSync(path.join(src, 'agents', 'sharedVoice.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(voiceCompiled, { exports: voiceExports });
vm.runInNewContext(compiled, { exports: exported, require: name => {
    assert.equal(name, './sharedVoice', 'Build template imports only its dependency-free voice module');
    return voiceExports;
} });
const template = exported.ASKWAY_BUILD_AGENT_CONTENT;
assert.ok(template.includes(voiceExports.SHARED_VOICE), 'evaluate the real shared voice import, not a mock string');
assert.equal(exported.ASKWAY_BUILD_AGENT_FILE, 'askaway-build.agent.md');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const memory = pkg.contributes.languageModelTools.find(tool => tool.name === 'askaway_memory');
const memoryRef = `${pkg.publisher}.${pkg.name}/${memory.toolReferenceName}`;
const tools = /^tools: \[(.*)\]$/m.exec(template)[1].split(',').map(tool => tool.trim());
assert.ok(tools.includes(memoryRef), 'shipped Build agent enables the registered AskAway memory tool');
assert.match(template, /At session start, use `search`/);
assert.match(template, /WRITE AFTER substantial work.*`remember`/);
assert.doesNotMatch(template, /\/memories|vscode\/(?:memory|resolveMemoryFileUri)/);

let checked = 0;
function checkSources(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { checkSources(file); continue; }
        if (!/\.(ts|js|md)$/.test(entry.name)) continue;
        const relative = path.relative(src, file).split(path.sep).join('/');
        if (['validator/memorySeed.ts', 'memory/memoryStore.ts'].includes(relative)) continue;
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\/memories|vscode\/(?:memory|resolveMemoryFileUri)/,
            `${relative}: shipped source must not direct agents to VS Code memory`);
        checked++;
    }
}
checkSources(src);
assert.ok(checked > 0, 'source scan matched shipped files');
const extension = fs.readFileSync(path.join(src, 'extension.ts'), 'utf8');
assert.match(extension, /import \{ ASKWAY_BUILD_AGENT_FILE, ASKWAY_BUILD_AGENT_CONTENT \} from '\.\/agents\/askawayBuildAgent'/);
assert.match(extension, /writeFile\(agentPath, ASKWAY_BUILD_AGENT_CONTENT, 'utf8'\)/, 'installer consumes the tested template');
assert.ok(pkg.scripts['test:workers'].includes('node test-memory-prompts-switched.cjs'));
console.log(`PASS EV-MEMORY-PROMPTS-SWITCHED files=${checked} tool=${memoryRef}`);
