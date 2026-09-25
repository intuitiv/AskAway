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

// Denied: anything that reads or edits implementation code, runs commands, or delegates outside AskAway workers.
const denied = [/^execute\b/, /^edit\b/, /^read\b/, /^search\/(codebase|textSearch|usages)\b/, /^agent\b/, /runSubagent/, /^vscode\/runCommand/, /terminal/i];
const leaks = tools.filter((tool) => denied.some((pattern) => pattern.test(tool)));
assert.deepEqual(leaks, [], 'no code read/edit, terminal, or sub-agent tools');

// Allowed and required: planning memory, the one worker tool (eight actions), commentary, budget, and the internet.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).contributes.languageModelTools.map((t) => t.toolReferenceName);
const required = ['vscode/memory', 'web', 'intuitiv.askaway/commentary', 'intuitiv.askaway/turnBudget', 'intuitiv.askaway/worker'];
for (const tool of required) { assert.ok(tools.includes(tool), `orchestrator has ${tool}`); }
assert.ok(!tools.some((t) => /^intuitiv\.askaway\/worker[A-Z]/.test(t)), 'no per-operation worker tools');
for (const tool of tools.filter((t) => t.startsWith('intuitiv.askaway/'))) {
    assert.ok(manifest.includes(tool.split('/')[1]), `${tool} is a tool this extension declares`);
}
assert.doesNotMatch(text, /opencode run --print-logs/, 'no terminal fallback that would dispatch around the Workers tab');
assert.match(text, /no terminal and no code read\/edit tools, by design/);
console.log(`EV-022 OrchestratorToolPolicy: PASS tools=${tools.length} denied=0 workerTool=1 terminalFallback=none`);
