// Live eval runner for AskAway workers and the orchestrator.
//   node evals/run-evals.cjs --suite workers [--case a,b] [--mode m] [--model id] [--variant v] --live
//   node evals/run-evals.cjs --suite orchestrator [--case a] [--model id] --live
// Without --live it lists what would run and makes no provider request. Results append to ~/.askaway/evals/results.jsonl.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { parseEvents, gradeWorker, gradePlan } = require('./graders.cjs');

const HOME = os.homedir();
const RESULTS = path.join(HOME, '.askaway', 'evals', 'results.jsonl');
const PROFILE_DIR = path.join(HOME, '.askaway', 'worker-profiles');
const ORCHESTRATOR_PROMPT = path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'prompts', 'AA.Orchestrator.agent.md');
const AGENTS_DIR = path.join(HOME, '.config', 'opencode', 'agents');
const TIMEOUT_MS = 240000;

function args() {
    const out = { suite: 'workers', live: false };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (key === 'live') { out.live = true; } else { out[key] = argv[++i]; }
    }
    return out;
}

function loadProfiles() {
    const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-evals-'));
    const file = path.join(dir, 'workerProfiles.js');
    fs.writeFileSync(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', 'workers', 'workerProfiles.ts'), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
    const profiles = require(file).loadWorkerProfiles(PROFILE_DIR);
    fs.rmSync(dir, { recursive: true, force: true });
    return Object.fromEntries(profiles.map((p) => [p.name, p]));
}

function portOpen(port) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
    });
}

async function unmetRequirement(requires = []) {
    for (const need of requires) {
        if (need === 'authoring' && !(await portOpen(8090))) { return 'authoring MCP not listening on :8090'; }
        if (need === 'devx' && !fs.existsSync(path.join(HOME, 'VSProjects', 'pega-launchpad-configuration', 'lp-devx-cli', 'mcp', 'server.mjs'))) { return 'devx MCP server missing'; }
        if (need === 'gradle' && !fs.existsSync(path.join(HOME, 'VSProjects', 'model-calculation-service-app-logic', 'gradlew'))) { return 'gradle reference project missing'; }
        if (need === 'network' && process.env.ASKAWAY_EVALS_OFFLINE) { return 'offline'; }
    }
    return '';
}

function sh(command, cwd) {
    return childProcess.spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 60000 });
}

function makeFixture(suite, testCase) {
    // Under /tmp, where worker edits are allowed; $TMPDIR falls under the global edit "ask" rule and is auto-rejected headless.
    fs.mkdirSync('/tmp/aa-evals', { recursive: true });
    const dir = fs.mkdtempSync(path.join('/tmp/aa-evals', `${testCase.id}-`));
    for (const [name, text] of Object.entries(suite.fixture)) { fs.writeFileSync(path.join(dir, name), text); }
    if (testCase.setup === 'fixed' || testCase.setup === 'hack') { fs.writeFileSync(path.join(dir, 'math.js'), suite.fixedMath); }
    sh('git init -q && git add -A && git -c user.email=eval@askaway -c user.name=eval commit -qm fixture', dir);
    if (testCase.setup === 'hack') {
        // A fix that only satisfies the one asserted input: the reviewer must flag it.
        fs.writeFileSync(path.join(dir, 'math.js'), suite.fixture['math.js'].replace('return a - b;', 'if (a === 2 && b === 3) { return 5; }\n    return a - b;'));
    }
    return dir;
}

function changedFiles(dir) {
    return sh('git status --porcelain', dir).stdout.split('\n').filter(Boolean).map((line) => line.slice(3).trim());
}

function dispatch(agent, model, variant, dir, title, packet) {
    const started = Date.now();
    // --print-logs is required: without it `opencode run` was SIGKILLed at ~14s (2/2 runs), with it 3/3 completed.
    const result = childProcess.spawnSync('opencode', ['run', '--print-logs', '--log-level', 'ERROR', '--format', 'json',
        '--agent', agent, '--model', model, '--variant', variant, '--dir', dir, '--title', title, packet],
    { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    const run = parseEvents(result.stdout || '');
    if (result.error) { run.errors.push(String(result.error.message)); }
    if (result.signal) { run.errors.push(`signal ${result.signal}`); }
    run.durationMs = Date.now() - started;
    return run;
}

function sha(file) {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12); } catch { return ''; }
}

