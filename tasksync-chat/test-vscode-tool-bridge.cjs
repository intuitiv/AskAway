// VS Code tool bridge, observed from an MCP client (what an OpenCode worker sees): listed tools, their parameters, and calls.
// Run: node test-vscode-tool-bridge.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

class LanguageModelTextPart { constructor(value) { this.value = value; } }
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? { LanguageModelTextPart, lm: {} } : load.call(this, request, ...rest); };

const buildDir = path.join(__dirname, '.bridge-test-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'vscodeToolBridge.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'workers', 'vscodeToolBridge.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
const { registerVsCodeToolBridge } = require(path.join(buildDir, 'vscodeToolBridge.js'));

(async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

    // The shape VS Code's own tools declare (copied from the real catalog).
    const memorySchema = { type: 'object', required: ['command'], properties: {
        command: { type: 'string', enum: ['view', 'create', 'str_replace', 'insert', 'delete', 'rename'], description: 'The operation' },
        path: { type: 'string' }, view_range: { type: 'array', items: { type: 'number' } } } };
    const invoked = [];
    const lm = {
        tools: [
            { name: 'copilot_memory', description: 'Manage memories', inputSchema: memorySchema },
            { name: 'copilot_getErrors', description: 'Diagnostics', inputSchema: { type: 'object', properties: { filePaths: { type: 'array', items: { type: 'string' } } } } },
            { name: 'copilot_runInTerminal', description: 'not bridged', inputSchema: { type: 'object' } },
        ],
        invokeTool: async (name, options) => {
            invoked.push([name, options.input, options.toolInvocationToken]);
            if (options.input.path === '/boom') { throw new Error('no such memory'); }
            return { content: [new LanguageModelTextPart(`${name}:${options.input.path ?? '-'}`), new LanguageModelTextPart('line 2')] };
        },
    };
    const server = new McpServer({ name: 't', version: '1' });
    const registered = registerVsCodeToolBridge((name, config, handler) => server.registerTool(name, config, handler), lm);
    assert.deepEqual(registered, ['copilot_memory', 'copilot_getErrors'], 'only allowlisted tools that exist in this VS Code');

    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'worker', version: '1' });
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ['copilot_getErrors', 'copilot_memory']);
    const memory = tools.find((t) => t.name === 'copilot_memory');
    assert.match(memory.description, /^\[VS Code\] Manage memories/);
    assert.deepEqual(memory.inputSchema.required, ['command'], 'required fields survive');
    assert.deepEqual(memory.inputSchema.properties.command.enum, ['view', 'create', 'str_replace', 'insert', 'delete', 'rename']);
    assert.equal(memory.inputSchema.properties.view_range.items.type, 'number');

    const ok = await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/memories/repo/' } });
    assert.deepEqual(ok.content, [{ type: 'text', text: 'copilot_memory:/memories/repo/\nline 2' }]);
    assert.deepEqual(invoked[0], ['copilot_memory', { command: 'view', path: '/memories/repo/' }, undefined], 'VS Code gets the worker\'s input unchanged');
    const bad = await client.callTool({ name: 'copilot_memory', arguments: { command: 'nope' } });
    assert.equal(bad.isError, true, 'input outside the VS Code schema is refused before VS Code');
    assert.equal(invoked.length, 1);
    const failed = await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/boom' } });
    assert.deepEqual([failed.isError, failed.content[0].text], [true, 'VS Code tool copilot_memory failed: no such memory']);

    // Workers write memories: create and str_replace (both fail on a stale view), one writer per path at a time.
    let inFlight = 0, maxInFlight = 0;
    lm.invokeTool = async (name, options) => {
        invoked.push([name, options.input]);
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;
        return { content: [new LanguageModelTextPart(`${options.input.command} ${options.input.path}`)] };
    };
    const edit = (p, n) => client.callTool({ name: 'copilot_memory', arguments: { command: 'str_replace', path: p, old_str: `v${n}`, new_str: `v${n + 1}` } });
    const created = await client.callTool({ name: 'copilot_memory', arguments: { command: 'create', path: '/memories/repo/worker-note.md', file_text: 'fact' } });
    assert.equal(created.content[0].text, 'create /memories/repo/worker-note.md', 'a worker can create a memory');
    maxInFlight = 0;
    await Promise.all([edit('/memories/repo/a.md', 1), edit('/memories/repo/a.md', 2), edit('/memories/repo/a.md', 3)]);
    assert.equal(maxInFlight, 1, 'concurrent edits of one memory run one at a time');
    maxInFlight = 0;
    await Promise.all([edit('/memories/repo/a.md', 1), edit('/memories/repo/b.md', 1)]);
    assert.equal(maxInFlight, 2, 'different memories do not wait for each other');
    const before = invoked.length;
    for (const command of ['insert', 'delete', 'rename']) {
        const refused = await client.callTool({ name: 'copilot_memory', arguments: { command, path: '/memories/repo/a.md' } });
        assert.equal(refused.isError, true, `${command} is refused`);
        assert.match(refused.content[0].text, /Workers may only view, create, str_replace memories/);
    }
    assert.equal(invoked.length, before, 'refused commands never reach VS Code');

    const config = JSON.parse(fs.readFileSync(path.join(require('node:os').homedir(), '.config', 'opencode', 'opencode.json'), 'utf8'));
    assert.equal(config.mcp.askaway?.url, 'http://127.0.0.1:3579/sse', 'OpenCode workers reach the AskAway MCP');
    for (const key of ['askaway_worker_*', 'askaway_ask_user', 'askaway_commentary']) { assert.equal(config.permission[key], 'deny', `${key} stays orchestrator-only`); }
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log(`EV-039 VsCodeToolBridge: PASS bridged=${registered.join(',')} schema=vscode inputUnchanged=true invalidRefused=true errors=isError openCodeConfig=true`);
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
