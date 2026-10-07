const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadModule(relative) {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, relative)], bundle: true,
        platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const module = { exports: {} };
    vm.runInNewContext(output, { module, exports: module.exports, require, __dirname });
    return module.exports;
}

const { SPEC_KIT_PROMPTS, CLAUDE_SPEC_KIT_COMMANDS } = loadModule('src/specs/specKitPromptAssets.ts');
for (const prompt of [SPEC_KIT_PROMPTS['sk.tasks.prompt.md'], CLAUDE_SPEC_KIT_COMMANDS['sk.tasks.md']]) {
    for (const rule of ['[cloud]', '[local: <reason>]', 'self-contained', '~45 minutes',
        'no open questions', 'no local services', 'local service', 'open question', '> 45 min',
        'not self-contained', 'explicit reviewer request', 'Never automatically queue']) {
        assert.ok(prompt.includes(rule), `generated-task instructions include ${rule}`);
    }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-cloud-eligibility-'));
const dir = path.join(root, 'specs', '001-example');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'spec.md'), '# Feature Specification: Example\n');
// Caller-visible output of /sk.tasks: scanner must retain each decision without inferring eligibility from prose.
const rows = [
    '- [ ] T001 [cloud] [US1] Validate a pure parser',
    '- [ ] T002 [local: local service] [US1] Verify local service',
    '- [ ] T003 [local: open question] [US1] Resolve design',
    '- [ ] T004 [local: > 45 min] [US1] Large migration',
    '- [ ] T005 [local: not self-contained] [US1] Dependent change',
    '- [ ] T006 [direct-agent-ready] [US1] Untagged legacy task',
    '- [ ] T007 [cloud] [local: open question] [US1] Conflicting tags',
    '- [x] T008 [cloud] [US1] Completed parser'
];
const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const context = { specsShowDone: true, specsWorkExpanded: {}, writes: [],
    vscode: { postMessage(message) { context.writes.push(message); } },
    escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;'); } };
vm.createContext(context);
const from = webview.indexOf('function formatSpecInline(text)');
const to = webview.indexOf('var SPEC_STAGE_COMMAND', from);
assert.ok(from >= 0 && to > from);
vm.runInContext(webview.slice(from, to), context);
const childProcess = require('node:child_process');
const originals = {};
let githubWrites = 0;
for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) {
    originals[method] = childProcess[method];
    childProcess[method] = (...args) => {
        if (/\bgh\b|\bgit\b.*\bpush\b/.test(String(args[0]))) {
            githubWrites++;
            throw new Error('Loading eligible tasks must not invoke GitHub writes');
        }
        return originals[method](...args);
    };
}
try {
    const { scanSpecs } = loadModule('src/specs/specKitScanner.ts');
    for (const cycle of [false, true]) {
        fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n## Phase 1\n' +
            rows.map(row => cycle ? row.replace('[US1]', '[US1] [CY-001]') : row).join('\n'));
        const spec = scanSpecs(root).specs[0];
        assert.equal(spec.tasks.length, 8);
        assert.ok(spec.tasks[0].tags.includes('cloud'));
        assert.ok(spec.tasks[1].tags.includes('local: local service'));
        assert.equal(spec.tasks[0].text, 'Validate a pure parser');
        context.spec = spec;
        for (const stage of ['specify', 'clarify', 'plan', 'tasks', 'implement', 'converge']) {
            spec.specKitStage = stage;
            const html = vm.runInContext('renderSpecWork(spec)', context);
            assert.equal((html.match(/data-act="queue-cloud"/g) || []).length, 2);
            for (const task of spec.tasks) {
                context.task = task;
                const shared = vm.runInContext('renderCloudEligibility(task, spec.slug)', context);
                if (shared) assert.ok(html.includes(shared), 'both hierarchy routes reuse the shared affordance');
                if (['T001', 'T008'].includes(task.id)) assert.match(shared, /Queue in cloud/);
                else assert.doesNotMatch(shared, /<button/);
            }
            for (const reason of ['local service', 'open question', '&gt; 45 min', 'not self-contained']) {
                assert.ok(html.includes(`title="${reason}"`), `visible local reason: ${reason}`);
            }
        }
    }
    assert.equal(githubWrites, 0);
    assert.equal(context.writes.length, 0, 'rendering posts no queue or GitHub request');
    console.log('PASS EV-CLOUD-ELIGIBILITY: prompt rules, scanner tags/reasons, shared queue affordance, zero GitHub writes');
} finally {
    for (const method of Object.keys(originals)) childProcess[method] = originals[method];
}
