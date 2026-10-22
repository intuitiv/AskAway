// 005 US7 (EV-READINESS-SURFACES, R-SKFLOW-13): the Specs tab, the Telegram /status text and the /pr-daily facts
// show the SAME readiness text (readinessLines) for one seeded spec; a PASS without evidence is BLOCKED on all three.
// Telegram is faked (no network). Run: node test-readiness-surfaces.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');

const repo = makeSampleRepo({ git: true });
const slug = '005-tasked';
const readiness = {
    checks: [
        { name: 'tests', status: 'PASS', evidence: 'npm test: 12 passed' },
        { name: 'lint', status: 'PASS' },
        { name: 'e2e', status: 'BLOCKED', reason: 'tool unavailable' }
    ],
    openFindings: ['flaky retry'],
    residualRisk: []
};
repo.write(`.askaway/specs/${slug}/runs/2026-10-01T10-00-00-000Z-aaaaaa.json`, JSON.stringify({
    v: 1, kind: 'chat', slug, command: '/sk.check', stageBefore: 'tasks', stageAfter: 'analyze',
    endedAt: '2026-10-01T10:00:00.000Z', readiness
}));
repo.write('.specify/feature.json', JSON.stringify({ feature_directory: `specs/${slug}` }));

// The one shared text, straight from readinessLines.
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-readiness-surfaces-'));
const ts = require('typescript');
for (const name of ['stages', 'runRecords', 'readiness']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const expected = require(path.join(buildDir, 'readiness.js')).readinessLines(readiness);
assert.ok(expected.includes('BLOCKED lint — no evidence'), 'seed: PASS without evidence is BLOCKED');
assert.ok(expected.includes('PASS tests (evidence: npm test: 12 passed)'));

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const unescapeHtml = (value) => value.replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
const text = (html) => unescapeHtml(html.replace(/<[^>]+>/g, '\n')).split('\n').map((l) => l.trim()).filter(Boolean);

async function main() {
    // Scanner output feeds every surface (the Specs tab gets it through the webview provider unchanged).
    const scanBuild = await esbuild.build({
        stdin: { contents: "export { scanSpecs } from './src/specs/specKitScanner';", resolveDir: __dirname, sourcefile: 'scan-entry.ts', loader: 'ts' },
        bundle: true, format: 'cjs', platform: 'node', write: false
    });
    const scanMod = { exports: {} };
    new Function('require', 'module', 'exports', scanBuild.outputFiles[0].text)(require, scanMod, scanMod.exports);
    const spec = scanMod.exports.scanSpecs(repo.root).specs.find((s) => s.slug === slug);

    // ── Surface 1: Specs tab render (media/webview.js) ──
    const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
    const block = webview.slice(webview.indexOf('function specAgo(ms)'), webview.indexOf('function onSpecsListClick(e)'));
    const listEl = { innerHTML: '' };
    const ctx = {
        specsState: { stalenessAvailable: true, specs: [{ ...spec, active: true }] },
        specsExpanded: { [slug]: true }, specsShowDone: false, specsShowAll: false, SPEC_STAGE_LABEL: {}, specsWorkExpanded: {},
        document: { getElementById: (id) => (id === 'specs-list' ? listEl : null) }, escapeHtml
    };
    vm.createContext(ctx);
    vm.runInContext(block, ctx);
    vm.runInContext('renderSpecs()', ctx);
    const tabLines = text(listEl.innerHTML);
    const tabStart = tabLines.indexOf(expected[0]);
    assert.ok(tabStart >= 0, 'Specs tab shows the readiness header');
    assert.deepEqual(tabLines.slice(tabStart, tabStart + expected.length), expected, 'Specs tab text is readinessLines');

    // ── Surface 2: Telegram status text (faked vscode, no network) ──
    const tgBuild = await esbuild.build({
        stdin: { contents: "export { TelegramService } from './src/services/telegramService';", resolveDir: __dirname, sourcefile: 'tg-entry.ts', loader: 'ts' },
        bundle: true, format: 'cjs', platform: 'node', write: false, external: ['zod'],
        plugins: [{
            name: 'vscode-stub',
            setup(builder) {
                builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
                builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                    loader: 'js',
                    contents: `module.exports = {
                        workspace: { name: 'TaskSync', workspaceFolders: [{ uri: { fsPath: ${JSON.stringify(repo.root)} } }],
                            getConfiguration() { return { get(key, fallback) { return fallback; } }; } },
                        commands: { async executeCommand() {} }, window: { showErrorMessage() {}, showWarningMessage() {} }, Uri: { file(v) { return { fsPath: v }; } },
                        EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
                    };`
                }));
            }
        }]
    });
    const tgMod = { exports: {} };
    new Function('require', 'module', 'exports', tgBuild.outputFiles[0].text)(require, tgMod, tgMod.exports);
    const telegram = new tgMod.exports.TelegramService();
    const statusLines = unescapeHtml(telegram.getConversationStatus()).split('\n');
    const tgStart = statusLines.indexOf(expected[0]);
    assert.ok(tgStart >= 0, 'Telegram status shows the readiness header');
    assert.deepEqual(statusLines.slice(tgStart, tgStart + expected.length), expected, 'Telegram status text is readinessLines');

    // ── Surface 3: /pr-daily facts (gh faked to fail; only git and the scanner matter) ──
    const run = spawnSync(process.execPath, [path.join(__dirname, 'tools', 'pr-daily-facts.cjs'), '--cwd', repo.root, '--no-fetch'],
        { encoding: 'utf8', env: { ...process.env, PR_DAILY_GH: '/usr/bin/false' } });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).readiness, expected, '/pr-daily readiness is readinessLines');

    console.log(`PASS EV-READINESS-SURFACES: one text on Specs tab, Telegram status and /pr-daily (${expected.length} lines); PASS without evidence is BLOCKED on all three`);
}

main().finally(() => { repo.cleanup(); fs.rmSync(buildDir, { recursive: true, force: true }); }).catch((error) => { console.error(error); process.exit(1); });
