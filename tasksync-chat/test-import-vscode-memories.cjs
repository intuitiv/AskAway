const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { run } = require('./tools/import-vscode-memories.cjs');
const root = path.join(__dirname, 'test-fixtures/vscode-memories');
function snapshot(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? snapshot(file) : [[file, fs.readFileSync(file)]];
    });
}
(async () => {
    const before = snapshot(root), index = [];
    const store = {
        export: async () => index,
        remember: async (fact, scope) => {
            const item = { id: `fact-${index.length}`, fact, scope, rootId: `fact-${index.length}`, ts: 1 };
            index.push(item);
            return item;
        },
    };
    const logs = [];
    const options = { store, log: text => logs.push(text) };
    const dry = JSON.parse(execFileSync(process.execPath,
        ['tasksync-chat/tools/import-vscode-memories.cjs', '--root', root, '--dry-run'],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
    assert.deepEqual(dry.filesFound, { user: 4, repo: 3, session: 1 });
    assert.equal(dry.factsStored, 0);
    const first = await run(['--root', root], options);
    const found = Object.values(first.filesFound).reduce((sum, count) => sum + count, 0);
    assert.equal(found, before.filter(([file]) => file.endsWith('.md')).length);
    assert.equal(first.filesImported, found);
    assert.equal(first.factsPlanned, first.factsStored + first.merged + first.refused.length);
    assert.equal(first.factsStored, 9);
    assert.equal(first.merged, 1);
    assert.equal(first.refused.length, 1);
    assert.match(first.refused[0].from, /secret\.md:2$/);
    assert.match(first.refused[0].reason, /secret gate/);
    assert.equal(dry.factsPlanned, first.factsPlanned);
    for (const file of first.files) {
        assert.ok(first.items.some(item => item.from.startsWith(file.file + ':')));
        for (const item of first.items.filter(item => item.from.startsWith(file.file + ':') && item.status !== 'refused')) {
            const stored = index.find(row => row.id === item.id);
            assert.ok(stored);
            assert.deepEqual(stored.scope, file.scope);
        }
    }
    assert.ok(index.every(item => /\.md:\d+$/.test(item.fact.from)));
    assert.ok(index.some(item => item.scope.project === '_user' && item.scope.agentId === 'agents'));
    assert.ok(index.some(item => item.scope.project === '/fixture/project-alpha' && !item.scope.spec));
    assert.ok(index.some(item => item.scope.project === '/fixture/project-beta.code-workspace'));
    assert.ok(index.some(item => item.scope.project === 'unknown'));
    assert.ok(index.some(item => item.scope.project === '/fixture/project-alpha' && item.scope.spec === 'session:session-1'));
    assert.equal(first.files.find(file => file.kind === 'session').sessionId, 'session-1');
    assert.equal(index.find(item => item.fact.from.endsWith('plain.md:1')).fact.text,
        fs.readFileSync(path.join(root, 'globalStorage/github.copilot-chat/memory-tool/memories/plain.md'), 'utf8'));
    assert.ok(index.some(item => item.fact.text.includes('Preserve this fenced example too.')));
    const second = await run(['--root', root], options);
    assert.equal(second.factsStored, 0);
    assert.equal(second.merged, first.factsStored + first.merged);
    assert.equal(second.refused.length, 1);
    assert.equal(index.length, first.factsStored);
    assert.deepEqual(snapshot(root), before);
    assert.ok(!logs.join('\n').includes('ghp_' + 'a'.repeat(36)));
    await assert.rejects(run(['--root', root, '--report', path.join(root, 'new-report.json')], options), /read-only/);
    await assert.rejects(run(['--root', root, '--report', path.resolve(__dirname, '../../outside.json')], options), /inside repo/);
    assert.match(require('./package.json').scripts['pretest:workers'], /test-import-vscode-memories\.cjs/);
    console.log('PASS EV-IMPORT-VSCODE-MEMORIES: every file, scoped keys, provenance, reconciled counts, zero-new rerun, byte-identical sources, visible secret refusals');
})().catch(error => { console.error(error); process.exitCode = 1; });
