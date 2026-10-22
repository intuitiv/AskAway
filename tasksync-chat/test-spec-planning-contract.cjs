const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assetSource = fs.readFileSync(path.join(__dirname, 'src/specs/specKitPromptAssets.ts'), 'utf8');
const promptExports = {};
vm.runInNewContext(ts.transpileModule(assetSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, { exports: promptExports });
const { SPEC_KIT_PROMPTS, CLAUDE_SPEC_KIT_COMMANDS } = promptExports;

for (const [name, text] of Object.entries({ ...SPEC_KIT_PROMPTS, ...CLAUDE_SPEC_KIT_COMMANDS })) {
    assert.doesNotMatch(text, /CY-|PAC-|CAC-/, `${name} has no custom cycle or phase demands`);
}

const contracts = [
    ['Copilot plan', SPEC_KIT_PROMPTS['sk.plan.prompt.md']],
    ['Claude plan', CLAUDE_SPEC_KIT_COMMANDS['sk.plan.md']]
];
for (const [name, text] of contracts) {
    assert.match(text, /Decision Register/i, `${name} requires a Decision Register`);
    assert.match(text, /Cloud Worker Packet/i, `${name} requires a Cloud Worker Packet`);
    assert.match(text, /without chat history|without this chat history/i, `${name} is standalone`);
    assert.match(text, /NEEDS CLARIFICATION/i, `${name} stops on new questions`);
    assert.match(text, /explicit (?:base )?commit|commit, tag or remote ref/i, `${name} requires an explicit worker base`);
    assert.match(text, /never infer/i, `${name} separates branch identities`);
    assert.match(text, /\.specify\/templates\/plan-template\.md/, `${name} delegates structure to the plan template`);
    assert.match(text, /Given\/When\/Then/, `${name} plans around story scenarios`);
}

for (const [name, text] of [
    ['Copilot check', SPEC_KIT_PROMPTS['sk.check.prompt.md']],
    ['Claude check', CLAUDE_SPEC_KIT_COMMANDS['sk.check.md']]
]) {
    assert.match(text, /Open Question/i, `${name} detects open questions`);
    assert.match(text, /up to five/i, `${name} asks a bounded question batch`);
    assert.match(text, /Decision Register/i, `${name} records technical answers`);
    assert.match(text, /strictly read-only/i, `${name} diagnosis cannot write`);
    assert.match(text, /before the user answers|before.*approves/i, `${name} requires approval before writers`);
    assert.match(text, /Story.*Tasks.*Finding/i, `${name} reports the story hierarchy`);
    assert.match(text, /Cross-cutting\s*\/\s*Unassigned/i, `${name} preserves unmapped findings`);
    assert.match(text, /blocked dependents/i, `${name} reports blocking impact`);
    assert.match(text, /story dependencies/i, `${name} validates story dependencies`);
    assert.match(text, /AC-TNNN/i, `${name} checks task assertions`);
}

for (const [name, text] of [
    ['Copilot tasks', SPEC_KIT_PROMPTS['sk.tasks.prompt.md']],
    ['Copilot implement', SPEC_KIT_PROMPTS['sk.implement.prompt.md']],
    ['Claude tasks', CLAUDE_SPEC_KIT_COMMANDS['sk.tasks.md']],
    ['Claude implement', CLAUDE_SPEC_KIT_COMMANDS['sk.implement.md']]
]) {
    assert.match(text, /Decision Register/i, `${name} enforces plan readiness`);
    assert.match(text, /Cloud Worker Packet/i, `${name} supports portable delegation`);
    assert.match(text, /chat history/i, `${name} forbids hidden conversation dependency`);
    assert.match(text, /\.specify\/templates\/tasks-template\.md/, `${name} follows the standard task template`);
}

for (const [name, text] of [
    ['Copilot tasks', SPEC_KIT_PROMPTS['sk.tasks.prompt.md']],
    ['Claude tasks', CLAUDE_SPEC_KIT_COMMANDS['sk.tasks.md']]
]) {
    assert.match(text, /Setup, Foundational, one phase per \[USn\].*then Polish/, `${name} groups tasks by the standard story structure`);
    assert.match(text, /Independent Test \+ Checkpoint/, `${name} requires independently testable story checkpoints`);
    assert.match(text, /parallel work \[P\]/, `${name} uses the standard parallel marker`);
}

for (const [name, text] of [
    ['Copilot check', SPEC_KIT_PROMPTS['sk.check.prompt.md']],
    ['Claude check', CLAUDE_SPEC_KIT_COMMANDS['sk.check.md']]
]) {
    assert.match(text, /backfill-ac/i, `${name} exposes explicit AC backfill`);
    assert.match(text, /exactly one|one selected\/active spec/i, `${name} scopes backfill to one spec`);
    assert.match(text, /unchecked/i, `${name} targets open tasks`);
    assert.match(text, /never (?:touch|modify) completed/i, `${name} preserves completed tasks`);
    assert.match(text, /Backfill AC for these open items\? \(yes\/no\)/i, `${name} asks before backfill`);
    assert.match(text, /read-only until.*yes|do not write until.*yes/i, `${name} waits for backfill approval`);
    assert.match(text, /Assert.*Verify.*Expected/is, `${name} backfills executable acceptance fields`);
    assert.match(text, /non-vacuous|nonzero|artifact predicate/i, `${name} backfills execution proof`);
}

for (const [name, text] of [
    ['Copilot tasks', SPEC_KIT_PROMPTS['sk.tasks.prompt.md']],
    ['Claude tasks', CLAUDE_SPEC_KIT_COMMANDS['sk.tasks.md']]
]) {
    assert.match(text, /short plain-language task titles/i, `${name} keeps task titles readable`);
    assert.match(text, /direct-agent-ready/i, `${name} marks directly delegable work`);
    assert.match(text, /eligibility.*(?:never|not) approval|eligibility, not approval/i, `${name} does not auto-approve direct work`);
}

for (const [name, text] of [
    ['Copilot implement', SPEC_KIT_PROMPTS['sk.implement.prompt.md']],
    ['Claude implement', CLAUDE_SPEC_KIT_COMMANDS['sk.implement.md']]
]) {
    assert.match(text, /Check off a task only after its verification passes/, `${name} requires evidence before task completion`);
    assert.match(text, /Independent Test.*Given\/When\/Then.*success metrics/, `${name} verifies the story checkpoint`);
    assert.match(text, /zero matched tests is failure/, `${name} rejects vacuous verification`);
    assert.match(text, /observable assertion, verification command, and exact expected result/, `${name} requires observable evidence`);
}

const extensionSource = fs.readFileSync(path.join(__dirname, 'src/agents/askawayBuildAgent.ts'), 'utf8');
const claudeAssetSource = assetSource;
for (const [name, text] of [['Copilot agent', extensionSource], ['Claude agent', claudeAssetSource]]) {
    assert.match(text, /implementation intent.*internally route.*\/sk\.implement/is, `${name} routes natural-language implementation`);
    assert.match(text, /does not require the user to retype a slash command/i, `${name} routing is implicit`);
}
assert.match(extensionSource, /^tools:.*intuitiv\.askaway\/aitalk/m, 'Copilot agent can post AITalk updates (mirrored to Telegram)');
assert.match(extensionSource, /## Commentary[\s\S]*mirrored live to Telegram/, 'Copilot agent is told to post commentary');

const webviewSource = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
assert.match(webviewSource, /Agent throughput/, 'UI labels attributed delivery as agent throughput');
assert.match(webviewSource, /Excludes human waiting, manual work, and untracked user activity/, 'UI excludes user productivity from throughput');
assert.doesNotMatch(webviewSource, />Workspace velocity</, 'UI no longer calls agent throughput workspace velocity');

const webexPlan = fs.readFileSync(path.join(__dirname, '../specs/009-webex-remote-channel/plan.md'), 'utf8');
const webexResearch = fs.readFileSync(path.join(__dirname, '../specs/009-webex-remote-channel/research.md'), 'utf8');
for (const section of ['Summary', 'Technical Context', 'Constitution Check', 'Decision Register', 'Cloud Worker Packet', 'Verification']) assert.ok(webexPlan.includes(`## ${section}`), `Webex plan misses ${section}`);
for (const caller of ['remoteChannel.ts', 'telegramLive.ts', 'handoffNotifier.ts', 'cloudDigest.ts', 'webviewProvider.ts', 'share-with-me']) assert.ok(webexPlan.includes(caller), `Webex migration omits caller ${caller}`);
for (const rule of ['Personal-token self-posts never notify', 'Webex has no long-poll API', 'posted/processed IDs', 'ASKAWAY_WEBEX_LIVE=1', 'US5']) assert.ok(webexResearch.includes(rule), `Webex research omits ${rule}`);
assert.match(webexPlan, /Given[\s\S]*When[\s\S]*Then/);
assert.ok(webexPlan.includes('4068059') && webexPlan.includes('src/services/**'), 'explicit base and actual source scope required');
// R-SKFLOW-26: /sk.handoff leaves the next conversation everything it needs, and still calls no tools.
for (const [name, text] of [['Copilot handoff', SPEC_KIT_PROMPTS['sk.handoff.prompt.md']], ['Claude handoff', CLAUDE_SPEC_KIT_COMMANDS['sk.handoff.md']]]) {
    for (const section of ['Where we are', 'Done', 'Assumptions', 'Decisions and rules in force', 'Learnings', 'Observations', 'Not finished', 'Pick up next']) {
        assert.ok(text.includes(`**${section}**`), `${name} has the ${section} section`);
    }
    assert.match(text, /Do not call tools or edit files/, `${name} stays a no-tool checkpoint`);
    assert.match(text, /none for an empty section|"none" for an empty section/, `${name} says what to write for an empty section`);
    assert.match(text, /without (?:the )?history|none of this chat's history/i, `${name} is written for a reader with no history`);
    assert.ok(text.indexOf('**Done**') < text.indexOf('**Assumptions**') && text.indexOf('**Learnings**') < text.indexOf('**Pick up next**'), `${name} sections are in order`);
}
const handoffFrontmatter = SPEC_KIT_PROMPTS['sk.handoff.prompt.md'].split('---')[1];
assert.ok(!/^description:.*: /m.test(handoffFrontmatter), 'the description has no colon that would break the YAML');
console.log('PASS EV-WEBEX-MIGRATION-PLAN callers=6 rules=5 explicit base/scope, decisions and story scenarios');
console.log('PASS story-structured no-CY/PAC/CAC planning contract for Copilot and Claude');
