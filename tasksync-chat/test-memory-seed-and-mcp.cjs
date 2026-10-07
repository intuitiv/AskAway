const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const fixture = path.join(__dirname, 'test-fixtures/memory-seed');
const before = ['user/preferences.md', 'repo/rules.md'].map(file => fs.readFileSync(path.join(fixture, file)));
const files = new Map();
const fakeFs = {
    ...fs,
    existsSync: file => files.has(file),
    mkdirSync: () => {},
    writeFileSync: (file, text) => { assert.equal(file, 'seed-marker'); files.set(file, text); },
    appendFileSync: (file, text) => files.set(file, (files.get(file) || '') + text),
    readFileSync: (file, encoding) => files.has(file) ? files.get(file) : fs.readFileSync(file, encoding),
};
const registered = new Map();
const vscode = { lm: { registerTool: (name, tool) => { registered.set(name, tool); return { dispose() {} }; } },
    LanguageModelToolResult: class { constructor(content) { this.content = content; } },
    LanguageModelTextPart: class { constructor(value) { this.value = value; } } };
function load(file) {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, URL, AbortSignal, console,
        require: name => name === 'fs' ? fakeFs : name === 'vscode' ? vscode : require(name),
        fetch: async (_url, options) => {
            const body = JSON.parse(options.body);
            if (_url.endsWith('/remember')) { index.push({ id: `item-${index.length}`, content: body.content }); return { ok: true, json: async () => index.at(-1) }; }
            return { ok: true, json: async () => ({ results: index }) };
        } });
    return module.exports;
}
const index = [];
(async () => {
    const { AgentmemoryStore } = load('src/validator/agentmemoryStore.ts');
    const { DedupKnowledgeStore } = load('src/validator/knowledgeStore.ts');
    const { seedMemories } = load('src/validator/memorySeed.ts');
    const { memoryTool } = load('src/validator/memoryTool.ts');
    const { registerLmToolDefinitions } = load('src/workers/lmTools.ts');
    const { registerToolDefinitions } = load('src/workers/workerTools.ts');
    const store = new DedupKnowledgeStore(new AgentmemoryStore('fixture-workspace', 'http://127.0.0.1:3111', ''));
    const options = { marker: 'seed-marker', sources: [
        { directory: path.join(fixture, 'user'), scope: { project: '_user', agentId: 'agents' } },
        { directory: path.join(fixture, 'repo'), scope: { project: 'TaskSync', agentId: 'agents' } },
    ] };
    await seedMemories(store, options);
    assert.equal((await store.export()).length, 4);
    // A completed seed must not even enumerate the source folders again.
    await seedMemories(store, { ...options, sources: [{ ...options.sources[0], directory: 'nonexistent-source' }] });
    assert.equal((await store.export()).length, 4);
    before.forEach((bytes, i) => assert.deepEqual(fs.readFileSync(path.join(fixture, ['user/preferences.md', 'repo/rules.md'][i])), bytes));
    assert.ok((await store.export()).every(item => /\.md:\d+$/.test(item.fact.from)));
    const definition = memoryTool(async () => store, 'TaskSync');
    registerLmToolDefinitions([definition]);
    let mcp;
    registerToolDefinitions((name, _config, handler) => { assert.equal(name, 'askaway_memory'); mcp = handler; }, [definition]);
    const lm = async input => JSON.parse((await registered.get('askaway_memory').invoke({ input })).content[0].value);
    const worker = async input => JSON.parse((await mcp(input)).content[0].text);
    for (const call of [lm, worker]) {
        assert.ok((await call({ action: 'search', query: 'shared' })).some(item => item.fact.text.includes('shared local')));
        assert.ok((await call({ action: 'view', scope: 'user' })).some(item => item.fact.text.includes('caller-facing')));
        const created = await call({ action: 'remember', text: call === lm ? 'Copilot fact' : 'OpenCode fact' });
        assert.ok((await call({ action: 'view' })).some(item => item.id === created.id));
    }
    const hidden = await lm({ action: 'remember', agentId: 'validator', text: 'Private validator fact' });
    assert.ok(!(await worker({ action: 'view' })).some(item => item.id === hidden.id));
    await assert.rejects(worker({ action: 'history', id: hidden.id }));
    await assert.rejects(worker({ action: 'update', id: hidden.id, text: 'Must not change' }));
    assert.ok(!(await worker({ action: 'export' })).jsonl.includes(hidden.id));
    const old = (await lm({ action: 'view' }))[0];
    const current = await worker({ action: 'update', id: old.id, text: 'Use the shared memory interface' });
    assert.ok(!(await lm({ action: 'view' })).some(item => item.id === old.id));
    assert.ok(!(await worker({ action: 'search', query: 'shared' })).some(item => item.id === old.id));
    const history = await lm({ action: 'history', id: current.id });
    assert.deepEqual(history.map(item => item.id), [old.id, current.id]);
    const exported = await worker({ action: 'export' });
    const rows = exported.jsonl.trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(item => item.id === old.id) && rows.some(item => item.id === current.id));
    assert.equal(rows.map(JSON.stringify).join('\n') + '\n', exported.jsonl);
    const count = index.length;
    await assert.rejects(lm({ action: 'remember', text: 'ghp_' + 'a'.repeat(36) }));
    assert.equal(index.length, count);
    const pkg = require('./package.json');
    assert.equal(pkg.contributes.languageModelTools.find(tool => tool.name === definition.name).toolReferenceName, 'memory2');
    assert.match(pkg.scripts['pretest:workers'], /test-memory-seed-and-mcp\.cjs/);
    console.log('PASS EV-MEMORY-SEED-MCP: idempotent read-only seed, LM/MCP read-write, agent isolation, hidden superseded history, JSONL round-trip, secret gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
