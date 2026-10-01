// EV-CHECKPOINT: tools/checkpoint.cjs commits only the named paths and refuses unsafe calls.
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.join(__dirname, 'tools', 'checkpoint.cjs');
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-')));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-out-'));
const sh = (cmd, args, cwd = repo) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const git = (...args) => sh('git', args);
const run = (...args) => sh('node', [script, ...args]);
const write = (name, text) => fs.writeFileSync(path.join(repo, name), text);

try {
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    write('a.txt', 'a1\n'); write('b.txt', 'b1\n');
    git('add', '.'); git('commit', '-q', '-m', 'init');

    // commits only the named path; unrelated dirty file stays unstaged
    write('a.txt', 'a2\n'); write('b.txt', 'b2\n'); write('new.txt', 'n\n');
    let r = run('-m', 'change a', 'a.txt');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /a\.txt \| 2/, 'diff --stat printed first');
    assert.match(r.stdout, /^[0-9a-f]+ change a$/m, 'log -1 printed');
    assert.match(r.stdout, /^ M b\.txt$/m, 'unrelated file reported unstaged');
    assert.match(r.stdout, /^\?\? new\.txt$/m);
    assert.strictEqual(git('show', '--name-only', '--format=', 'HEAD').stdout.trim(), 'a.txt');
    assert.strictEqual(git('diff', '--cached', '--name-only').stdout.trim(), '', 'nothing left staged');

    // refusals
    r = run('-m', 'x');
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /no paths/);
    r = run('-m', 'x', 'a.txt');
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /nothing staged/);
    fs.writeFileSync(path.join(outside, 'o.txt'), 'o');
    r = run('-m', 'x', path.join(outside, 'o.txt'));
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /outside the repo/);
    r = run('-m', 'x', '../escape.txt');
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /outside the repo/);
    fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), git('rev-parse', 'HEAD').stdout);
    r = run('-m', 'x', 'b.txt');
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /merge\/rebase/);
    assert.strictEqual(git('diff', '--cached', '--name-only').stdout.trim(), '', 'refused merge state staged nothing');
    console.log('PASS EV-CHECKPOINT');
} finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
}
