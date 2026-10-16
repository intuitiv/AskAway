const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function transpileSrc(outRoot, dirs = ['workers', 'team', 'aitalk']) {
    for (const dir of dirs) {
        const source = path.join(__dirname, '..', 'src', dir);
        const output = path.join(outRoot, dir);
        fs.mkdirSync(output, { recursive: true });
        for (const file of fs.readdirSync(source).filter((file) => file.endsWith('.ts'))) {
            fs.writeFileSync(path.join(output, file.replace(/\.ts$/, '.js')), ts.transpileModule(
                fs.readFileSync(path.join(source, file), 'utf8'),
                { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
        }
    }
    return outRoot;
}

module.exports = { transpileSrc };
