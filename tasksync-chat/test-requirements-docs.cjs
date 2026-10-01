'use strict';
// EV-REQUIREMENTS-DOCS: every requirement row has a unique ID, a date, and a guard that exists in a test file.
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const docsDir = path.join(root, 'docs', 'requirements');
const testFiles = fs.readdirSync(root).filter((f) => /^test-.*\.(cjs|mjs|js)$/.test(f) && f !== 'test-requirements-docs.cjs');
const testText = testFiles.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

const problems = [];
const docs = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
const readme = fs.existsSync(path.join(docsDir, 'README.md')) ? fs.readFileSync(path.join(docsDir, 'README.md'), 'utf8') : '';
if (!readme) problems.push('README.md missing');

const ids = new Map();
let rows = 0;
let guarded = 0;
let gaps = 0;
const requirementFiles = docs.filter((f) => f !== 'README.md');

for (const file of requirementFiles) {
    if (!readme.includes(`(${file})`)) problems.push(`${file}: not listed in README.md index`);
    const lines = fs.readFileSync(path.join(docsDir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
        const cells = line.split('|').map((c) => c.trim());
        if (cells.length < 6 || !/^R-[A-Z]+-\d+$/.test(cells[1])) return;
        const [, id, requirement, words, guard] = cells;
        const where = `${file}:${i + 1} ${id}`;
        rows += 1;
        if (ids.has(id)) problems.push(`${where}: duplicate ID (first at ${ids.get(id)})`);
        ids.set(id, `${file}:${i + 1}`);
        if (!requirement) problems.push(`${where}: empty requirement`);
        if (!/\d{4}-\d{2}-\d{2}/.test(words)) problems.push(`${where}: reviewer's words carry no date`);
        if (!/"[^"]+"/.test(words)) problems.push(`${where}: reviewer's words carry no quote`);
        if (guard === 'gap') { gaps += 1; return; }
        const refs = [];
        for (const m of guard.matchAll(/test-[\w.-]+\.(?:cjs|mjs|js)/g)) {
            refs.push(m[0]);
            if (!testFiles.includes(m[0])) problems.push(`${where}: test file ${m[0]} not found`);
        }
        for (const m of guard.matchAll(/EV-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g)) {
            refs.push(m[0]);
            if (!new RegExp(`${m[0]}(?![A-Za-z0-9-])`).test(testText)) problems.push(`${where}: ${m[0]} not found in any test-*.cjs`);
        }
        for (const m of guard.matchAll(/`(PASS[^`]*)`/g)) {
            const label = m[1];
            refs.push(label);
            if (!testText.includes(label)) problems.push(`${where}: "${label}" not found in any test-*.cjs`);
        }
        if (!refs.length) problems.push(`${where}: Guarded by must be a test id or "gap"`);
        else guarded += 1;
    });
}
if (!rows) problems.push('no requirement rows found');

if (problems.length) {
    console.error(`FAIL EV-REQUIREMENTS-DOCS\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
}
console.log(`PASS EV-REQUIREMENTS-DOCS files=${requirementFiles.length} rows=${rows} guarded=${guarded} gaps=${gaps}`);
