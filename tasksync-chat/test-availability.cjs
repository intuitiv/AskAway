// Outside-in UserPromptSubmit availability contract. Run: node tasksync-chat/test-availability.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-availability-home-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-availability-ws-'));
const otherWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-availability-other-'));
const key = fs.realpathSync(workspace).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const file = path.join(home, '.askaway', 'availability', `${key}.json`);
const until = new Date(Date.now() + 3600000).toISOString();
const run = (cwd = workspace) => childProcess.execFileSync(process.execPath, [path.join(__dirname, 'hooks', 'spec-context-inject.cjs')], {
    input: JSON.stringify({ session_id: 'availability-conversation', cwd }),
    env: { ...process.env, HOME: home }, encoding: 'utf8',
});
const store = (mode, extra = {}) => fs.writeFileSync(file, JSON.stringify({ mode, setAt: new Date().toISOString(), ...extra }));
const context = () => {
    const output = JSON.parse(run()).hookSpecificOutput;
    assert.equal(output.hookEventName, 'UserPromptSubmit');
    return output.additionalContext;
};
const commonRules = (text) => {
    assert.match(text, /## Availability/);
    assert.match(text, /Do not stop for small choices: decide and record each decision in a decisions list/);
    assert.match(text, /Keep every lane busy/);
    assert.match(text, /End the session with a handoff and a report of decisions, open questions, and cost/);
    assert.ok(text.split('\n').length <= 12, 'availability context stays within twelve lines');
};

try {
    assert.equal(run(), '', 'missing state injects nothing');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    store('here', { until, note: 'At my desk' });
    assert.equal(run(), '', 'Here injects nothing');

    store('away', { until, note: 'next 1 hr\nKeep shipping' });
    const away = context();
    commonRules(away);
    assert.match(away, /Away \(reachable on Telegram\)/);
    assert.ok(away.includes(`Until: ${until}`));
    assert.match(away, /Reviewer note: next 1 hr Keep shipping/);
    assert.match(away, /Send questions to Telegram; work continues on other lanes/);
    assert.doesNotMatch(away, /Never ask questions/);
    assert.equal(context(), away, 'rules are present on repeated prompts in the same conversation');
    assert.equal(run(otherWorkspace), '', 'availability is scoped to the commentary workspace key');

    store('offline', { until, note: 'overnight' });
    const offline = context();
    commonRules(offline);
    assert.match(offline, /Offline \(not reachable\)/);
    assert.ok(offline.includes(`Until: ${until}`));
    assert.match(offline, /Reviewer note: overnight/);
    assert.match(offline, /Never ask questions; park open questions for the final report/);
    assert.doesNotMatch(offline, /exceeded 300K/, 'the 300K rule only fires after a request exceeded it (see test-long-run-handoff.cjs)');
    assert.doesNotMatch(offline, /Send questions to Telegram/);

    for (const mode of ['away', 'offline']) {
        store(mode, { until: new Date(Date.now() - 60000).toISOString() });
        assert.equal(run(), '', `${mode} expiry injects nothing`);
        store(mode);
        commonRules(context());
    }
    store('unknown');
    assert.equal(run(), '', 'unknown mode injects nothing');
    fs.writeFileSync(file, '{');
    assert.equal(run(), '', 'malformed state does not block the prompt');

    fs.mkdirSync(path.join(workspace, '.specify'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'specs', '001-demo'), { recursive: true });
    fs.writeFileSync(path.join(workspace, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-demo' }));
    fs.writeFileSync(path.join(workspace, 'specs', '001-demo', 'Goal.md'), 'Ship the feature.');
    store('away', { until });
    const combined = context();
    assert.match(combined, /Ship the feature\./);
    assert.ok(combined.indexOf('## Availability') > combined.indexOf('Ship the feature.'), 'availability appends to spec context');
    commonRules(context());
    store('here');
    assert.equal(run(), '', 'switching back to Here removes the availability context');
    console.log('PASS EV-AVAILABILITY');
} finally {
    for (const dir of [home, workspace, otherWorkspace]) { fs.rmSync(dir, { recursive: true, force: true }); }
}
