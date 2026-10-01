#!/usr/bin/env node
// Runs each argument as one shell command in order; prints a bounded tail per command.
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
let tail = 40;
let keepGoing = false;
const commands = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tail') { tail = Number(args[++i]); } else if (args[i] === '--keep-going') { keepGoing = true; } else { commands.push(args[i]); }
}

let ok = 0;
let failed = 0;
let firstFailure = 0;
let index = 0;
for (; index < commands.length; index++) {
    const cmd = commands[index];
    console.log(`$ ${cmd}`);
    const started = Date.now();
    const result = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lines = `${result.stdout || ''}${result.stderr || ''}`.split('\n');
    if (lines[lines.length - 1] === '') { lines.pop(); }
    if (tail > 0 && lines.length) { console.log(lines.slice(-tail).join('\n')); }
    const code = result.status ?? 1;
    console.log(`exit=${code} ${Date.now() - started}ms`);
    if (code === 0) { ok++; continue; }
    failed++;
    firstFailure = firstFailure || code;
    if (!keepGoing) { index++; break; }
}
console.log(`BATCH ok=${ok} failed=${failed} skipped=${commands.length - index}`);
process.exit(firstFailure);