function record(row) {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.appendFileSync(RESULTS, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

function report(suite, id, verdict, row) {
    const failed = (row.checks || []).filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? `(${c.detail})` : ''}`);
    const usage = row.usage ? ` cost=$${row.usage.cost.toFixed(4)} in=${row.usage.input} out=${row.usage.output} cacheRead=${row.usage.cacheRead} ${row.durationMs}ms` : '';
    console.log(`EVAL ${suite}/${id} ${verdict} model=${row.model || '-'}${usage}${failed.length ? ` failed=[${failed.join('; ')}]` : ''}${row.skipReason ? ` reason=${row.skipReason}` : ''}`);
}

function pick(cases, opts) {
    const ids = opts.case ? opts.case.split(',') : undefined;
    return cases.filter((c) => (!ids || ids.includes(c.id)) && (!opts.mode || c.mode === opts.mode));
}

async function runWorkers(opts, profiles, totals) {
    const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'worker-cases.json'), 'utf8'));
    for (const testCase of pick(suite.cases, opts)) {
        const profile = profiles[testCase.mode];
        const model = opts.model || profile.model;
        const variant = opts.variant || profile.thinking;
        const base = { suite: 'workers', case: testCase.id, mode: testCase.mode, model, variant, promptHash: sha(path.join(PROFILE_DIR, `${testCase.mode}.md`)) };
        const skipReason = await unmetRequirement(testCase.requires);
        if (skipReason || !opts.live) {
            const row = { ...base, verdict: 'SKIP', skipReason: skipReason || 'pass --live to spend provider credits' };
            if (opts.live) { record(row); }
            report('workers', testCase.id, 'SKIP', row);
            totals.skip++;
            continue;
        }
        const dir = makeFixture(suite, testCase);
        // Baseline so readOnly measures only what the worker changed, not planted fixture state.
        const before = new Map(changedFiles(dir).map((file) => [file, sha(path.join(dir, file))]));
        const run = dispatch(`aa-${testCase.mode}`, model, variant, dir, `eval/${testCase.id}`, testCase.packet);
        const post = testCase.grade?.postCheck ? sh(testCase.grade.postCheck.command, dir) : undefined;
        const touched = changedFiles(dir).filter((file) => !before.has(file) || before.get(file) !== sha(path.join(dir, file)));
        const graded = gradeWorker(testCase, run, { changedFiles: touched, postCheckOutput: post ? `${post.stdout}${post.stderr}` : '' });
        const row = { ...base, verdict: graded.pass ? 'PASS' : 'FAIL', checks: graded.checks, usage: run.usage, durationMs: run.durationMs, sessionId: run.sessionId, tools: run.tools };
        record(row);
        report('workers', testCase.id, row.verdict, row);
        totals[graded.pass ? 'pass' : 'fail']++;
        totals.cost += run.usage.cost;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const PLAN_SCHEMA = `{"goal":"...","tracks":[{"id":"T1","name":"...","parallel":true,"packets":[{"id":"p1","mode":"<mode>","model":"<provider/model>","thinking":"<variant>","reason":"<why this tier>","objective":"...","assertion":"...","expected":"<exact result>","command":"<verification command>","dependsOn":[],"verifyBy":"<id of the verify packet, required for code/test/authoring/devx>"}]}]}`;

function installOrchestratorEvalAgent(model) {
    const source = fs.readFileSync(ORCHESTRATOR_PROMPT, 'utf8').replace(/^---[\s\S]*?---\n/, '');
    const body = `${source}\n\n## EVAL MODE\nThis is a planning evaluation. Do NOT dispatch, run, or read anything. Reply with ONLY one JSON object in a \`\`\`json fence, matching this schema exactly:\n${PLAN_SCHEMA}\n`;
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(AGENTS_DIR, 'aa-orchestrator-eval.md'),
        `---\ndescription: "Planning-only evaluation harness for AA.Orchestrator."\nmode: primary\nmodel: ${model}\nsteps: 3\npermission:\n  edit: deny\n  bash: deny\n  webfetch: deny\n  task: deny\n  skill: deny\n  read: deny\n  glob: deny\n  grep: deny\n---\n\n${body}`);
}

async function runOrchestrator(opts, profiles, totals) {
    const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'orchestrator-cases.json'), 'utf8'));
    const model = opts.model || 'github-copilot/claude-opus-5.5';
    const variant = opts.variant || 'high';
    if (opts.live) { installOrchestratorEvalAgent(model); }
    for (const testCase of pick(suite.cases, opts)) {
        const base = { suite: 'orchestrator', case: testCase.id, model, variant, promptHash: sha(ORCHESTRATOR_PROMPT) };
        if (!opts.live) {
            report('orchestrator', testCase.id, 'SKIP', { ...base, skipReason: 'pass --live to spend provider credits' });
            totals.skip++;
            continue;
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aa-eval-orch-${testCase.id}-`));
        const run = dispatch('aa-orchestrator-eval', model, variant, dir, `eval/${testCase.id}`, `Goal: ${testCase.goal}`);
        const graded = gradePlan(testCase, run.finalText, profiles);
        const pass = graded.pass && run.errors.length === 0;
        const row = { ...base, verdict: pass ? 'PASS' : 'FAIL', checks: graded.checks, usage: run.usage, durationMs: run.durationMs, sessionId: run.sessionId,
            tracks: graded.plan?.tracks?.length || 0, packets: graded.plan?.tracks?.flatMap((t) => t.packets || []).length || 0 };
        record(row);
        report('orchestrator', testCase.id, row.verdict, row);
        totals[pass ? 'pass' : 'fail']++;
        totals.cost += run.usage.cost;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

(async () => {
    const opts = args();
    const profiles = loadProfiles();
    const totals = { pass: 0, fail: 0, skip: 0, cost: 0 };
    if (opts.suite === 'orchestrator') { await runOrchestrator(opts, profiles, totals); } else { await runWorkers(opts, profiles, totals); }
    console.log(`EVALS ${opts.suite}: pass=${totals.pass} fail=${totals.fail} skip=${totals.skip} cost=$${totals.cost.toFixed(4)} results=${RESULTS}`);
})().catch((error) => { console.error(error); process.exit(2); });
