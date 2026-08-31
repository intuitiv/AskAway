const assert = require('node:assert/strict');
const fs = require('node:fs');
const { SPEC_KIT_PROMPTS, CLAUDE_SPEC_KIT_COMMANDS } = require('/tmp/askaway-spec-prompts.cjs');

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
    assert.match(text, /incremental waterfall/i, `${name} uses incremental waterfall phases`);
    assert.match(text, /PAC-PNN/i, `${name} defines phase acceptance assertions`);
    assert.match(text, /AC-TNNN/i, `${name} defines task acceptance assertions`);
    assert.match(text, /integrated.*(?:demonstrable|reviewable) increment/i, `${name} delivers value within phases`);
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
    assert.match(text, /Phase.*Cycle.*Tasks.*Finding/i, `${name} reports the work hierarchy`);
    assert.match(text, /Cross-cutting\s*\/\s*Unassigned/i, `${name} preserves unmapped findings`);
    assert.match(text, /blocked phase|blocked.*cycle/i, `${name} reports blocking impact`);
    assert.match(text, /incremental waterfall/i, `${name} validates the waterfall contract`);
    assert.match(text, /PAC-PNN/i, `${name} checks phase assertions`);
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
    assert.match(text, /incremental.waterfall/i, `${name} enforces waterfall order`);
    assert.match(text, /AC-TNNN/i, `${name} requires stable acceptance IDs`);
    assert.match(text, /exact.*(?:result|expected)/i, `${name} requires an exact observable result`);
}

for (const [name, text] of [
    ['Copilot tasks', SPEC_KIT_PROMPTS['sk.tasks.prompt.md']],
    ['Claude tasks', CLAUDE_SPEC_KIT_COMMANDS['sk.tasks.md']]
]) {
    assert.match(text, /Demo.*(?:cannot|never|does not).*acceptance/i, `${name} distinguishes demo from acceptance`);
    assert.match(text, /objective observable assertion/i, `${name} requires an observable assertion`);
    assert.match(text, /verification method\/command/i, `${name} requires a verification method`);
    assert.match(text, /exact.*(?:result|expected)/i, `${name} requires an exact result`);
    assert.match(text, /when relevant|applicable.*context/i, `${name} expands acceptance proportionally`);
    assert.match(text, /omit (?:empty\/redundant|empty boilerplate|irrelevant)/i, `${name} avoids acceptance boilerplate`);
    assert.match(text, /exit 0.*(?:insufficient|never)|exit `?0`?.*insufficient/i, `${name} rejects vacuous exit-zero proof`);
    assert.match(text, /nonzero|exact output\/value\/count|artifact predicate/i, `${name} proves the assertion executed`);
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
    assert.match(text, /CAC-CY-NNN/i, `${name} validates cycle acceptance`);
    assert.match(text, /Assert.*Verify.*Expected/is, `${name} backfills executable acceptance fields`);
    assert.match(text, /non-vacuous|nonzero|artifact predicate/i, `${name} backfills execution proof`);
}

for (const [name, text] of [
    ['Copilot plan', SPEC_KIT_PROMPTS['sk.plan.prompt.md']],
    ['Copilot tasks', SPEC_KIT_PROMPTS['sk.tasks.prompt.md']],
    ['Claude plan', CLAUDE_SPEC_KIT_COMMANDS['sk.plan.md']],
    ['Claude tasks', CLAUDE_SPEC_KIT_COMMANDS['sk.tasks.md']]
]) {
    for (const category of ['design-high-care', 'logic', 'codegen', 'adr-docs', 'tests', 'small-change', 'integration-ops']) {
        assert.match(text, new RegExp(category), `${name} includes ${category}`);
    }
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
    assert.match(text, /AC-TNNN/i, `${name} gates tasks`);
    assert.match(text, /CAC-CY-NNN/i, `${name} gates cycles`);
    assert.match(text, /PAC-PNN/i, `${name} gates phases`);
}

const extensionSource = fs.readFileSync('src/extension.ts', 'utf8');
const claudeAssetSource = fs.readFileSync('src/specs/specKitPromptAssets.ts', 'utf8');
for (const [name, text] of [['Copilot agent', extensionSource], ['Claude agent', claudeAssetSource]]) {
    assert.match(text, /implementation intent.*internally route.*\/sk\.implement/is, `${name} routes natural-language implementation`);
    assert.match(text, /does not require the user to retype a slash command/i, `${name} routing is implicit`);
}

const webviewSource = fs.readFileSync('media/webview.js', 'utf8');
assert.match(webviewSource, /Agent throughput/, 'UI labels attributed delivery as agent throughput');
assert.match(webviewSource, /Excludes human waiting, manual work, and untracked user activity/, 'UI excludes user productivity from throughput');
assert.doesNotMatch(webviewSource, />Workspace velocity</, 'UI no longer calls agent throughput workspace velocity');

console.log('PASS decision-complete cloud-ready planning contract for Copilot and Claude');
