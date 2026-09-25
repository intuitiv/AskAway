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
const { registerVsCodeToolBridge, registerWindow, readWindows } = require(path.join(buildDir, 'vscodeToolBridge.js'));

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
            { name: 'sonarqube_analyze_file', description: 'Analyze a file with SonarQube', inputSchema: { type: 'object', required: ['filePath'], properties: { filePath: { type: 'string' } } } },
            { name: 'sonarqube_list_potential_security_issues', description: 'Security issues', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } } },
            { name: 'mcp_yourkit-profi_yourkit_profiler', description: 'YourKit profiler', inputSchema: { type: 'object', properties: { command: { type: 'string' }, pid: { type: 'number' } } } },
        ],
        invokeTool: async (name, options) => {
            invoked.push([name, options.input, options.toolInvocationToken]);
            if (options.input.path === '/boom') { throw new Error('no such memory'); }
            return { content: [new LanguageModelTextPart(`${name}:${options.input.path ?? '-'}`), new LanguageModelTextPart('line 2')] };
        },
    };
    const server = new McpServer({ name: 't', version: '1' });
    const forwarded = [];
    const windows = [{ workspaces: ['/ws/a'], port: 1, pid: 11 }, { workspaces: ['/ws/b'], port: 2, pid: 22 }];
    const registered = registerVsCodeToolBridge((name, config, handler) => server.registerTool(name, config, handler), {
        lm, selfPort: 1, windows: () => windows,
        forward: async (port, name, args) => { forwarded.push([port, name, args]); return { content: [{ type: 'text', text: `from window ${port}` }] }; },
    });
    assert.deepEqual(registered, ['copilot_memory', 'copilot_getErrors', 'sonarqube_analyze_file', 'sonarqube_list_potential_security_issues', 'yourkit_profiler'], 'every allowlisted tool this VS Code has, even two behind one pattern; MCP-prefixed names are made stable');

    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'worker', version: '1' });
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ['copilot_getErrors', 'copilot_memory', 'sonarqube_analyze_file', 'sonarqube_list_potential_security_issues', 'yourkit_profiler']);
    const memory = tools.find((t) => t.name === 'copilot_memory');
    assert.match(memory.description, /^\[VS Code\] Manage memories/);
    assert.deepEqual(memory.inputSchema.required, ['command'], 'required fields survive');
    assert.deepEqual(memory.inputSchema.properties.command.enum, ['view', 'create', 'str_replace', 'insert', 'delete', 'rename']);
    assert.equal(memory.inputSchema.properties.view_range.items.type, 'number');
    assert.match(memory.inputSchema.properties.workspacePath.description, /working directory/, 'workers are asked for their workspace');

    const ok = await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/memories/repo/' } });
    assert.deepEqual(ok.content, [{ type: 'text', text: 'copilot_memory:/memories/repo/\nline 2' }]);
    assert.deepEqual(invoked[0], ['copilot_memory', { command: 'view', path: '/memories/repo/' }, undefined], 'VS Code gets the worker\'s input unchanged');
    const bad = await client.callTool({ name: 'copilot_memory', arguments: { command: 'nope' } });
    assert.equal(bad.isError, true, 'input outside the VS Code schema is refused before VS Code');
    assert.equal(invoked.length, 1);
    const failed = await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/boom' } });
    assert.deepEqual([failed.isError, failed.content[0].text], [true, 'VS Code tool copilot_memory failed: no such memory']);
    await client.callTool({ name: 'yourkit_profiler', arguments: { command: 'list' } });
    assert.equal(invoked[invoked.length - 1][0], 'mcp_yourkit-profi_yourkit_profiler', 'the stable name calls VS Code\'s own tool');

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

    // Routing: a worker's call goes to the VS Code window that has its workspace open.
    const viaB = await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/memories/repo/', workspacePath: '/ws/b/service' } });
    assert.equal(viaB.content[0].text, 'from window 2');
    assert.deepEqual(forwarded, [[2, 'copilot_memory', { command: 'view', path: '/memories/repo/', workspacePath: '/ws/b/service' }]], 'forwarded whole, so the target routes to itself');
    const local = invoked.length;
    const viaA = await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/memories/repo/', workspacePath: '/ws/a' } });
    assert.equal(viaA.content[0].text, 'view /memories/repo/', 'own workspace is handled here');
    assert.deepEqual(invoked[local], ['copilot_memory', { command: 'view', path: '/memories/repo/' }], 'workspacePath never reaches VS Code');
    await client.callTool({ name: 'copilot_memory', arguments: { command: 'view', path: '/memories/', workspacePath: '/elsewhere' } });
    assert.equal(forwarded.length, 1, 'a workspace no window has open is handled here');

    // The window registry: dead windows drop out.
    const reg = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'askaway-windows-'));
    registerWindow({ workspaces: ['/ws/a'], port: 3579, pid: process.pid }, reg);
    registerWindow({ workspaces: ['/ws/b'], port: 60001, pid: 999999 }, reg);
    assert.deepEqual(readWindows(reg, (pid) => pid === process.pid).map((w) => w.port), [3579]);
    assert.equal(fs.readdirSync(reg).length, 1, 'the dead window\'s entry is removed');

    const config = JSON.parse(fs.readFileSync(path.join(require('node:os').homedir(), '.config', 'opencode', 'opencode.json'), 'utf8'));
    assert.equal(config.mcp.askaway?.url, 'http://127.0.0.1:3579/sse', 'OpenCode workers reach the AskAway MCP');
    for (const key of ['askaway_worker_*', 'askaway_ask_user', 'askaway_commentary', 'askaway_yourkit_*', 'askaway_sonarqube_*']) { assert.equal(config.permission[key], 'deny', `${key} is denied by default`); }
    // T032/T033: the profiler and Sonar are open only to their own workers.
    const agentsDir = path.join(require('node:os').homedir(), '.config', 'opencode', 'agents');
    assert.match(fs.readFileSync(path.join(agentsDir, 'aa-perf.md'), 'utf8'), /"askaway_yourkit_\*": allow/);
    assert.match(fs.readFileSync(path.join(agentsDir, 'aa-quality.md'), 'utf8'), /"askaway_sonarqube_\*": allow/);
    for (const other of ['aa-code.md', 'aa-verify.md', 'aa-explore.md']) {
        assert.doesNotMatch(fs.readFileSync(path.join(agentsDir, other), 'utf8'), /askaway_(yourkit|sonarqube)/, `${other} cannot reach the profiler or Sonar`);
    }
    assert.doesNotMatch(fs.readFileSync(path.join(agentsDir, 'aa-quality.md'), 'utf8'), /SONAR_TOKEN\s*=|sq[pau]_[A-Za-z0-9]{20,}/, 'no Sonar token in the agent');
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log(`EV-039 VsCodeToolBridge: PASS bridged=${registered.join(',')} schema=vscode inputUnchanged=true invalidRefused=true errors=isError writes=create+str_replace serialized=true routedByWorkspace=true openCodeConfig=true`);
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
