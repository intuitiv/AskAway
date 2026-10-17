// R-DOCS-02 / R-RELEASE-01: the README GIFs exist and are sane, and the package ships what a consumer on the newest
// VS Code needs (hooks, skills, prompts, profiles, bundle) without test output or screenshots. Run: node test-release-readiness.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const repo = path.join(root, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// README GIFs: linked from both READMEs, real GIF files, small enough for a Marketplace page.
const gifs = ['workers-flow.gif', 'aitalk-live.gif', 'team-tab.gif'];
for (const [readme, base] of [['README.md', 'tasksync-chat/docs/screenshots/'], ['tasksync-chat/README.md', 'https://raw.githubusercontent.com/intuitiv/TaskSync/main/tasksync-chat/docs/screenshots/']]) {
    const text = fs.readFileSync(path.join(repo, readme), 'utf8');
    for (const gif of gifs) { assert.ok(text.includes(`](${base}${gif})`), `${readme} shows ${gif}`); }
}
for (const gif of gifs) {
    const file = path.join(root, 'docs', 'screenshots', gif);
    const bytes = fs.readFileSync(file);
    assert.match(bytes.subarray(0, 6).toString('latin1'), /^GIF8[79]a$/, `${gif} is a GIF`);
    assert.ok(bytes.length > 100 * 1024 && bytes.length < 4 * 1024 * 1024, `${gif} is ${(bytes.length / 1048576).toFixed(2)} MB (want 0.1-4 MB)`);
    assert.ok(bytes.readUInt16LE(6) >= 300, `${gif} is at least 300px wide`);
}

// Package contents (what a consumer installs).
const listing = childProcess.spawnSync('npx', ['--no-install', 'vsce', 'ls'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
assert.equal(listing.status, 0, listing.stderr);
const files = listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
assert.ok(files.length < 400, `the package has ${files.length} files; test output leaked in`);
for (const required of ['package.json', 'README.md', 'dist/extension.js', 'hooks/spec-context-inject.cjs', 'hooks/compact-chat-capture.cjs', 'media/main.css', 'media/webview.js', 'media/team/team.css']) {
    assert.ok(files.includes(required), `the package ships ${required}`);
}
for (const entry of [...pkg.contributes.chatSkills, ...pkg.contributes.chatPromptFiles]) {
    assert.ok(files.includes(entry.path.replace(/^\.\//, '')), `the package ships contributed ${entry.path}`);
}
assert.ok(files.some((file) => file.startsWith('worker-profiles/')), 'the package ships the worker profiles');
for (const banned of [/^build\//, /^\.webex-cache\//, /^test-/, /^\.test-fixtures\//, /^test-fixtures\//, /^storybook\//, /^docs\/screenshots\//, /\.vsix$/, /^src\//]) {
    assert.ok(!files.some((file) => banned.test(file)), `the package must not ship ${banned}`);
}
assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'the version is plain semver');
const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
assert.ok(changelog.includes(`## AskAway v${pkg.version} `), `CHANGELOG has a section for v${pkg.version}`);
assert.ok(!/^## Unreleased/m.test(changelog), 'no Unreleased heading remains once the release section exists');
console.log(`PASS EV-RELEASE-READINESS version=${pkg.version} files=${files.length} gifs=3 contributed=${pkg.contributes.chatSkills.length + pkg.contributes.chatPromptFiles.length}`);
