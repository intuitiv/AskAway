const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const live = process.env.ASKAWAY_MEMORY_LIVE === '1';
// Read credentials only in the explicitly requested live run; never emit them.
const secret = live ? fs.readFileSync(path.join(require('node:os').homedir(), '.agentmemory/secret'), 'utf8').trim() : 'fixture-bearer';
const liveId = live ? `${Date.now()}-${process.pid}-${require('node:crypto').randomUUID()}` : undefined;
const project = live ? `askaway-livetest-${liveId}-repo` : 'TaskSync';
const userProject = live ? `askaway-livetest-${liveId}-user` : '_user';
if (live) console.log(`T012 LIVE throwaway projects: user=${userProject} repo=${project}`);
const rememberShape = require('./test-fixtures/agentmemory-shapes/remember.json');
const memoriesShape = require('./test-fixtures/agentmemory-shapes/memories.json');
const fixture = path.join(__dirname, 'test-fixtures/memory-seed');
const ledgerRoot = live ? path.join(fixture, `live-${liveId}`) : 'fixture-workspace';
const marker = live ? path.join(ledgerRoot, 'seed-marker') : 'seed-marker';
const before = ['user/preferences.md', 'repo/rules.md'].map(file => fs.readFileSync(path.join(fixture, file)));
const files = new Map();
let frozen = false;
let sourceReads = 0;
function guardSource(file) {
    if (live && path.resolve(String(file)).startsWith(ledgerRoot + path.sep)) return;
    if (path.resolve(String(file)).startsWith(fixture + path.sep)) {
        assert.equal(frozen, false, 'Markdown sources must never be read or enumerated after seeding');
        sourceReads++;
    }
}
const fakeFs = {
    ...fs,
    existsSync: file => files.has(file),
    mkdirSync: () => {},
    writeFileSync: (file, text) => { assert.equal(file, marker); files.set(file, text); },
    appendFileSync: (file, text) => {
        if (live) assert.ok(path.resolve(file).startsWith(ledgerRoot + path.sep), 'Live ledger must stay under the repo fixture');
        files.set(file, (files.get(file) || '') + text);
    },
    readFileSync: (file, encoding) => { guardSource(file); return files.has(file) ? files.get(file) : fs.readFileSync(file, encoding); },
    readdirSync: (file, options) => { guardSource(file); return fs.readdirSync(file, options); },
};
const registered = new Map();
const vscode = { lm: { registerTool: (name, tool) => { registered.set(name, tool); return { dispose() {} }; } },
    LanguageModelToolResult: class { constructor(content) { this.content = content; } },
    LanguageModelTextPart: class { constructor(value) { this.value = value; } } };
