// Harness benchmark runner: fresh isolated workspace per run, headless OpenCode main agent, hidden grading,
// spend caps ($2 per configuration run, $5 per invocation), one appended result row per run.
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { gradeBenchmark } = require('../graders.cjs');
const { createUsage } = require('./usage.cjs');

const ROOT = __dirname;
const FIXTURE = path.join(ROOT, 'fixture');
const HIDDEN = path.join(ROOT, 'hidden');
const LEVELS = ['simple', 'medium', 'complex', 'batch'];
// Under /tmp, where worker edits are allowed; $TMPDIR falls under the global edit "ask" rule and is auto-rejected headless.
const DEFAULT_WORK_ROOT = '/tmp/aa-evals/benchmark';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
// `~/` is the user's home; other relative prompt files resolve against this benchmark directory.
const home = (file) => (file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : path.resolve(ROOT, file));

function filesUnder(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(full, base) : [path.relative(base, full)];
    });
}

/** sha256 of fixture/, tasks.json and hidden/ (research D7): any change to them is a new benchmark version. */
function benchmarkVersion() {
    const hash = crypto.createHash('sha256');
    for (const [label, dir] of [['fixture', FIXTURE], ['hidden', HIDDEN]]) {
        for (const file of filesUnder(dir)) { hash.update(`${label}/${file}\0`).update(fs.readFileSync(path.join(dir, file))).update('\0'); }
    }
    hash.update(fs.readFileSync(path.join(ROOT, 'tasks.json')));
    return hash.digest('hex');
}

function loadBenchmark() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmark.json'), 'utf8'));
    const { tasks, levels: levelPrompts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks.json'), 'utf8'));
    return { manifest, tasks, levelPrompts, version: benchmarkVersion() };
}

/** Configuration identity (FR-003): main agent prompt × harness × model mix, hashed into configId. */
function configuration(spec, manifest) {
    const base = typeof spec === 'string' ? manifest.configurations[spec] : spec;
    if (!base) { throw new Error(`unknown configuration: ${spec}`); }
    let promptHash = base.promptHash || '';
    if (!promptHash && base.promptFile) { try { promptHash = sha256(fs.readFileSync(home(base.promptFile))); } catch { promptHash = ''; } }
    const identity = { mainAgent: base.mainAgent, promptHash, harness: base.harness || 'opencode', modelMix: { main: base.model, workers: base.workers || {} } };
    return { name: typeof spec === 'string' ? spec : base.name || base.mainAgent, agent: base.agent || `aa-${base.mainAgent}`, configuration: identity, configId: sha256(JSON.stringify(identity)) };
}

/** A fresh git-initialised copy of the fixture; hidden checks are never part of it. */
function prepareWorkspace(workRoot, runId) {
    fs.mkdirSync(workRoot, { recursive: true });
    const dir = path.join(workRoot, `run-${runId}`);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const git = (...a) => childProcess.spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.email=bench@askaway', '-c', 'user.name=bench', 'commit', '-qm', 'benchmark fixture');
    return dir;
}

function levelPrompt(level, tasks, levelPrompts) {
    const own = tasks.filter((t) => t.level === level);
    const lines = own.length > 1 ? own.map((t, i) => `${i + 1}. ${t.prompt}`) : own.map((t) => t.prompt);
    return `${levelPrompts[level]}\n\n${lines.join('\n')}`;
}

/** Real spawner: `opencode run --agent <main>` attached to the shared server; kill() ends the whole process group. */
function opencodeSpawner({ agent, model, prompt, dir, attach, title }) {
    const argv = ['run', '--print-logs', '--log-level', 'ERROR', '--format', 'json', '--agent', agent, '--model', model, '--dir', dir, '--title', title];
    if (attach) { argv.push('--attach', attach); }
    argv.push(prompt);
    const child = childProcess.spawn('opencode', argv, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = readline.createInterface({ input: child.stdout });
    return {
        events: (async function* parse() {
            for await (const line of lines) { try { yield JSON.parse(line); } catch { /* not an event */ } }
        })(),
        kill() { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } },
    };
}

function opencodeModelAvailable(model) {
    const result = childProcess.spawnSync('opencode', ['models'], { encoding: 'utf8', timeout: 60000 });
    return (result.stdout || '').split('\n').some((line) => line.trim() === model);
}

function money(d) { return d === null ? 'unavailable' : d.toFixed(4); }

