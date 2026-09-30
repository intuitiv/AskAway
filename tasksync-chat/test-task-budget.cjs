// T049 (CY-008): Spec Kit may not flood a spec with tasks. Run: node test-task-budget.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tool = path.join(__dirname, 'tools', 'task-budget.cjs');
const run = (cwd, args = []) => childProcess.spawnSync(process.execPath, [tool, ...args], { cwd, encoding: 'utf8' });
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-budget-'));
const spec = (name, rows) => {
    const dir = path.join(workspace, 'specs', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks.md'), `# Tasks\n\n## Phase P1: Work\n\n${rows.join('\n')}\n`);
    return path.join('specs', name);
};
const rows = (count, { done = false, cycle = (i) => `CY-00${1 + Math.floor(i / 5)}`, start = 1 } = {}) =>
    Array.from({ length: count }, (_, i) => `- [${done ? 'x' : ' '}] T${String(start + i).padStart(3, '0')} [${cycle(i)}] Do thing ${i}. \`src/a.ts\``);

const small = spec('001-small', [...rows(40, { done: true }), ...rows(8, { start: 41 })]);
let result = run(workspace, [small]);
assert.equal(result.status, 0, result.stdout);
assert.match(result.stdout, /TASK-BUDGET 001-small: PASS open=8\/12 largestCycle=CY-00\d:5\/6/, 'finished tasks never count against the budget');

const flood = spec('002-flood', rows(100));
result = run(workspace, [flood]);
assert.equal(result.status, 1, 'a 100-task list is refused');
assert.match(result.stdout, /TASK-BUDGET 002-flood: FAIL open=100\/12/);
assert.match(result.stdout, /Merge tasks that share a file and a test/, 'the refusal says how to shrink it');

const fatCycle = spec('003-fat-cycle', rows(7, { cycle: () => 'CY-001' }));
result = run(workspace, [fatCycle]);
assert.equal(result.status, 1, 'one cycle may not hold 7 open tasks');
assert.match(result.stdout, /overCycles=CY-001:7\/6/);

assert.equal(run(workspace, [fatCycle, '--max-cycle', '8']).status, 0, 'limits are flags, not hard-coded');

// 005 US2: stories are the groups — 6 open in US1 and 6 in US2 pass; a 7th open US1 task fails as US1:7/6.
const storyRows = (story, count, start) => Array.from({ length: count }, (_, i) => `- [ ] T${String(start + i).padStart(3, '0')} [${story}] Story work ${i}`);
const storyDir = path.join(workspace, 'specs', '004-stories');
fs.mkdirSync(storyDir, { recursive: true });
fs.writeFileSync(path.join(storyDir, 'tasks.md'), ['# Tasks', '## Phase 3: User Story 1 - A (Priority: P1)', ...storyRows('US1', 5, 1),
    '- [ ] T006 untagged task in the US1 phase', '## Phase 4: User Story 2 - B (Priority: P2)', ...storyRows('US2', 6, 7)].join('\n'));
result = run(workspace, [storyDir]);
assert.equal(result.status, 0, result.stdout);
assert.match(result.stdout, /open=12\/12 largestCycle=US\d:6\/6/);
fs.appendFileSync(path.join(storyDir, 'tasks.md'), '\n## Phase 3: User Story 1 - A again\n- [ ] T013 one more\n');
result = run(workspace, [storyDir, '--max-open', '20']);
assert.equal(result.status, 1);
assert.match(result.stdout, /overCycles=US1:7\/6/, 'untagged tasks count toward their story phase');

fs.mkdirSync(path.join(workspace, '.specify'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.specify', 'feature.json'), JSON.stringify({ feature_directory: small }));
assert.match(run(workspace).stdout, /001-small: PASS/, 'defaults to the active spec');

const early = path.join(workspace, 'specs', '002-just-specified');
fs.mkdirSync(early, { recursive: true });
assert.match(run(workspace, [early]).stdout, /002-just-specified: PASS open=0\/12/, 'a spec before its tasks stage has nothing to budget');

const real = run(path.join(__dirname, '..'));
const activeSlug = path.basename(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.specify', 'feature.json'), 'utf8')).feature_directory);
assert.match(real.stdout, new RegExp(`TASK-BUDGET ${activeSlug}: (PASS|FAIL) open=\\d+/12`), 'runs on this repo\'s active spec');
assert.equal(real.status, 0, `this repo's active spec is within budget: ${real.stdout}`);

const skTasks = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'prompts', 'sk.tasks.prompt.md');
if (fs.existsSync(skTasks)) {
    assert.match(fs.readFileSync(skTasks, 'utf8'), /node tasksync-chat\/tools\/task-budget\.cjs/, '/sk.tasks runs the budget before reporting');
}
fs.rmSync(workspace, { recursive: true, force: true });
console.log('EV-049 TaskBudget: PASS flood100=refused fatCycle=refused doneIgnored=true activeSpecDefault=true skTasksGate=true');
