// T049 (CY-008): keeps generated tasks in check. A spec may hold at most --max-open unchecked tasks, and a cycle at most --max-cycle.
// Run: node tools/task-budget.cjs [specs/NNN-slug] [--max-open 12] [--max-cycle 6]   (default spec: .specify/feature.json)
const fs = require('node:fs');
const path = require('node:path');

const TASK = /^\s*[-*]\s*\[([ xX])\]\s*(T\d+[a-zA-Z]*)?\s*(.*)$/; // same rule as src/specs/specKitScanner.ts

function budget(tasksMd, { maxOpen = 12, maxCycle = 6 } = {}) {
    const open = [];
    for (const line of tasksMd.split('\n')) {
        const m = TASK.exec(line);
        if (!m || m[1] !== ' ') { continue; }
        open.push({ id: m[2] || '(no id)', cycle: (/\[(CY-\d+)\]/.exec(m[3]) || [])[1] || '(no cycle)' });
    }
    const byCycle = {};
    for (const task of open) { (byCycle[task.cycle] = byCycle[task.cycle] || []).push(task.id); }
    const overCycles = Object.entries(byCycle).filter(([, ids]) => ids.length > maxCycle).map(([cycle, ids]) => `${cycle}:${ids.length}/${maxCycle}`);
    const largest = Object.entries(byCycle).sort((a, b) => b[1].length - a[1].length)[0];
    return {
        pass: open.length <= maxOpen && overCycles.length === 0,
        open: open.length, maxOpen, overCycles,
        largest: largest ? `${largest[0]}:${largest[1].length}/${maxCycle}` : 'none',
    };
}

module.exports = { budget };

if (require.main === module) {
    const args = process.argv.slice(2);
    const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : fallback; };
    let specDir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
    if (!specDir) {
        let root = process.cwd();
        while (!fs.existsSync(path.join(root, '.specify', 'feature.json')) && path.dirname(root) !== root) { root = path.dirname(root); }
        const feature = JSON.parse(fs.readFileSync(path.join(root, '.specify', 'feature.json'), 'utf8'));
        specDir = path.resolve(root, feature.feature_directory);
    }
    const result = budget(fs.readFileSync(path.join(specDir, 'tasks.md'), 'utf8'), { maxOpen: flag('--max-open', 12), maxCycle: flag('--max-cycle', 6) });
    const line = `TASK-BUDGET ${path.basename(specDir)}: ${result.pass ? 'PASS' : 'FAIL'} open=${result.open}/${result.maxOpen} largestCycle=${result.largest}`
        + (result.overCycles.length ? ` overCycles=${result.overCycles.join(',')}` : '');
    console.log(line);
    if (!result.pass) {
        console.log('Merge tasks that share a file and a test, or move later increments to "## Later" in plan.md as one-line bullets.');
        process.exit(1);
    }
}
