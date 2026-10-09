const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('./node_modules/typescript');
const { gradeDraft } = require('./evals/webex/graders.cjs');
const cases = require('./evals/webex/cases.json');
assert.equal(cases.length, 10);
for (const testCase of cases) {
    const result = gradeDraft(testCase.goodDraft, testCase);
    for (const [name, pass] of Object.entries(result)) {
        if (name !== 'styleSimilarity') assert.equal(pass, true, `${testCase.id}: ${name}`);
    }
    assert.equal(result.styleSimilarity.status, 'skipped');
}
console.log('PASS good fixture drafts=10 all deterministic graders; styleSimilarity skipped offline');
const testCase = cases[1], good = testCase.goodDraft;
const fail = (name, changes) => {
    assert.equal(gradeDraft({ ...good, ...changes }, testCase)[name], false, `${name} rejects bad draft`);
    console.log(`PASS bad fixture rejected ${name}`);
};
fail('wordCap', { text: `${Array(31).fill('word').join(' ')}? for example, build 42?` });
assert.equal(gradeDraft({ ...good, text: Array(30).fill('word').join(' ') }, testCase).wordCap, true);
fail('hasExample', { text: 'which build failed?' });
for (const phrase of ['I hope this', 'Certainly', 'delve', 'Great question', 'I wanted to reach out', 'Please let me know if']) {
    assert.equal(gradeDraft({ ...good, text: `${phrase} helps` }, testCase).noSlopPhrases, false, phrase);
}
console.log('PASS bad fixture rejected noSlopPhrases all six phrases');
fail('noEmDash', { text: 'build failed — check logs' });
fail('matchesSampleCasing', { text: 'Which build failed? For example, build 42?' });
fail('correctRecipient', { roomId: 'wrong-space' });
fail('correctThread', { parentId: 'wrong-thread' });

const source = fs.readFileSync(path.join(__dirname, 'src/workers/workerProfiles.ts'), 'utf8');
const loaded = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(require, loaded, loaded.exports);
const profile = loaded.exports.parseWorkerProfile(fs.readFileSync(path.join(__dirname, 'worker-profiles/webex.md'), 'utf8'));
assert.equal(profile.model, 'github-copilot/gpt-6.1-sol'); assert.equal(profile.thinking, 'low');
assert.deepEqual(profile.mcp, ['askaway_askaway_webex']);
assert.deepEqual([profile.edit, profile.bash, profile.webfetch], ['deny', 'deny', 'deny']);
for (const rule of ['mine:true', '2-3 other', '30 words', 'Never invent facts', 'draft', 'approval']) assert.ok(profile.prompt.includes(rule), rule);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-webex-profile-'));
const local = path.join(root, 'profiles'), config = path.join(root, 'opencode');
fs.mkdirSync(local); fs.mkdirSync(config);
fs.writeFileSync(path.join(local, 'webex.md'), fs.readFileSync(path.join(__dirname, 'worker-profiles/webex.md'), 'utf8').replaceAll('gpt-6.1-sol', 'old-model'));
const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'tools/sync-worker-profiles.cjs')], {
    encoding: 'utf8', env: { ...process.env, ASKAWAY_WORKER_PROFILES: local, OPENCODE_CONFIG_DIR: config, ASKAWAY_AUTHORING_SKILLS: path.join(root, 'absent') },
});
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /aa-webex/);
assert.equal(fs.readFileSync(path.join(local, 'webex.md'), 'utf8'), fs.readFileSync(path.join(__dirname, 'worker-profiles/webex.md'), 'utf8'));
const agent = fs.readFileSync(path.join(config, 'agents/aa-webex.md'), 'utf8');
assert.match(agent, /"askaway_askaway_webex": allow/);
assert.doesNotMatch(agent, /"askaway_\*": allow/);
console.log('PASS EV-WEBEX-PROMPT-GRADERS profile source installed and agent generated; only Webex MCP allowed; no paid run');