function load(file, fileSystem = fakeFs) {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true,
        platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, URL, URLSearchParams, AbortSignal, console,
        require: name => name === 'fs' ? fileSystem : name === 'vscode' ? vscode : require(name),
        fetch: async (_url, options) => {
            assert.equal(options.headers.Authorization, `Bearer ${secret}`);
            assert.ok(!options.body || !options.body.includes(secret), 'Bearer must not enter memory bodies');
            if (live) {
                if (options.body) {
                    const body = JSON.parse(options.body);
                    assert.deepEqual(body.concepts.filter(tag => tag.startsWith('project:')),
                        [body.concepts.includes(`project:${userProject}`) ? `project:${userProject}` : `project:${project}`],
                        'Live writes must use only throwaway projects');
                    assert.ok(['agents', 'validator'].includes(body.agentId));
                }
                return fetch(_url, options);
            }
            if (_url.endsWith('/remember')) {
                assert.equal(options.method, 'POST');
                const body = JSON.parse(options.body);
                index.push({ ...rememberShape.memory, id: `mem_${index.length}`, content: body.content, agentId: body.agentId, concepts: body.concepts });
                return { ok: true, json: async () => ({ ...rememberShape, memory: index.at(-1) }) };
            }
            const url = new URL(_url);
            assert.equal(url.pathname, '/agentmemory/memories'); assert.equal(options.method, 'GET');
            assert.equal(options.body, undefined);
            // Deliberately return other agents and old versions: the store owns filtering.
            const hits = index;
            return { ok: true, json: async () => ({ ...memoriesShape, memories: hits, total: hits.length,
                search: { query: url.searchParams.get('q'), mode: 'keyword' } }) };
        } });
    return module.exports;
}
const index = [];
(async () => {
    const { AgentmemoryStore } = load('src/validator/agentmemoryStore.ts');
    const { DedupKnowledgeStore } = load('src/validator/knowledgeStore.ts');
    const { seedMemories } = load('src/validator/memorySeed.ts');
    if (!live) {
        const defaultsFixture = path.join(__dirname, '.memory-default-sources-fixture');
        fs.mkdirSync(defaultsFixture, { recursive: true });
        try {
            const { defaultMemorySources, seedMemories: seedDefaults } = load('src/validator/memorySeed.ts', fs);
            const globalStorageDir = path.join(defaultsFixture, 'globalStorage', 'x');
            const workspaceStorageDir = path.join(defaultsFixture, 'workspaceStorage', 'h', 'x');
            const userDir = path.join(defaultsFixture, 'globalStorage', 'github.copilot-chat', 'memory-tool', 'memories');
            const repoDir = path.join(defaultsFixture, 'workspaceStorage', 'h', 'GitHub.copilot-chat', 'memory-tool', 'memories', 'repo');
            const userSetting = path.join(defaultsFixture, 'override-user');
            const repoSetting = path.join(defaultsFixture, 'override-repo');
            for (const directory of [userDir, repoDir, userSetting, repoSetting]) fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(userDir, 'user.md'), 'DEFAULT_USER_MARKER');
            fs.writeFileSync(path.join(repoDir, 'repo.md'), 'DEFAULT_REPO_MARKER');
            fs.writeFileSync(path.join(userDir, 'ignored.txt'), 'NON_MD_MARKER');
            fs.mkdirSync(path.join(userDir, 'session'), { recursive: true });
            fs.writeFileSync(path.join(userDir, 'session', 'ignored.md'), 'SUBFOLDER_MARKER');
            const args = { globalStorageDir, workspaceStorageDir, memoryProject: 'fixture-project', exists: fs.existsSync };
            const sources = defaultMemorySources(args);
            const plain = value => JSON.parse(JSON.stringify(value));
            assert.deepEqual(plain(sources), [
                { directory: userDir, scope: { project: '_user', agentId: 'agents' } },
                { directory: repoDir, scope: { project: 'fixture-project', agentId: 'agents' } },
            ], 'no settings resolve both default Copilot folders with their existing scopes');
            const imported = [];
            await seedDefaults({ remember: async (fact, scope) => { imported.push({ text: fact.text, scope }); } },
                { marker: path.join(defaultsFixture, 'seeded'), sources });
            assert.deepEqual(plain(imported), [
                { text: 'DEFAULT_USER_MARKER', scope: { project: '_user', agentId: 'agents' } },
                { text: 'DEFAULT_REPO_MARKER', scope: { project: 'fixture-project', agentId: 'agents' } },
            ], 'only top-level Markdown is seeded, never subfolder or non-md files');
            assert.deepEqual(plain(defaultMemorySources({ ...args, userSetting, repoSetting })).map(source => source.directory),
                [userSetting, repoSetting], 'settings override the default folders');
            const missing = path.join(defaultsFixture, 'missing');
            assert.deepEqual(plain(defaultMemorySources({ ...args, userSetting: missing })), [plain(sources[1])], 'missing user folder skipped');
            assert.deepEqual(plain(defaultMemorySources({ ...args, repoSetting: missing })), [plain(sources[0])], 'missing repo folder skipped');
            assert.deepEqual(plain(defaultMemorySources({ ...args, workspaceStorageDir: undefined, repoSetting })), [plain(sources[0])],
                'without workspace storage, repo source is skipped');
            console.log('PASS EV-MEMORY-DEFAULT-SOURCES: defaults, overrides, missing folders, top-level md only');
        } finally {
            fs.rmSync(defaultsFixture, { recursive: true, force: true });
        }
    }
    const { memoryTool } = load('src/validator/memoryTool.ts');
    const { registerLmToolDefinitions } = load('src/workers/lmTools.ts');
    const { registerToolDefinitions } = load('src/workers/workerTools.ts');
    const store = new DedupKnowledgeStore(new AgentmemoryStore(ledgerRoot, 'http://127.0.0.1:3111', secret));
    const options = { marker, sources: [
        { directory: path.join(fixture, 'user'), scope: { project: userProject, agentId: 'agents' } },
        { directory: path.join(fixture, 'repo'), scope: { project, agentId: 'agents' } },
    ] };
    await seedMemories(store, options);
    assert.equal((await store.export()).length, 4);
    assert.ok(sourceReads > 0, 'Seed must read source markdown');
    frozen = true;
    const readsAfterSeed = sourceReads;
    // A completed seed must not even enumerate the source folders again.
    await seedMemories(store, { ...options, sources: [{ ...options.sources[0], directory: 'nonexistent-source' }] });
    await seedMemories(new DedupKnowledgeStore(new AgentmemoryStore(ledgerRoot, 'http://127.0.0.1:3111', secret)), options);
    assert.equal((await store.export()).length, 4);
    console.log('PASS T012 seed idempotence: repeated and reopened seed imports exactly four facts');
    before.forEach((bytes, i) => assert.deepEqual(fs.readFileSync(path.join(fixture, ['user/preferences.md', 'repo/rules.md'][i])), bytes));
    assert.ok((await store.export()).every(item => /\.md:\d+$/.test(item.fact.from)));
    // Mirror the tool's reserved user scope without ever persisting it on the live server.
    const toolStore = live ? {
        remember: (fact, scope) => store.remember(fact, { ...scope, project: scope.project === '_user' ? userProject : scope.project }),
        recall: (query, scope, limit) => store.recall(query, { ...scope, project: scope.project === '_user' ? userProject : scope.project }, limit),
        export: async () => (await store.export()).map(item => item.scope.project === userProject
            ? { ...item, scope: { ...item.scope, project: '_user' } } : item),
        supersede: (id, fact) => store.supersede(id, fact),
        history: id => store.history(id),
    } : store;
    const definition = memoryTool(async () => toolStore, project);
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
        assert.ok((await (call === lm ? worker : lm)({ action: 'view' })).some(item => item.id === created.id));
        console.log(`PASS T012 ${call === lm ? 'Copilot-side' : 'OpenCode-side'} read+write: seeded fact read, new fact shared through LM/MCP`);
    }
    const hidden = await lm({ action: 'remember', agentId: 'validator', text: 'Private validator fact' });
    assert.ok(!(await worker({ action: 'view' })).some(item => item.id === hidden.id));
    await assert.rejects(worker({ action: 'history', id: hidden.id }));
    await assert.rejects(worker({ action: 'update', id: hidden.id, text: 'Must not change' }));
    assert.ok(!(await worker({ action: 'export' })).jsonl.includes(hidden.id));
    assert.ok(!(await worker({ action: 'search', query: 'Private validator' })).some(item => item.id === hidden.id));
    assert.ok((await worker({ action: 'view', agentId: 'validator' })).some(item => item.id === hidden.id));
    console.log('PASS T012 agentId isolation: validator facts absent from other agent recall, view, export and mutation');
    const old = (await lm({ action: 'view' }))[0];
    const current = await worker({ action: 'update', id: old.id, text: 'Use the shared memory interface' });
    assert.ok(!(await lm({ action: 'view' })).some(item => item.id === old.id));
    assert.ok(!(await worker({ action: 'search', query: 'shared' })).some(item => item.id === old.id));
    const history = await lm({ action: 'history', id: current.id });
    assert.deepEqual(history.map(item => item.id), [old.id, current.id]);
    assert.ok((await worker({ action: 'search', query: 'shared' })).some(item => item.id === current.id));
    console.log('PASS T012 hidden superseded versions: recall/view hide old version; history retains both');
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
    assert.equal(sourceReads, readsAfterSeed);
    before.forEach((bytes, i) => assert.deepEqual(fs.readFileSync(path.join(fixture, ['user/preferences.md', 'repo/rules.md'][i])), bytes));
    console.log('PASS T012 byte-identical md: no source reads or enumeration after seed, including LM/MCP calls');
    if (live) console.log('PASS T012 LIVE: real loopback agentmemory Bearer remember/recall through LM/MCP (no server lifecycle or egress claim)');
    console.log('PASS EV-MEMORY-SEED-MCP: idempotent read-only seed, LM/MCP read-write, agent isolation, hidden superseded history, JSONL round-trip, secret gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
