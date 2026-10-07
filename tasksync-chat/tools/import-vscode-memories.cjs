const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { fileURLToPath } = require('node:url');
const esbuild = require('esbuild');
const repo = path.resolve(__dirname, '../..');

function load(file) {
    const output = esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../src/validator', file)],
        bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, require, process, console,
        fetch, URL, AbortSignal, Date, Buffer });
    return module.exports;
}

function inventory(root) {
    const files = [], found = { user: 0, repo: 0, session: 0 };
    const directories = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : [];
    function visit(dir, kind, workspace, sessionId) {
        for (const entry of directories(dir)) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(file, kind, workspace, sessionId);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                found[kind]++;
                files.push({ file, kind, workspace, sessionId, scope: { project: kind === 'user' ? '_user' : workspace,
                    agentId: 'agents', ...(kind === 'session' ? { spec: `session:${sessionId}` } : {}) } });
            }
        }
    }
    visit(path.join(root, 'globalStorage/github.copilot-chat/memory-tool/memories'), 'user');
    const storage = path.join(root, 'workspaceStorage');
    for (const entry of directories(storage)) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(storage, entry.name);
        let workspace = entry.name;
        try {
            const mapping = JSON.parse(fs.readFileSync(path.join(directory, 'workspace.json'), 'utf8'));
            const uri = mapping.folder || mapping.workspace;
            if (typeof uri === 'string') workspace = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
        } catch { /* Unknown mappings still belong to their workspace hash. */ }
        const memories = path.join(directory, 'GitHub.copilot-chat/memory-tool/memories');
        for (const child of directories(memories)) {
            if (child.isDirectory()) {
                visit(path.join(memories, child.name), child.name === 'repo' ? 'repo' : 'session', workspace,
                    child.name === 'repo' ? undefined : Buffer.from(child.name, 'base64').toString('utf8'));
            } else if (child.isFile() && child.name.toLowerCase().endsWith('.md')) {
                // Legacy root memories are workspace-scoped, never omitted.
                found.repo++;
                files.push({ file: path.join(memories, child.name), kind: 'repo', workspace,
                    scope: { project: workspace, agentId: 'agents' } });
            }
        }
    }
    return { files, found };
}

async function run(args = process.argv.slice(2), dependencies = {}) {
    let root = path.join(os.homedir(), 'Library/Application Support/Code/User'), dryRun = false, reportPath;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') dryRun = true;
        else if (['--root', '--report'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
            const flag = args[i++];
            if (flag === '--root') root = path.resolve(args[i]); else reportPath = path.resolve(args[i]);
        } else throw new Error('Expected --dry-run, --root <directory>, or --report <path inside repo>');
    }
    if (reportPath) {
        const relative = path.relative(repo, reportPath);
        const parent = fs.realpathSync(path.dirname(reportPath));
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
            path.relative(repo, parent).startsWith('..') || fs.existsSync(reportPath) && fs.lstatSync(reportPath).isSymbolicLink()) {
            throw new Error('Report must be inside repo, with an existing parent and no symlink destination');
        }
    }
    if (!fs.statSync(root).isDirectory()) throw new Error('Memory root must be a directory');
    const { files, found } = inventory(root);
    if (reportPath && (files.some(item => item.file === reportPath) || path.relative(root, reportPath).split(path.sep)[0] !== '..')) {
        throw new Error('Report must not overwrite the read-only source tree');
    }
    let store;
    if (!dryRun) {
        if (dependencies.store) store = dependencies.store;
        else {
            const { ensureMemoryServer, MEMORY_SERVER_URL, localMemorySecret } = load('memoryServer.ts');
            const secret = localMemorySecret();
            await ensureMemoryServer(undefined, secret);
            const { AgentmemoryStore } = load('agentmemoryStore.ts');
            store = new AgentmemoryStore(repo, MEMORY_SERVER_URL, secret);
        }
    }
    const report = { dryRun, filesFound: found, files, ...await load('memorySeed.ts').importMemoryFiles(store, files) };
    if (reportPath && !dryRun) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    (dependencies.log || console.log)(JSON.stringify(report));
    return report;
}
module.exports = { run };
if (require.main === module) run().catch((error) => { console.error(`Memory import failed: ${error && error.message ? error.message : error}`); process.exitCode = 1; });
