// The retired main goal and copy opener are absent; AITalk is the only live feed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
assert.doesNotMatch(provider, /data-tab="commentary"|id="panel-commentary"/);
const settings = provider.slice(provider.indexOf('id="panel-settings"'), provider.indexOf('<!-- End panel-settings -->'));
assert.doesNotMatch(settings, /cm-goal-input|cm-copy|Copy opener|Main goal/);
assert.doesNotMatch(provider, /cm-clear|case 'clearCommentary'/);
assert.doesNotMatch(webview, /renderCommentaryHtml|commentaryTypewrite|commentaryAnimateNew|commentarySeen|commentaryOpenTurns|cm-feed|tab-badge-commentary|clearCommentary/);
assert.doesNotMatch(webview, /commentaryState|applyCommentaryState|initCommentaryTab|setCommentaryGoal/);
const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
assert.doesNotMatch(css, /\.cm-(?!goal-input)[\w-]+|@keyframes cm/);
require('./test-settings-cleanup.cjs');
console.log('PASS EV-030b Commentary cleanup: Settings goal and copy absent; AITalk is the sole live feed');
