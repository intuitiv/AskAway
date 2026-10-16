const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
module.exports = function transpile(buildDir, rel) {
    const out = path.join(buildDir, rel.replace(/\.ts$/, '.js'));
    if (fs.existsSync(out)) return;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(out, js);
    for (const [, spec] of js.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
        const next = path.join(path.dirname(rel), spec);
        if (fs.existsSync(path.join(__dirname, 'src', `${next}.ts`))) transpile(buildDir, `${next}.ts`);
        else if (fs.existsSync(path.join(__dirname, 'src', next, 'index.ts'))) transpile(buildDir, path.join(next, 'index.ts'));
    }
};
