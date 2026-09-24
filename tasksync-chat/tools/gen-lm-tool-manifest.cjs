// Writes the package.json languageModelTools entries for the shared worker and commentary tool definitions.
// Run: node tools/gen-lm-tool-manifest.cjs          (update package.json)
//      node tools/gen-lm-tool-manifest.cjs --check  (exit 1 when package.json drifted from the definitions)
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const ts = require(path.join(root, 'node_modules', 'typescript'));
const { zodToJsonSchema } = require(path.join(root, 'node_modules', 'zod-to-json-schema'));

function loadDefinitions() {
    // Built inside the package so `zod` resolves from node_modules; layout mirrors src/.
    const buildDir = path.join(root, '.lm-manifest-build');
    fs.rmSync(buildDir, { recursive: true, force: true });
    const files = ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools', 'commentary/commentary'];
    for (const name of files) {
        const out = path.join(buildDir, `${name}.js`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(root, 'src', `${name}.ts`), 'utf8'),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
    }
    const { workerToolDefinitions } = require(path.join(buildDir, 'workers', 'workerTools.js'));
    const { commentaryToolDefinitions } = require(path.join(buildDir, 'commentary', 'commentary.js'));
    const unused = () => { throw new Error('manifest generation never runs tools'); };
    const definitions = [...workerToolDefinitions(unused, ''), ...commentaryToolDefinitions(unused, '')];
    fs.rmSync(buildDir, { recursive: true, force: true });
    return definitions;
}

function entryFor(definition) {
    const schema = zodToJsonSchema(definition.inputSchema, { target: 'jsonSchema7', $refStrategy: 'none' });
    delete schema.$schema;
    const words = definition.name.split('_');
    return {
        name: definition.name,
        tags: definition.name === 'commentary' ? ['askaway', 'commentary', 'orchestrator'] : ['askaway', 'workers', 'opencode', 'orchestrator'],
        toolReferenceName: words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join(''),
        displayName: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
        modelDescription: definition.description,
        canBeReferencedInPrompt: true,
        icon: definition.name === 'commentary' ? '$(comment-discussion)' : '$(server-process)',
        inputSchema: schema,
    };
}

function merged(pkg, entries) {
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const tools = pkg.contributes.languageModelTools.map((tool) => byName.get(tool.name) ?? tool);
    for (const entry of entries) {
        if (!tools.some((tool) => tool.name === entry.name)) { tools.push(entry); }
    }
    return tools;
}

const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const entries = loadDefinitions().map(entryFor);
const tools = merged(pkg, entries);
if (process.argv.includes('--check')) {
    const drift = entries.filter((entry) => JSON.stringify(pkg.contributes.languageModelTools.find((t) => t.name === entry.name)) !== JSON.stringify(entry));
    if (drift.length) {
        console.error(`LM-MANIFEST DRIFT: ${drift.map((e) => e.name).join(', ')} — run node tools/gen-lm-tool-manifest.cjs`);
        process.exit(1);
    }
    console.log(`LM-MANIFEST IN SYNC tools=${entries.length}`);
} else {
    pkg.contributes.languageModelTools = tools;
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`LM-MANIFEST WRITTEN tools=${entries.length} [${entries.map((e) => e.name).join(', ')}]`);
}
