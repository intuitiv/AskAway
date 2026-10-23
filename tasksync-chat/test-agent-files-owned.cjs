// EV-AGENT-FILES-OWNED (R-TOOLS-04, R-TOOLS-30): every agent file AskAway ships is owned by AskAway and rewritten when it differs;
// any other agent file is the user's and is never touched. Runs the real install function against a temp HOME.
// Run: node test-agent-files-owned.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const mod = { exports: {} };
vm.runInNewContext(esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/agents/installAgentFiles.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text,
    { module: mod, exports: mod.exports, require, Buffer, process });
const { installShippedAgentFiles, shippedAgents } = mod.exports;

(async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const refs = pkg.contributes.languageModelTools.map(tool => tool.toolReferenceName).filter(Boolean);
    const orchestrator = fs.readFileSync(path.join(__dirname, 'agents', 'AA.Orchestrator.agent.md'), 'utf8');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-owned-'));
    const copilot = path.join(home, '.copilot', 'agents');
    const prompts = path.join(home, 'Code', 'User', 'prompts');
    fs.mkdirSync(copilot, { recursive: true }); fs.mkdirSync(prompts, { recursive: true });
    const logs = [];
    const run = () => installShippedAgentFiles({ agents: shippedAgents(orchestrator), copilotAgentsDir: copilot, promptsDir: prompts, toolReferenceNames: refs, log: (message, detail) => logs.push([message, detail]) });
    const toolsOf = text => /^tools: \[(.*)\]$/m.exec(text)[1].split(',').map(item => item.trim());

    // Stale, hand-grown copies with the old `commentary` tool name, plus a member file the user added.
    const stale = '---\nname: "AskAway Build"\ntools: [read/readFile, web, intuitiv.askaway/commentary]\n---\nold body that drifted\n';
    fs.writeFileSync(path.join(copilot, 'askaway-build.agent.md'), stale);
    fs.writeFileSync(path.join(prompts, 'askaway-build.agent.md'), '---\ntools: [intuitiv.askaway/commentary]\n---\nvery old\n');
    fs.writeFileSync(path.join(copilot, 'AA.Orchestrator.agent.md'), '---\ntools: [intuitiv.askaway/commentary]\n---\nhand made\n');
    const mine = '---\nname: "My Member"\ntools: [intuitiv.askaway/commentary]\n---\nmine, hands off\n';
    fs.writeFileSync(path.join(copilot, 'my-member.agent.md'), mine);
    fs.writeFileSync(path.join(prompts, 'my-member.agent.md'), mine);

    // Stale files are replaced and backed up once.
    const first = await run();
    assert.equal(first.written.length, 3, 'build (both targets) and the orchestrator are written');
    const build = fs.readFileSync(path.join(copilot, 'askaway-build.agent.md'), 'utf8');
    assert.ok(/Your name in AITalk is Bhaskar/.test(build) && /about every two minutes for as long as the turn runs/.test(build), 'the shipped body is current');
    assert.equal(fs.readFileSync(path.join(copilot, 'askaway-build.agent.md.bak'), 'utf8'), stale, 'one backup of the stale copy');
    assert.equal(fs.readFileSync(path.join(prompts, 'askaway-build.agent.md.bak'), 'utf8'), '---\ntools: [intuitiv.askaway/commentary]\n---\nvery old\n');
    assert.equal(fs.readFileSync(path.join(copilot, 'AA.Orchestrator.agent.md.bak'), 'utf8'), '---\ntools: [intuitiv.askaway/commentary]\n---\nhand made\n');
    assert.ok(fs.existsSync(path.join(copilot, 'AA.Orchestrator.agent.md')) && !fs.existsSync(path.join(prompts, 'AA.Orchestrator.agent.md')), 'the orchestrator goes to the Copilot harness only');
    assert.ok(logs.some(([message]) => /AskAway-owned agent file/.test(message)), 'what was written is logged');

    // Every askaway tool is listed, none is called commentary; the Copilot copy keeps its own non-askaway tools; same body in both.
    const vscodeBuild = fs.readFileSync(path.join(prompts, 'askaway-build.agent.md'), 'utf8');
    for (const text of [build, vscodeBuild]) {
        const tools = toolsOf(text);
        for (const ref of refs) assert.ok(tools.includes(`intuitiv.askaway/${ref}`), `tool ${ref} listed`);
        assert.ok(!/commentary/.test(tools.join(',')), 'no commentary tool name remains');
    }
    assert.ok(toolsOf(build).includes('read/readFile') && toolsOf(build).includes('web'), 'the existing non-askaway tools of the Copilot copy are kept');
    assert.ok(toolsOf(vscodeBuild).includes('vscode/runCommand') && toolsOf(vscodeBuild).includes('execute'), 'the native copy keeps its native tool style');
    const body = text => text.replace(/^tools: .*$/m, '');
    assert.equal(body(build), body(vscodeBuild), 'body identical in both targets');
    const orch = fs.readFileSync(path.join(copilot, 'AA.Orchestrator.agent.md'), 'utf8');
    assert.ok(/Managed by AskAway: replaced on every release\. To customise, copy to a new name\./.test(orch + build), 'the header says who owns the file');
    assert.ok(!/commentary/.test(toolsOf(orch).join(',')) && toolsOf(orch).includes('intuitiv.askaway/aitalk'), 'orchestrator uses aitalk');

    // User-owned files are untouched; identical shipped files are untouched; a second run changes nothing and keeps the first backup.
    assert.equal(fs.readFileSync(path.join(copilot, 'my-member.agent.md'), 'utf8'), mine);
    assert.equal(fs.readFileSync(path.join(prompts, 'my-member.agent.md'), 'utf8'), mine);
    assert.ok(!fs.existsSync(path.join(copilot, 'my-member.agent.md.bak')), 'no backup of a user file');
    const before = fs.statSync(path.join(copilot, 'askaway-build.agent.md')).mtimeMs;
    const second = await run();
    assert.equal(second.written.length, 0, 'identical files are not rewritten');
    assert.equal(fs.statSync(path.join(copilot, 'askaway-build.agent.md')).mtimeMs, before);

    // A later drift is replaced again but the first backup is never overwritten.
    fs.writeFileSync(path.join(copilot, 'askaway-build.agent.md'), 'edited by hand again\n');
    await run();
    assert.equal(fs.readFileSync(path.join(copilot, 'askaway-build.agent.md.bak'), 'utf8'), stale, 'the first .bak is kept');
    assert.equal(body(fs.readFileSync(path.join(copilot, 'askaway-build.agent.md'), 'utf8')), body(build), 'drift is replaced with the shipped body');
    for (const ref of refs) assert.ok(toolsOf(fs.readFileSync(path.join(copilot, 'askaway-build.agent.md'), 'utf8')).includes(`intuitiv.askaway/${ref}`));

    // Failures never throw.
    fs.writeFileSync(path.join(home, 'file'), 'x');
    const failed = await installShippedAgentFiles({ agents: shippedAgents(orchestrator), copilotAgentsDir: path.join(home, 'file', 'agents'), promptsDir: path.join(home, 'file', 'prompts'), toolReferenceNames: refs, log: () => undefined });
    assert.equal(failed.written.length, 0);

    console.log('PASS EV-AGENT-FILES-OWNED: shipped agent files are replaced and backed up once, user agent files are untouched, every askaway tool is listed');
})().catch(error => { console.error('FAIL EV-AGENT-FILES-OWNED:', error); process.exit(1); });
