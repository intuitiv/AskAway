#!/usr/bin/env node
// One-command checkpoint: diff --stat, stage exactly the named paths, commit, status, log -1.
// Usage: node tools/checkpoint.cjs -m "<message>" <paths...>   (never `git add -A`, never pushes)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function git(args, cwd) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}

function fail(message) {
    console.error(`checkpoint: refused: ${message}`);
    process.exit(1);
}

function main(argv) {
    let message = '';
    const paths = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-m') { message = argv[++i] || ''; } else { paths.push(argv[i]); }
    }
    if (!message) { fail('missing -m "<message>"'); }
    if (paths.length === 0) { fail('no paths given; name the files to commit'); }

    const cwd = process.cwd();
    const top = git(['rev-parse', '--show-toplevel'], cwd);
    if (top.code !== 0) { fail('not inside a git repository'); }
    const root = fs.realpathSync(top.stdout.trim());
    const gitDir = path.resolve(cwd, git(['rev-parse', '--git-dir'], cwd).stdout.trim());
    for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
        if (fs.existsSync(path.join(gitDir, marker))) { fail(`merge/rebase in progress (${marker}); finish or abort it first`); }
    }
    for (const p of paths) {
        const abs = path.resolve(cwd, p);
        let real = abs;
        try { real = fs.realpathSync(abs); } catch { real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); }
        const rel = path.relative(root, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) { fail(`path outside the repo: ${p}`); }
    }

    // `commit --only <paths>` silently drops new files, so commit the index and guard it instead.
    if (git(['diff', '--cached', '--name-only'], cwd).stdout.trim()) { fail('other changes are already staged; commit or unstage them first'); }
    const stat = git(['diff', '--stat', '--', ...paths], cwd);
    process.stdout.write(stat.out);
    const add = git(['add', '--', ...paths], cwd);
    if (add.code !== 0) { fail(`git add failed: ${add.out.trim()}`); }
    const staged = git(['diff', '--cached', '--name-only', '--', ...paths], cwd);
    if (!staged.stdout.trim()) { fail('nothing staged for the named paths; nothing to commit'); }

    const commit = git(['commit', '-m', message], cwd);
    if (commit.code !== 0) { fail(`git commit failed: ${commit.out.trim()}`); }
    process.stdout.write(git(['status', '--short'], cwd).out);
    process.stdout.write(git(['log', '--oneline', '-1'], cwd).out);
}

main(process.argv.slice(2));
