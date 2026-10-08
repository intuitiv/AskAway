'use strict';
// EV-GOALS-DOCS: GOALS.md, the ADRs and the coverage map stay linked, complete and quoted.
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const problems = [];

const adrDir = 'docs/adr';
const norm = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
const sourceFiles = ['GOALS.md', 'AGENTS.md', '.askaway/reviewer-messages.md',
    ...fs.readdirSync(path.join(repo, 'specs'), { withFileTypes: true }).filter((d) => d.isDirectory())
        .flatMap((d) => ['Goal.md', 'Rules.md'].map((f) => `specs/${d.name}/${f}`)),
    ...fs.readdirSync(path.join(repo, 'tasksync-chat/docs/requirements')).map((f) => `tasksync-chat/docs/requirements/${f}`)];
const sources = norm(sourceFiles.filter((f) => fs.existsSync(path.join(repo, f))).map(read).join('\n').replace(/^>\s?/gm, ''));
const adrFiles = fs.readdirSync(path.join(repo, adrDir)).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
const adrReadme = read(`${adrDir}/README.md`);
const numbers = new Set();
let quotes = 0;
for (const file of adrFiles) {
    const text = read(`${adrDir}/${file}`);
    const num = file.slice(0, 4);
    if (numbers.has(num)) problems.push(`${file}: duplicate ADR number ${num}`);
    numbers.add(num);
    if (!text.startsWith(`# ADR ${num}:`)) problems.push(`${file}: first line must be "# ADR ${num}: <title>"`);
    if (!/^- Status: (Proposed|Accepted|Rejected|Superseded|Deprecated)\b/m.test(text)) problems.push(`${file}: no "- Status:" line`);
    if (!/^- Date: \d{4}-\d{2}-\d{2}$/m.test(text)) problems.push(`${file}: no "- Date: YYYY-MM-DD" line`);
    const decision = (text.split(/^## Decision\s*$/m)[1] || '').split(/^## /m)[0];
    if (!/^>\s*\S/m.test(decision) || !/\d{4}-\d{2}-\d{2}/.test(decision)) problems.push(`${file}: Decision has no dated reviewer quote`);
    for (const block of decision.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.startsWith('>'))) {
        const quote = norm(block.replace(/^>\s?/gm, ' ').replace(/\(?\d{4}-\d{2}-\d{2}[^)]*\)?\s*$/, '')).replace(/^"|"$/g, '').replace(/[\s,;:.-]+$/, '');
        if (quote) quotes += 1;
        if (quote && !sources.includes(quote)) problems.push(`${file}: quote not found verbatim in any source: "${quote.slice(0, 80)}"`);
    }
    if (!adrReadme.includes(`(${file})`)) problems.push(`${file}: not listed in ${adrDir}/README.md`);
}
if (!adrFiles.length) problems.push('no ADR files');

const goals = read('GOALS.md');
const goalIds = [...goals.matchAll(/^### (G\d+) /gm)].map((m) => m[1]);
if (!goalIds.length) problems.push('GOALS.md: no "### G<n>" goal sections');
for (const id of goalIds) {
    const section = goals.split(new RegExp(`^### ${id} `, 'm'))[1].split(/^#{2,3} /m)[0];
    if (!/docs\/adr\/\d{4}-/.test(section)) problems.push(`GOALS.md ${id}: links no ADR`);
}
if (!/^### \d{4}-\d{2}-\d{2}$/m.test(goals.split(/^## \d+\. Reviewer's words, verbatim/m)[1] || '')) {
    problems.push("GOALS.md: the reviewer's verbatim words need a dated heading");
}

const coverage = read('docs/goals-coverage.md');
for (const id of goalIds) {
    if (!new RegExp(`^\\|\\s*${id}\\s*\\|`, 'm').test(coverage)) problems.push(`docs/goals-coverage.md: no row for ${id}`);
}

let links = 0;
const linked = ['GOALS.md', `${adrDir}/README.md`, ...adrFiles.map((f) => `${adrDir}/${f}`), 'docs/goals-coverage.md', 'tasksync-chat/docs/requirements/README.md'];
for (const rel of linked) {
    for (const m of read(rel).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        links += 1;
        if (!fs.existsSync(path.join(repo, path.dirname(rel), decodeURI(target)))) problems.push(`${rel}: broken link ${m[1]}`);
    }
}

if (problems.length) {
    console.error(`FAIL EV-GOALS-DOCS\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
}
console.log(`PASS EV-GOALS-DOCS goals=${goalIds.length} adrs=${adrFiles.length} quotes=${quotes} links=${links}`);
