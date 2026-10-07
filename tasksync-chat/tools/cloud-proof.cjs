// 006 US1 live proof: queue one trivial task to the Copilot cloud agent on an existing PR and record what happens.
// Run (reviewer, on the PR branch, clean tree): node tools/cloud-proof.cjs --pr <n> [--task PROOF-1] [--minutes 59] [--repo-root <PR checkout>]
// Dry run (no git, no GitHub):                  node tools/cloud-proof.cjs --pr <n> --dry-run
// Writes specs/006-cloud-tasks/evidence/proof-<date>.md (skeleton) and test-fixtures/cloud-signals-<date>.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SLUG = '006-cloud-tasks';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const pr = Number(opt('--pr', '0'));
const task = opt('--task', 'PROOF-1');
const minutes = Math.min(59, Number(opt('--minutes', '59')));
const dryRun = args.includes('--dry-run');
const repoRoot = path.resolve(__dirname, '..', '..');
// The PR may live in another repo's checkout; evidence and fixtures stay in this repo.
const prRoot = path.resolve(opt('--repo-root', repoRoot));
const chatRoot = path.resolve(__dirname, '..');

function loadSecretGate() {
    const ts = require(path.join(chatRoot, 'node_modules', 'typescript'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-cloud-proof-'));
    fs.writeFileSync(path.join(dir, 'packet.js'), ts.transpileModule(fs.readFileSync(path.join(chatRoot, 'src', 'cloud', 'packet.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
    return require(path.join(dir, 'packet.js'));
}

function packetFor(taskId, base) {
    const target = `specs/${SLUG}/evidence/proof-target.md`;
    return {
        path: `.askaway/specs/${SLUG}/packets/${taskId}-1.md`,
        text: [
            '---', 'stage: implement', 'story: US1', `task: ${taskId}`, 'draft: false', `base: ${base}`,
            'allowedPaths:', `  - ${target}`,
            'verify:', `  - grep -c "${taskId}" ${target}`,
            'expect: "1"', 'ceilingMinutes: 15',
            'stopCondition: Stop and ask on any undecided behaviour instead of guessing. Stop when verify passes.',
            'reportFormat: |', `  Report ${taskId}`, '  - Result: done | blocked', '  - Commits: <sha list>', '  - Verify output: <last line>', '  - Model: <model name you ran as>',
            '---', '', '## Task details', `- [ ] ${taskId} [cloud] [US1] Append the line "${taskId} done" to ${target}`, '',
            '## Rules', `- Push to this PR's branch only; prefix each commit message with \`[${taskId}]\`.`, '- Change only `allowedPaths`. Do not change any `**Status**:` line.', ''
        ].join('\n')
    };
}

function commentFor(taskId, packetPath, sha, modelHint) {
    return [
        `@copilot Please do ${taskId} (US1, stage implement) of ${SLUG}: follow ${packetPath} at ${sha.slice(0, 7)}.`,
        "Work on this PR's branch only; stay inside allowedPaths; run the packet's verify commands.",
        `Stop and ask on anything undecided; reply using the packet's reportFormat.${modelHint ? ` ${modelHint}` : ''}`
    ].join('\n');
}

function refuseSecrets(fields) {
    const gate = loadSecretGate();
    const findings = gate.secretFindings(fields, gate.knownSecretValues());
    if (findings.length) {
        console.error(`REFUSED: secret detected in ${findings.map(f => `${f.field} (${f.kind})`).join(', ')}`);
        process.exit(3);
    }
}

if (!pr) { console.error('usage: node tools/cloud-proof.cjs --pr <number> [--task PROOF-1] [--dry-run]'); process.exit(2); }

if (dryRun) {
    const p1 = packetFor(task, '<head-after-packet-commit>');
    const p2 = packetFor(`${task}b`, '<head-after-packet-commit>');
    const c1 = commentFor(task, p1.path, '<sha>', 'Please use Claude Sonnet 5.5 for this task.');
    const c2 = commentFor(`${task}b`, p2.path, '<sha>', '');
    refuseSecrets({ packet: p1.text + p2.text, comment: c1 + c2 });
    console.log(`DRY-RUN PR #${pr}\n--- ${p1.path}\n${p1.text}\n--- comment 1\n${c1}\n--- comment 2 (concurrency probe, +60s)\n${c2}`);
    process.exit(0);
}

const git = (...a) => execFileSync('git', a, { cwd: prRoot, encoding: 'utf8' }).trim();
const gh = (...a) => execFileSync('gh', a, { cwd: prRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const ghJson = (...a) => JSON.parse(gh(...a) || 'null');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const trim = (value) => JSON.parse(JSON.stringify(value, (k, v) => (typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v)));

gh('auth', 'status');
const repo = ghJson('repo', 'view', '--json', 'nameWithOwner').nameWithOwner;
const info = ghJson('pr', 'view', String(pr), '--json', 'state,headRefName,headRefOid');
if (info.state !== 'OPEN') { console.error(`REFUSED: PR #${pr} is ${info.state}`); process.exit(2); }
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== info.headRefName) { console.error(`REFUSED: check out ${info.headRefName} first`); process.exit(2); }
if (git('status', '--porcelain')) { console.error('REFUSED: working tree not clean'); process.exit(2); }

const packets = [packetFor(task, info.headRefOid), packetFor(`${task}b`, info.headRefOid)];
refuseSecrets({ packet: packets.map(p => p.text).join('\n') });
for (const p of packets) { fs.mkdirSync(path.dirname(path.join(prRoot, p.path)), { recursive: true }); fs.writeFileSync(path.join(prRoot, p.path), p.text); }
const target = path.join(prRoot, 'specs', SLUG, 'evidence', 'proof-target.md');
if (!fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '# Cloud proof target\n'); }
// -f: packets are meant for the cloud agent even where the repo ignores .askaway/.
git('add', '-f', ...packets.map(p => p.path), path.relative(prRoot, target));
git('commit', '-m', `006 cloud proof: packets ${task}, ${task}b`);
git('push');
const base = git('rev-parse', 'HEAD');
const comments = [commentFor(task, packets[0].path, base, 'Please use Claude Sonnet 5.5 for this task.'), commentFor(`${task}b`, packets[1].path, base, '')];
refuseSecrets({ comment: comments.join('\n') });

const post = (body) => {
    const file = path.join(os.tmpdir(), `askaway-comment-${process.pid}.md`);
    fs.writeFileSync(file, body);
    try { return gh('pr', 'comment', String(pr), '--body-file', file); } finally { fs.rmSync(file, { force: true }); }
};
const startedAt = new Date().toISOString();
const posted = [{ url: post(comments[0]), at: new Date().toISOString() }];
sleep(60000);
posted.push({ url: post(comments[1]), at: new Date().toISOString() });
const commentIds = posted.map(p => (/issuecomment-(\d+)/.exec(p.url) || [])[1]);

const fixture = { pr, repo, base, startedAt, comments: posted.map((p, i) => ({ ...p, id: commentIds[i] })), polls: [] };
const day = startedAt.slice(0, 10);
const fixtureFile = path.join(chatRoot, 'test-fixtures', `cloud-signals-${day}.json`);
for (let i = 0; i < minutes; i++) {
    sleep(60000);
    const head = ghJson('pr', 'view', String(pr), '--json', 'headRefOid').headRefOid;
    const poll = {
        at: new Date().toISOString(),
        reactions: commentIds.filter(Boolean).map(id => ghJson('api', `repos/${repo}/issues/comments/${id}/reactions`)),
        timeline: ghJson('api', `repos/${repo}/issues/${pr}/timeline?per_page=100`),
        commits: ghJson('api', `repos/${repo}/pulls/${pr}/commits?per_page=100`),
        checkRuns: ghJson('api', `repos/${repo}/commits/${head}/check-runs`),
        comments: ghJson('api', `repos/${repo}/issues/${pr}/comments?since=${startedAt}&per_page=100`),
        openPrs: ghJson('pr', 'list', '--state', 'open', '--json', 'number,headRefName,author')
    };
    fixture.polls.push(trim(poll));
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2));
    const reported = poll.comments.filter(c => /^Report /m.test(c.body || '')).length;
    console.log(`${poll.at} poll ${i + 1}: commits=${poll.commits.length} checks=${(poll.checkRuns.check_runs || []).length} reports=${reported}`);
    if (reported >= 2) { break; }
}
const note = path.join(repoRoot, 'specs', SLUG, 'evidence', `proof-${day}.md`);
fs.mkdirSync(path.dirname(note), { recursive: true });
fs.writeFileSync(note, `# Cloud route proof ${day}\n\nPR #${pr} (${repo}), base ${base}. Raw signals: tasksync-chat/test-fixtures/cloud-signals-${day}.json\n\nFill every row of specs/${SLUG}/contracts/evidence-note.md from the fixture; no "unknown".\n`);
console.log(`DONE fixture=${path.relative(repoRoot, fixtureFile)} note=${path.relative(repoRoot, note)}`);
