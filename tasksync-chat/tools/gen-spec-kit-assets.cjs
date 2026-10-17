// Writes the /sk.* prompt files and /sk-* skills that package.json contributes (chatPromptFiles, chatSkills)
// from src/specs/specKitPromptAssets.ts, and prints the package.json entries. Run: node tools/gen-spec-kit-assets.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadModule(relative) {
    const root = path.join(__dirname, '..');
    const output = esbuild.buildSync({ entryPoints: [path.join(root, relative)], bundle: true,
        platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, require, __dirname: root });
    return module.exports;
}

function generated() {
    const { contributedSpecKitFiles } = loadModule('src/specs/specKitInstall.ts');
    return contributedSpecKitFiles();
}

if (require.main === module) {
    const root = path.join(__dirname, '..');
    for (const [relative, content] of Object.entries(generated())) {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
    }
    const files = Object.keys(generated());
    console.log(JSON.stringify({
        chatSkills: files.filter((f) => f.endsWith('SKILL.md')).map((p) => ({ path: `./${p}` })),
        chatPromptFiles: files.filter((f) => f.endsWith('.prompt.md')).map((p) => ({ path: `./${p}` })),
    }, null, 2));
}

module.exports = { generated };
