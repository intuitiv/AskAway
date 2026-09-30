// Sample Spec Kit workspace for outside-in tests of the guided flow (005).
// makeSampleRepo({ git }) → { root, spec(slug), write(rel, text), commit(msg), cleanup() }
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const STORY_TASKS = [
    '# Tasks: Sample',
    '## Phase 1: Setup',
    '- [ ] T001 Create structure',
    '## Phase 2: Foundational',
    '- [ ] T002 [P] Shared module',
    '## Phase 3: User Story 1 - First (Priority: P1)',
    '- [ ] T003 [P] [US1] Build first',
    '- [ ] T004 [US1] [cloud] Test first',
    '## Phase 4: Polish',
    '- [ ] T005 [local: needs mesh] Docs'
].join('\n');

const SPECS = {
    '001-specified': { 'spec.md': '# Feature Specification: Specified\n' },
    '002-clarified': { 'spec.md': '# Feature Specification: Clarified\n\n## Clarifications\n\n### Session 2026-09-30\n- Q: a → A: b\n' },
    '003-planned': { 'spec.md': '# Feature Specification: Planned\n', 'plan.md': '# Plan\n' },
    '004-checklisted': { 'spec.md': '# Feature Specification: Checklisted\n', 'plan.md': '# Plan\n', 'checklists/requirements.md': '- [x] CHK001 ok\n' },
    '005-tasked': { 'spec.md': '# Feature Specification: Tasked\n', 'plan.md': '# Plan\n', 'tasks.md': STORY_TASKS },
    '006-implementing': { 'spec.md': '# Feature Specification: Implementing\n', 'plan.md': '# Plan\n', 'tasks.md': STORY_TASKS.replace('- [ ] T001', '- [x] T001') },
    '007-legacy-cycles': { 'spec.md': '# Feature Specification: Legacy\n', 'tasks.md': '# Tasks\n## Phase 1 — Foundation\n- [ ] T001 [CY-001] Build\n- [x] T002 [CY-001] Verify\n' }
};

function makeSampleRepo({ git = false, specs = SPECS } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-specs-sample-'));
    const write = (rel, text) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        return file;
    };
    for (const [slug, files] of Object.entries(specs)) {
        for (const [rel, text] of Object.entries(files)) { write(path.join('specs', slug, rel), text); }
    }
    const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const commit = (msg) => { run('add', '-A'); run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return run('rev-parse', 'HEAD'); };
    if (git) { run('init', '-q'); commit('initial'); }
    return {
        root,
        spec: (slug) => path.join(root, 'specs', slug),
        write,
        commit,
        git: run,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true })
    };
}

module.exports = { makeSampleRepo, SPECS, STORY_TASKS };
