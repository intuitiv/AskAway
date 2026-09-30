// T022 (CY-007) orchestrator tool policy, as VS Code loads the agent: it plans and delegates, it never reads, edits, or runs code.
// Run: node test-orchestrator-policy.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentFile = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'prompts', 'AA.Orchestrator.agent.md');
if (!fs.existsSync(agentFile)) {
    console.log('EV-022 OrchestratorToolPolicy: SKIP reason=AA.Orchestrator.agent.md not installed on this machine');
    process.exit(0);
}
const text = fs.readFileSync(agentFile, 'utf8');
const tools = (/^tools:\s*\[([^\]]*)\]/m.exec(text) || [])[1].split(',').map((t) => t.trim()).filter(Boolean);

// Denied: editing, sub-agents, and broad code search. Reviewer 2026-09-30: it may run ONE standalone command (git is its job,
// workers cannot commit) and read Spec Kit artifacts; multi-command work goes to a build worker.
const denied = [/^edit\b/, /^search\/(codebase|textSearch|usages)\b/, /^agent\b/, /runSubagent/, /^vscode\/runCommand/];
const leaks = tools.filter((tool) => denied.some((pattern) => pattern.test(tool)));
assert.deepEqual(leaks, [], 'no code edit, code search, or sub-agent tools');
assert.deepEqual(tools.filter((t) => /^(execute|read)\//.test(t)).sort(), ['execute/runInTerminal', 'read/readFile'], 'only one terminal and one read tool');

// Allowed and required: planning memory, the one worker tool (eight actions), commentary, budget, and the internet.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).contributes.languageModelTools.map((t) => t.toolReferenceName);
const required = ['vscode/memory', 'web', 'intuitiv.askaway/commentary', 'intuitiv.askaway/turnBudget', 'intuitiv.askaway/worker'];
for (const tool of required) { assert.ok(tools.includes(tool), `orchestrator has ${tool}`); }
assert.ok(!tools.some((t) => /^intuitiv\.askaway\/worker[A-Z]/.test(t)), 'no per-operation worker tools');
for (const tool of tools.filter((t) => t.startsWith('intuitiv.askaway/'))) {
    assert.ok(manifest.includes(tool.split('/')[1]), `${tool} is a tool this extension declares`);
}
assert.doesNotMatch(text, /opencode run --print-logs/, 'no terminal fallback that would dispatch around the Workers tab');
assert.match(text, /use the terminal only for ONE standalone command/, 'terminal is limited to one standalone command');
assert.match(text, /two or more commands in sequence[^\n]*is a `build` worker packet/, 'multi-command work is delegated');
assert.match(text, /You may read Spec Kit artifacts only/, 'reads are limited to spec artifacts');
assert.match(text, /At most TWO build workers at once per track/, 'parallel build workers are capped');
assert.match(text, /no shared file or shared surface/, 'parallel only on disjoint scope');
console.log(`EV-022 OrchestratorToolPolicy: PASS tools=${tools.length} edit=0 terminal=standalone-only reads=spec-artifacts parallelBuildCap=2 terminalFallback=none`);
