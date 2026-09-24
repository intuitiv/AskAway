const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsPath = path.resolve(__dirname, '..', '.vscode', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

assert.equal(
    settings['github.copilot.chat.anthropic.promptCaching.extendedTtl'],
    false,
    'The workspace must not enable Anthropic extended prompt caching.'
);
assert.equal(
    settings['github.copilot.chat.anthropic.promptCaching.extendedTtlMessages'],
    false,
    'The workspace must not enable Anthropic extended conversation caching.'
);

console.log('PASS: one-hour Anthropic cache is disabled');