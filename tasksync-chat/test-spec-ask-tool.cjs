const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const fixture = fs.mkdtempSync(path.join(build, 'ask-tool-'));
for (const name of ['askTool', 'askCapture']) {
    esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/specs', `${name}.ts`)],
        outfile: path.join(fixture, `${name}.cjs`), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
}
const { asksTool } = require(path.join(fixture, 'askTool.cjs'));
const pure = require(path.join(fixture, 'askCapture.cjs'));
const toolRoot = path.join(fixture, 'tool');
const directRoot = path.join(fixture, 'direct');
fs.mkdirSync(toolRoot);
fs.mkdirSync(directRoot);
const file = 'specs/005-tool/tasks.md';
const read = root => fs.readFileSync(path.join(root, file), 'utf8');
const docs = root => ({ [file]: read(root) });
const question = { text: 'Which scope?', options: ['Local', 'All'], recommendation: 'Local' };
(async () => {
    const tool = asksTool(toolRoot);
    assert.equal(tool.name, 'askaway_asks');
    const asks = [{ kind: 'request', text: 'Show coverage', questions: [question] }, { kind: 'bug', text: 'Fix service' }];
    const captured = await tool.run({ action: 'capture', spec: '005-tool', asks });
    assert.deepEqual(captured.rows, pure.captureAsks(directRoot, '005-tool', asks));
    assert.equal(read(toolRoot), read(directRoot));
    const refs = captured.rows.map(({ file, id }) => ({ file, id }));
    const before = read(toolRoot);
    for (const evidence of [undefined, '', '   ']) {
        assert.ok(['REFUSED', 'INVALID_INPUT'].includes((await tool.run({ action: 'close', row: refs[0], evidence })).status));
        assert.equal(read(toolRoot), before);
    }
    // References contain only the stable row keys, not the returned row payload.
    assert.deepEqual((await tool.run({ action: 'close', row: refs[0], evidence: 'test-coverage PASS' })).row,
        pure.updateAskOutcome(directRoot, refs[0], { status: 'done', evidence: 'test-coverage PASS' }));
    assert.deepEqual((await tool.run({ action: 'wait', row: refs[1], reason: 'depends on service' })).row,
        pure.updateAskOutcome(directRoot, refs[1], { status: 'waiting', reason: 'depends on service' }));
    assert.equal(read(toolRoot), read(directRoot));
    const report = await tool.run({ action: 'report' });
    assert.deepEqual(report.rows, pure.askProgressReport(docs(directRoot)));
    assert.equal(report.nextOffset, null);
    const page = await tool.run({ action: 'report', limit: 1 });
    assert.equal(page.nextOffset, 1);
    assert.equal(page.total, 2);
    const batch = await tool.run({ action: 'questions', row: refs[1], questions: [question] });
    pure.updateAskQuestions(directRoot, refs[1], [question]);
    assert.equal(batch.message, pure.batchAskQuestions(docs(directRoot)));
    assert.equal(read(toolRoot), read(directRoot));
    assert.equal((await tool.run({ action: 'questions', row: refs[1], questions: [{ ...question, answer: 'Local' }] })).message, null);
    console.log('PASS ask-tool: capture, close, wait, report and questions match persisted rows and pure US8 functions');
    const snapshot = read(toolRoot);
    const credential = 'token=' + 'x'.repeat(32);
    assert.equal((await tool.run({ action: 'capture', asks: [{ kind: 'request', text: credential }] })).status, 'REFUSED');
    assert.equal(read(toolRoot), snapshot);
    assert.ok(!JSON.stringify(await tool.run({ action: 'wait', row: refs[1], reason: credential })).includes(credential));
    assert.equal((await tool.run({ action: 'close', row: { file: '../outside', id: 'T001' }, evidence: 'PASS' })).status, 'REFUSED');
    const manifest = require('./package.json').contributes.languageModelTools.find(entry => entry.name === tool.name);
    assert.equal(manifest.toolReferenceName, 'asks');
    assert.deepEqual(manifest.inputSchema.properties.action.enum, ['capture', 'close', 'wait', 'report', 'questions']);
    assert.match(fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8'), /registerLmToolDefinitions\(\[asksTool\(memoryProject\)\]\)/);
    assert.match(fs.readFileSync(path.join(__dirname, 'src/mcp/mcpServer.ts'), 'utf8'), /\[asksTool\(gradleWorkspaceRoot\)\]/);
    const agentBuild = path.join(fixture, 'build-agent.cjs');
    esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/agents/askawayBuildAgent.ts')],
        outfile: agentBuild, bundle: true, platform: 'node', format: 'cjs' });
    const agent = require(agentBuild).ASKWAY_BUILD_AGENT_CONTENT;
    assert.match(agent, /^tools:.*intuitiv\.askaway\/asks/m);
    assert.match(agent, /Inventory every ask first[^\n]*askaway_asks capture[^\n]*askaway_asks close[^\n]*evidence[^\n]*askaway_asks wait[^\n]*reason/);
    assert.match(agent, /Close with a coverage table[^\n]*askaway_asks report[^\n]*askaway_asks questions/);
    assert.match(agent, /every ask in every message, including unnumbered corrections and side remarks/);
    const unnumbered = await tool.run({ action: 'capture', spec: '005-tool', asks: [
        { kind: 'correction', text: 'Use green instead' }, { kind: 'side remark', text: 'Also keep drafts' }
    ] });
    assert.equal(unnumbered.rows.length, 2);
    assert.ok(read(toolRoot).includes('Use green instead'));
    assert.ok(read(toolRoot).includes('Also keep drafts'));
    console.log('PASS ask-tool: shipped Build agent and persisted rows cover unnumbered corrections and side remarks');
    const backlogPath = path.join(toolRoot, 'specs/BACKLOG.md');
    const duplicateBytes = '| ID | What | State | Evidence | Source |\n|---|---|---|---|---|\n| T005 | First candidate | READY | None | A |\n| T005 | Second candidate | READY | None | B |\n';
    fs.writeFileSync(backlogPath, duplicateBytes);
    for (const action of ['close', 'wait']) {
        const refusal = await tool.run({ action, row: { file: 'specs/BACKLOG.md', id: 'T005' }, evidence: 'PASS', reason: 'blocked' });
        assert.equal(refusal.status, 'REFUSED');
        assert.deepEqual(refusal.candidates.map(row => row.text), ['First candidate', 'Second candidate']);
        assert.equal(fs.readFileSync(backlogPath, 'utf8'), duplicateBytes);
    }
    assert.equal((await tool.run({ action: 'report' })).rows.some(row => row.text === 'What'), false);
    console.log('PASS ask-tool review: ambiguous IDs return candidates and preserve bytes; backlog headers excluded');
    const suffixRoot = path.join(fixture, 'suffix-tool');
    fs.mkdirSync(path.join(suffixRoot, 'specs/005-suffix'), { recursive: true });
    const suffixFile = path.join(suffixRoot, 'specs/005-suffix/tasks.md');
    const suffixBytes = '* [ ] T004a Alpha\n- [ ] T009b Beta\n';
    fs.writeFileSync(suffixFile, suffixBytes);
    const suffixTool = asksTool(suffixRoot);
    const suffixRepeat = await suffixTool.run({ action: 'capture', spec: '005-suffix', asks: [{ kind: 'repeated ask', text: 'Alpha' }] });
    assert.equal(suffixRepeat.rows[0].id, 'T004a');
    assert.equal(fs.readFileSync(suffixFile, 'utf8'), suffixBytes);
    assert.equal((await suffixTool.run({ action: 'close', row: { file: 'specs/005-suffix/tasks.md', id: 'T009b' }, evidence: 'suffix PASS' })).row.id, 'T009b');
    assert.equal(fs.readFileSync(suffixFile, 'utf8'), '* [ ] T004a Alpha\n- [x] T009b Beta Evidence: suffix PASS\n');
    console.log('PASS ask-tool suffixed IDs: repeat and close preserve exact IDs and unrelated bytes');
    const escapeRoot = path.join(fixture, 'escape-tool');
    const outside = path.join(fixture, 'outside-tool');
    fs.mkdirSync(path.join(escapeRoot, 'specs'), { recursive: true });
    fs.mkdirSync(outside);
    const outsideFile = path.join(outside, 'tasks.md');
    const outsideBytes = '- [ ] T004a Outside work\n';
    fs.writeFileSync(outsideFile, outsideBytes);
    fs.symlinkSync(outside, path.join(escapeRoot, 'specs/005-escape'));
    const escapedTool = asksTool(escapeRoot);
    for (const args of [
        { action: 'report' }, { action: 'questions' },
        { action: 'capture', spec: '005-escape', asks: [{ kind: 'request', text: 'Outside work' }] },
        { action: 'close', row: { file: 'specs/005-escape/tasks.md', id: 'T004a' }, evidence: 'PASS' },
        { action: 'wait', row: { file: 'specs/005-escape/tasks.md', id: 'T004a' }, reason: 'blocked' },
        { action: 'questions', row: { file: 'specs/005-escape/tasks.md', id: 'T004a' }, questions: [question] }
    ]) {
        const refusal = await escapedTool.run(args);
        assert.equal(refusal.status, 'REFUSED');
        assert.match(refusal.reason, /escapes/);
        assert.equal(fs.readFileSync(outsideFile, 'utf8'), outsideBytes);
    }
    const oversizedRoot = path.join(fixture, 'oversized');
    fs.mkdirSync(path.join(oversizedRoot, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(oversizedRoot, 'specs/BACKLOG.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
    const refusal = await asksTool(oversizedRoot).run({ action: 'report' });
    assert.equal(refusal.status, 'REFUSED');
    assert.match(refusal.reason, /read bound/);
    console.log('PASS ask-tool containment: all actions refuse symlink reads/writes without outside changes; oversized reads explicitly refused');
    const fileEscapeRoot = path.join(fixture, 'file-escape');
    fs.mkdirSync(path.join(fileEscapeRoot, 'specs/005-file'), { recursive: true });
    fs.symlinkSync(outsideFile, path.join(fileEscapeRoot, 'specs/005-file/tasks.md'));
    assert.equal((await asksTool(fileEscapeRoot).run({ action: 'report' })).status, 'REFUSED');
    const specsEscapeRoot = path.join(fixture, 'specs-escape');
    fs.mkdirSync(specsEscapeRoot);
    fs.symlinkSync(outside, path.join(specsEscapeRoot, 'specs'));
    assert.equal((await asksTool(specsEscapeRoot).run({ action: 'capture', asks: [{ kind: 'request', text: 'Escape specs' }] })).status, 'REFUSED');
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), outsideBytes);
    assert.equal(fs.existsSync(path.join(outside, 'BACKLOG.md')), false);
    console.log('PASS ask-tool containment: file symlinks and workspace specs symlink refuse without outside writes');
    console.log('PASS ask-tool: evidence-free close refused; secrets rejected; bounded paginated report; LM and MCP registrations present');
})().catch(error => { console.error(error); process.exitCode = 1; });
