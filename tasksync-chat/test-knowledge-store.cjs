const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const moduleOutput = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/validator/agentmemoryStore.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const loaded = { exports: {} };
const logs = [];
vm.runInNewContext(moduleOutput, { module: loaded, exports: loaded.exports, require, fetch, URL,
    AbortSignal, console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
const { AgentmemoryStore } = loaded.exports;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-knowledge-'));
const secret = 'injected-auth-fixture-never-in-content';
const credential = 'ghp_' + 'a'.repeat(36);
const requests = [], memories = [];
let failure = false;
const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ route: req.url, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    if (failure) { res.writeHead(503); res.end(JSON.stringify({ error: secret })); return; }
    if (req.url === '/agentmemory/remember') {
        const data = JSON.parse(body);
        const memory = { id: `memory-${memories.length + 1}`, content: data.content,
            agentId: data.agentId, concepts: data.concepts }; // Observed: project is not stored.
        memories.push(memory);
        res.writeHead(201); res.end(JSON.stringify({ id: memory.id }));
    } else if (req.url === '/agentmemory/search') {
        // Deliberately unscoped, stale and duplicated results, including an unknown external item.
        res.end(JSON.stringify({ results: [...memories, memories[0], { id: 'external', content: credential }] }));
    } else { res.writeHead(404); res.end('{}'); }
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    let store = new AgentmemoryStore(root, url, secret);
    const a = { project: 'TaskSync', agentId: 'validator', spec: '007-validator-agent' };
    const b = { ...a, project: 'AppLogic' };
    const agent = { ...a, agentId: 'copilot' };
    const specB = { ...a, spec: '008-other' };
    const old = await store.remember({ text: 'Use a single memory server', kind: 'rule',
        storyId: 'US2', taskId: 'T005', example: 'Attach another window' }, a);
    const projectFact = await store.remember({ text: 'AppLogic rule' }, b);
    const agentFact = await store.remember({ text: 'Copilot rule' }, agent);
    const specFact = await store.remember({ text: 'Other spec rule' }, specB);
    assert.deepEqual(requests[0].body.concepts, ['project:TaskSync', 'kind:rule',
        'spec:007-validator-agent', 'story:US2', 'task:T005']);
    const ids = async scope => Array.from(await store.recall('rule', scope, 10), row => row.id);
    assert.deepEqual(await ids(a), [old.id]);
    assert.deepEqual(await ids(b), [projectFact.id]);
    assert.deepEqual(await ids(agent), [agentFact.id]);
    assert.deepEqual(await ids(specB), [specFact.id]);
    const current = await store.supersede(old.id, { text: 'Use the shared server through an interface', kind: 'rule' });
    store = new AgentmemoryStore(root, url + '/agentmemory', secret); // Reopen from authoritative ledger.
    assert.deepEqual(await ids(a), [current.id]);
    assert.deepEqual(Array.from(await store.history(old.id), row => row.id), [old.id, current.id]);
    assert.deepEqual(Array.from(await store.history(current.id), row => row.fact.text),
        ['Use a single memory server', 'Use the shared server through an interface']);
    assert.equal((await store.export()).length, 5);
    const ledger = path.join(root, '.askaway/specs/_no-spec/validator/index.jsonl');
    assert.equal(fs.readFileSync(ledger, 'utf8').trim().split('\n').length, 5, 'supersede only appends');
    const before = requests.length;
    for (const fact of [{ text: credential }, { text: secret }, { text: 'safe', example: credential }]) {
        await assert.rejects(store.remember(fact, a), error => error.kind === 'rejected');
    }
    await assert.rejects(store.remember({ text: 'safe' }, { ...a, project: credential }), error => error.kind === 'rejected');
    await assert.rejects(store.recall(secret, a, 10), error => error.kind === 'rejected');
    assert.equal(requests.length, before, 'secret inputs rejected before HTTP');
    failure = true;
    for (const operation of [() => store.recall('rule', a, 10), () => store.remember({ text: 'unavailable' }, a)]) {
        await assert.rejects(operation(), error => error.kind === 'unavailable' && !error.message.includes(secret));
    }
    assert.equal((await store.export()).length, 5, 'failed write never enters source of truth');
    await new Promise(resolve => server.close(resolve));
    await assert.rejects(store.recall('rule', a, 10), error => error.kind === 'unavailable');
    await assert.rejects(store.remember({ text: 'offline' }, a), error => error.kind === 'unavailable');
    for (const sink of [JSON.stringify(requests), JSON.stringify(logs), fs.readFileSync(ledger, 'utf8'), JSON.stringify(await store.export())]) {
        assert.ok(!sink.includes(secret) && !sink.includes(credential), 'no secret in body, logs, records or export');
    }
    console.log('PASS EV-KNOWLEDGE-STORE: HTTP scope isolation, append-only supersede/history, secret gate, visible server-down errors');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
