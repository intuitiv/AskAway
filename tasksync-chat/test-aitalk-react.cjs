// EV-AITALK-REACT (reviewer 2026-10-23: "a simple thumbs up also woudl have been sufficient"): the main agent can answer a reviewer
// message with a reaction through the aitalk tool (action react) instead of a reply. Seen from the caller: the real tool and room.
// Run: node test-aitalk-react.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-react-home-')));
process.env.HOME = home;
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-react-ws-')));
const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/commentary/commentary'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle)(require, mod, mod.exports);
const api = mod.exports;

api.configureAITalkDelivery(root);
api.setMainTurnProbe(() => true);
const room = api.roomFor(root);
const store = new api.CommentaryStore({ dir: path.join(root, 'commentary') });
const tool = api.commentaryToolDefinitions(() => store, root).find(item => item.name === 'aitalk');

const message = room.userPost('Please remember the naming rule.').message;
room.registerAgent();
const reacted = tool.run({ action: 'react', text: '👍', replyTo: message.id });
assert.equal(reacted.status, 'REACTED');
assert.ok(JSON.stringify(room.snapshot()).includes('👍'), 'the reaction is in the room');
assert.equal(tool.run({ action: 'react', text: '👍' }).status, 'INVALID_INPUT', 'a reaction needs the message id');
assert.equal(tool.run({ action: 'react', text: 'not-an-emoji', replyTo: message.id }).status, 'REJECTED', 'only the room reactions are accepted');
assert.equal(tool.run({ action: 'react', text: '👍', replyTo: 'missing-id' }).status, 'REJECTED', 'an unknown message is refused');
assert.match(fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'aitalkDeliveryText.ts'), 'utf8'), /react with a thumbs-up/, 'the delivery block tells the agent it may react');
console.log('PASS EV-AITALK-REACT');
