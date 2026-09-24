const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-prune-'));
const input = path.join(directory, 'conversation.jsonl');
const output = path.join(directory, 'handoff.json');
fs.writeFileSync(input, [
    JSON.stringify({ attrs: { inputMessages: [
        { role: 'user', parts: [{ type: 'text', content: 'Compaction fixture: Selected' }] },
        { role: 'assistant', parts: [{ type: 'text', content: 'VISIBLE_ASSISTANT_TEXT' }, { type: 'tool_call', arguments: 'TOOL_ARGUMENT_FIXTURE' }] },
        { role: 'tool', parts: [{ type: 'tool_call_response', response: 'TOOL_SECRET_FIXTURE' }] },
        { role: 'user', parts: [{ type: 'text', content: 'VISIBLE_USER_TEXT' }] },
        { role: 'assistant', parts: [{ type: 'text', content: 'LATEST_ASSISTANT_TEXT' }] }
    ] } }),
    JSON.stringify({ attrs: { inputMessages: [{ role: 'user', parts: [{ type: 'text', content: 'Other conversation' }] }] } }),
    '{ malformed json'
].join('\n'));

const script = path.join(__dirname, 'tools', 'prune-copilot-conversation.sh');
const result = execFileSync('bash', [script, '--input', input, '--title', 'Selected', '--output', output], { encoding: 'utf8' });
const handoff = JSON.parse(fs.readFileSync(output, 'utf8'));

assert.strictEqual(handoff.title, 'Selected');
assert.strictEqual(handoff.messages.length, 2);
assert.strictEqual(handoff.messages[0].text, 'VISIBLE_USER_TEXT');
assert.strictEqual(handoff.messages[1].text, 'LATEST_ASSISTANT_TEXT');
assert.strictEqual(handoff.toolCallsPruned, 1);
assert.strictEqual(handoff.toolResponsesPruned, 1);
assert.strictEqual(handoff.toolResponses, 'Pruned');
assert.strictEqual(JSON.stringify(handoff).includes('TOOL_SECRET_FIXTURE'), false);
assert.strictEqual(JSON.stringify(handoff).includes('TOOL_ARGUMENT_FIXTURE'), false);
assert.strictEqual(JSON.stringify(handoff).includes('Other conversation'), false);
assert.match(result, /Tool responses pruned: 1/);
assert.match(result, /Approx tokens: \d+ -> \d+/);
console.log('PRUNED CONVERSATION E2E OK');