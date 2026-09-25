// After a VS Code reload the chat banner must show the current turn again, not "0 reqs · Age: –".
// Run: node test-turn-replay.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-turn-replay-'));
fs.writeFileSync(path.join(buildDir, 'turnReplay.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'observability', 'turnReplay.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const { lastUserMessage, rewindPlan } = require(path.join(buildDir, 'turnReplay.js'));

// A main.jsonl as Copilot writes it: two turns, multi-byte text before the second user message.
const lines = [
    { type: 'session_start', ts: 1 },
    { type: 'user_message', ts: 10, attrs: { text: 'first' } },
    { type: 'llm_request', ts: 11, attrs: { inputTokens: 100, text: 'naïve café — ✓' } },
    { type: 'user_message', ts: 20, attrs: { text: 'second' } },
    { type: 'llm_request', ts: 21, attrs: { inputTokens: 200 } },
    { type: 'tool_call', ts: 22, name: 'read_file' },
].map((l) => JSON.stringify(l));
const buf = Buffer.from(lines.join('\n') + '\n', 'utf8');
const turn = lastUserMessage(buf);
assert.deepEqual([turn.lineCount, turn.ts], [3, 20], 'the last parent user message starts the current turn');
assert.equal(buf.toString('utf8', turn.byteOffset).split('\n')[0], lines[3], 'the byte offset lands exactly on that line despite multi-byte text');
assert.equal(lastUserMessage(Buffer.from(lines.slice(0, 1).join('\n') + '\n')), undefined, 'no user message: nothing to rebuild');
assert.equal(lastUserMessage(Buffer.from(lines.join('\n'))).lineCount, 3, 'a trailing partial line is ignored');

// Restart with cursors at end of file: main rewinds to the turn start, a child sub-agent log to 0.
const main = '/d/s1/main.jsonl';
const child = '/d/s1/runSubagent-Explore-x.jsonl';
const known = new Map([[main, { byteOffset: buf.length, lineCount: 6 }], [child, { byteOffset: 900, lineCount: 4 }]]);
const plan = rewindPlan([main, child, '/d/s1/never-read.jsonl'], main, turn, known);
assert.deepEqual(plan.cursors.get(main), { byteOffset: turn.byteOffset, lineCount: 3 });
assert.deepEqual(plan.cursors.get(child), { byteOffset: 0, lineCount: 0 });
assert.equal(plan.cursors.has('/d/s1/never-read.jsonl'), false, 'unread files are read in full anyway');
assert.deepEqual([plan.floors.get(main), plan.floors.get(child)], [6, 4], 'lines below the old cursor are marked already counted');
// The turn began after everything already read: no rewind, normal reading rebuilds it.
assert.equal(rewindPlan([main], main, turn, new Map([[main, { byteOffset: turn.byteOffset, lineCount: 3 }]])).cursors.size, 0);

// The provider rewinds once per start and never re-logs replayed tool lines (request lines are deduped by key).
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
assert.match(provider, /const logFiles = await this\._findWorkspaceCopilotDebugLogFiles\(\);\s*await this\._rewindToCurrentTurnOnce\(logFiles\);/);
assert.match(provider, /if \(lineIndex >= \(this\._replayFloors\.get\(logFile\) \?\? 0\)\) \{\s*toolRows\.push/);
assert.match(provider, /const recordKey = `\$\{sessionId\}:\$\{lineIndex\}:\$\{this\._hashText\(line\)\}`;\s*if \(ledger\.seen\[recordKey\] === true\)/, 'request rows stay deduplicated by line key');
fs.rmSync(buildDir, { recursive: true, force: true });
console.log('EV-OBS-RELOAD TurnRebuiltAfterReload: PASS turnStart=lastUserMessage byteExact=true childRewind=0 alreadyCounted=floors noDoubleCount=true');
