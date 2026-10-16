// R-AITALK-31: the main agent's commentary updates and heads-ups reach AITalk; a room that refuses the line never fails
// the commentary post. Run: node test-commentary-aitalk-mirror.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = path.join(__dirname, 'build', 'commentary-mirror');
fs.rmSync(buildDir, { recursive: true, force: true });
require('./test-fixture-transpile.cjs')(buildDir, 'commentary/commentary.ts');
const { CommentaryStore, commentaryToolDefinitions, setCommentaryAITalkMirror } = require(path.join(buildDir, 'commentary', 'commentary.js'));

const home = fs.mkdtempSync(path.join(__dirname, 'build', 'commentary-mirror-home-'));
const store = new CommentaryStore({ dir: path.join(home, 'commentary'), now: () => Date.UTC(2026, 9, 16, 23, 0) });
const [commentary] = commentaryToolDefinitions(() => store, '/ws');

const room = [];
setCommentaryAITalkMirror((workspace, input) => { room.push({ workspace, ...input }); });
assert.equal(commentary.run({ kind: 'update', text: 'Integrations rows are wired, running the Team tests now' }).status, 'POSTED');
assert.equal(commentary.run({ kind: 'heads-up', text: 'I will need your choice on the Build member names soon' }).status, 'POSTED');
assert.deepEqual(room.map((line) => [line.workspace, line.kind]), [['/ws', 'update'], ['/ws', 'heads-up']], 'every update and heads-up reaches the room');

setCommentaryAITalkMirror(() => { throw new Error('AITalk participant is not registered'); });
const refused = commentary.run({ kind: 'update', text: 'The room refused this line but the feed still keeps it' });
assert.equal(refused.status, 'POSTED', 'a refused AITalk mirror never fails the post');
assert.equal(store.read('/ws').items.length, 3);

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(buildDir, { recursive: true, force: true });
console.log('PASS EV-COMMENTARY-AITALK-MIRROR updates and heads-ups reach AITalk; a refused mirror keeps the post');
