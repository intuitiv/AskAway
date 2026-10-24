// EV-CACHE-WARN-SETTING (R-SETTINGS-16): the prompt-cache expiry alert time is the `askaway.cacheWarnSeconds` setting (default 285 = 4:45),
// sent to the webview with the other settings and used for the cooling state and the sound. Seen from the shipped files.
// Run: node test-cache-warn-setting.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8').replace(/\r/g, '');
const setting = JSON.parse(read('package.json')).contributes.configuration.properties['askaway.cacheWarnSeconds'];
assert.ok(setting, 'the setting is declared');
assert.deepEqual([setting.type, setting.default, setting.minimum, setting.maximum], ['number', 285, 30, 299]);

const provider = read('src', 'webview', 'webviewProvider.ts');
assert.ok(/cacheWarnSeconds: this\._cacheWarnSeconds/.test(provider), 'the provider sends the value with updateSettings');
assert.ok(/affectsConfiguration\(`\$\{CONFIG_NAMESPACE\}\.cacheWarnSeconds`\)/.test(provider), 'changing the setting reloads it live');
assert.ok(/Math\.min\(299, Math\.max\(30,/.test(provider), 'the value is clamped to 30-299');

const web = read('media', 'webview.js');
assert.ok(/cacheWarnSecs = Number\(message\.cacheWarnSeconds\)/.test(web), 'the webview reads the setting');
assert.ok(!/secs [<>]=? 285/.test(web), 'no hard-coded 285 threshold is left in the cache clock or the alert');
assert.ok(/secs >= warnAt && secs < 300/.test(web), 'the sound fires from the configured time');
assert.ok(/warnAt = typeof cacheWarnSecs === 'number' \? cacheWarnSecs : 285/.test(web) && /secs < warnAt \? 'warm'/.test(web), 'the cooling state starts at the configured time');
// The Settings tab shows it as m:ss and saves seconds through the provider (reviewer 2026-10-24: "Show, askaway.cacheWarnSeconds in settings").
assert.ok(/id="cache-warn-input"/.test(web) && /placeholder="4:45"/.test(web), 'the Settings tab has the m:ss field');
assert.ok(/type: 'updateCacheWarnSeconds', value: secs/.test(web), 'the field saves seconds');
assert.ok(/function parseCacheWarn/.test(web) && /secs >= 30 && secs <= 299/.test(web), 'm:ss or seconds, 0:30 to 4:59');
assert.ok(/case 'updateCacheWarnSeconds':/.test(provider) && /update\('cacheWarnSeconds', secs, vscode\.ConfigurationTarget\.Global\)/.test(provider), 'the provider writes the user setting');
const vm = require('node:vm');
const fn = web.slice(web.indexOf('function parseCacheWarn'), web.indexOf('function handleCacheWarnChange'));
const ctx = {}; vm.runInNewContext(fn + ';this.p = parseCacheWarn; ', ctx);
assert.deepEqual([ctx.p('4:40'), ctx.p('280'), ctx.p('0:20'), ctx.p('5:00'), ctx.p('abc')].map(v => Number.isNaN(v) ? 'x' : v), [280, 280, 'x', 'x', 'x']);
console.log('PASS EV-CACHE-WARN-SETTING');