function benchmarkLine(version, row) {
    const n = row.tasks.length;
    const k = row.tasks.filter((t) => t.outcome === 'accepted').length;
    // Same gate and Score as the scoreboard and the live banner (scoreboard.cjs loads them from media/webview.js).
    const score = require('./scoreboard.cjs').webviewFunctions().benchmarkScoreLabel(row);
    return `BENCHMARK ${version.slice(0, 12)} config=${row.configId.slice(0, 12)} status=${row.status} accepted=${k}/${n} cost=$${money(row.usage.dollars)} score=${score}`;
}

/**
 * Runs each configuration `repeat` times. Options: configs (names or objects), spawner, modelAvailable, workRoot,
 * resultsFile, levels, repeat, attach, log, capUsd, totalCapUsd. Returns { rows, spent }.
 */
async function runBenchmark(options) {
    const { manifest, tasks, levelPrompts, version } = loadBenchmark();
    const spawner = options.spawner || opencodeSpawner;
    const modelAvailable = options.modelAvailable || opencodeModelAvailable;
    const workRoot = options.workRoot || DEFAULT_WORK_ROOT;
    const capUsd = Math.min(options.capUsd ?? manifest.spendCapUsd, manifest.spendCapUsd);
    const totalCapUsd = Math.min(options.totalCapUsd ?? manifest.totalSpendCapUsd, manifest.totalSpendCapUsd);
    const levels = options.levels || LEVELS;
    const log = options.log || console.log;
    const rows = [];
    let spent = 0;
    for (const spec of options.configs) {
        const config = configuration(spec, manifest);
        for (let r = 0; r < (options.repeat || 1); r++) {
            const runId = crypto.randomUUID();
            const selected = tasks.filter((t) => levels.includes(t.level));
            const usage = createUsage();
            const row = { suite: 'benchmark', runId, benchmarkVersion: version, pricingBasis: manifest.pricingBasis, configId: config.configId,
                configuration: config.configuration, startedAt: new Date().toISOString(), status: 'completed', stopReason: null, tasks: [], usage: null };
            const remaining = totalCapUsd - spent;
            const skipReason = remaining <= 0 ? `total spend cap $${totalCapUsd}` : !(await modelAvailable(config.configuration.modelMix.main)) ? 'model unavailable' : '';
            if (skipReason) {
                Object.assign(row, { status: 'skipped', stopReason: skipReason, tasks: selected.map((t) => ({ id: t.id, level: t.level, outcome: 'skipped', failedChecks: [] })) });
            } else {
                const cap = Math.min(capUsd, remaining);
                const dir = prepareWorkspace(workRoot, runId);
                const finished = [];
                for (const level of levels) {
                    const handle = await spawner({ agent: config.agent, model: config.configuration.modelMix.main, prompt: levelPrompt(level, tasks, levelPrompts),
                        dir, attach: options.attach, title: `benchmark/${config.name}/${level}` });
                    for await (const event of handle.events) {
                        usage.add(event);
                        if (event?.type === 'step_finish' && usage.spent() >= cap) {
                            handle.kill();
                            row.status = 'interrupted';
                            row.stopReason = cap < capUsd ? `total spend cap $${totalCapUsd}` : `spend cap $${capUsd}`;
                            break;
                        }
                    }
                    if (row.status === 'interrupted') { break; }
                    finished.push(level);
                }
                // Hidden checks run against a separate copy, so the agent's workspace never holds them (research D1).
                const gradeDir = `${dir}-grade`;
                fs.cpSync(dir, gradeDir, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
                const graded = new Map(gradeBenchmark(selected.filter((t) => finished.includes(t.level)), gradeDir, HIDDEN).map((g) => [g.id, g]));
                row.tasks = selected.map((t) => graded.get(t.id) || { id: t.id, level: t.level, outcome: 'interrupted', failedChecks: [] });
                fs.rmSync(dir, { recursive: true, force: true });
                fs.rmSync(gradeDir, { recursive: true, force: true });
            }
            row.usage = usage.result();
            spent += usage.spent();
            fs.mkdirSync(path.dirname(options.resultsFile), { recursive: true });
            fs.appendFileSync(options.resultsFile, `${JSON.stringify(row)}\n`);
            log(benchmarkLine(version, row));
            rows.push(row);
        }
    }
    log(`BENCHMARK done runs=${rows.length} cost=$${spent.toFixed(4)} results=${options.resultsFile}`);
    return { rows, spent };
}

module.exports = { LEVELS, FIXTURE, HIDDEN, benchmarkVersion, loadBenchmark, configuration, prepareWorkspace, levelPrompt, runBenchmark, filesUnder };
