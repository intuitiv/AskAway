const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSpecs } = require('/tmp/askaway-spec-scanner.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-spec-hierarchy-'));
const specDir = path.join(root, 'specs', '001-example');
fs.mkdirSync(specDir, { recursive: true });
fs.mkdirSync(path.join(root, '.specify'));
fs.writeFileSync(path.join(root, '.specify', 'feature.json'), JSON.stringify({ feature_directory: specDir }));
fs.writeFileSync(path.join(specDir, 'spec.md'), '# Feature Specification: Example\n');
fs.writeFileSync(path.join(specDir, 'tasks.md'), [
    '# Tasks: Example',
    '**Feature:** `001-example` · **Branch:** `feature/example`',
    '## Phase 1 — Foundation (P1)',
    '- [ ] T001 [CY-001] Build the stable foundation — src/foundation.ts — demo: focused test',
    '- [ ] T002 [CY-001] Verify the foundation',
    '## Phase 2 — Delivery',
    '- [ ] T003 [CY-002] Ship the result'
].join('\n'));
fs.writeFileSync(path.join(specDir, 'implementation-log.md'), '| # | Task | Date | Files | Demo | Result |\n|---|---|---|---|---|---|\n| 1 | T001 — foundation | 2026-08-30 | a | pass | Done |\n| 2 | T002 — verify | 2026-08-30 | b | pass | Done |\n');

let spec = scanSpecs(root).specs[0];
assert.equal(spec.cycles.length, 2);
assert.equal(spec.cycles[0].phase, 'Phase 1 — Foundation');
assert.equal(spec.cycles[0].title, '');
assert.equal(spec.cycles[0].description, 'Build the stable foundation');
assert.equal(spec.cycles[0].tasks.length, 2);
assert.equal(spec.branch, 'feature/example');
assert.ok(spec.startedAt > 0);
assert.ok(spec.trackedDays >= 1);
assert.deepEqual(spec.completedTasksByDay, [{ day: '2026-08-30', taskIds: ['T001', 'T002'] }]);

fs.writeFileSync(path.join(root, '.specify', 'cycles.md'), '| Cycle | Title | Description | Verification |\n|---|---|---|---|\n| CY-001 | Foundation batch | Prepare shared primitives | focused test |\n');
spec = scanSpecs(root).specs[0];
assert.equal(spec.cycles[0].title, 'Foundation batch');
assert.equal(spec.cycles[0].description, 'Prepare shared primitives');
fs.rmSync(root, { recursive: true, force: true });
console.log('PASS phases > cycles > tasks, fallback purpose, and cycle metadata');