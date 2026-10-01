#!/usr/bin/env node
// Read-only spec facts for every extension flow (/sk.continue, /sk.handoff, /pr-daily, wrappers).
// Uses the SAME scanner as the Specs tab (src/specs/specKitScanner.ts), so stage/next step never disagree.
// Run: node tasksync-chat/tools/spec-facts.cjs [<slug>|<NNN>] [--json] [--root <workspace>]
// Exit 2: no active feature / unknown spec. Never writes, never prints prompt text.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const chatDir = path.resolve(__dirname, '..');
const ts = require(path.join(chatDir, 'node_modules', 'typescript'));

// Load the TypeScript sources in memory (no build output, no files written).
Module._extensions['.ts'] = (module, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText;
    module._compile(output, filename);
};
const { scanSpecs } = require(path.join(chatDir, 'src', 'specs', 'specKitScanner.ts'));
const { readRunRecords } = require(path.join(chatDir, 'src', 'specs', 'runRecords.ts'));

const args = process.argv.slice(2);
const json = args.includes('--json');
const rootIndex = args.indexOf('--root');
const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] || '' : process.cwd());
const positional = args.filter((arg, i) => !arg.startsWith('--') && (rootIndex < 0 || i !== rootIndex + 1));
const wanted = positional[0];

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(2);
}

function findSpec(scan) {
    if (wanted === undefined) {
        if (!scan.activeSlug) { fail('no active feature; pass a slug'); }
        return scan.specs.find(spec => spec.slug === scan.activeSlug) || fail(`unknown spec: ${scan.activeSlug}`);
    }
    const byNumber = /^\d+$/.test(wanted) ? scan.specs.find(spec => spec.id && Number(spec.id) === Number(wanted)) : undefined;
    return scan.specs.find(spec => spec.slug === wanted) || byNumber || fail(`unknown spec: ${wanted}`);
}

function storyCheckpoints(slug) {
    const latest = new Map();
    for (const rec of readRunRecords(root, slug).records) {
        if (rec.story && rec.checkpoint) {
            latest.set(rec.story, { result: rec.checkpoint.result, scs: rec.checkpoint.scs.map(sc => ({ id: sc.id, result: sc.result })) });
        }
    }
    return latest;
}

function factsOf(spec) {
    const checkpoints = storyCheckpoints(spec.slug);
    return {
        slug: spec.slug,
        storedStage: spec.specKitStage,
        stageSource: spec.stageSource,
        impliedStage: spec.impliedStage,
        mismatch: spec.mismatch,
        nextStep: spec.nextStep,
        stageButton: spec.stageButton,
        stale: spec.stale,
        branch: spec.facts.branch || spec.branch || null,
        activePr: spec.facts.pr || spec.pullRequestUrl || null,
        costAiu: Number((spec.facts.costNanoAiu / 1e9).toFixed(4)),
        agentMinutes: Math.round(spec.facts.agentMs / 60000),
        runs: spec.facts.runs,
        skippedRecords: spec.facts.skippedRecords,
        stories: spec.stories.map(story => ({
            id: story.id, done: story.done, total: story.total,
            independentTest: story.independentTest, checkpoint: checkpoints.get(story.id) || null
        })),
        readiness: spec.facts.lastReadiness
    };
}

const facts = factsOf(findSpec(scanSpecs(root)));
if (json) {
    process.stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
} else {
    const lines = [`${facts.slug} · stage ${facts.storedStage} · next ${facts.nextStep}`];
    if (facts.mismatch) { lines.push(`mismatch: stored ${facts.mismatch.stored}, implied ${facts.mismatch.implied} — ${facts.mismatch.reason}`); }
    for (const entry of facts.stale) { lines.push(`stale: ${entry.artifact} older than ${entry.upstream} (${entry.reason})`); }
    process.stdout.write(`${lines.join('\n')}\n`);
}
