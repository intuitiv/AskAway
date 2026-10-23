// EV-WEBVIEW-LOADER (R-UI-LOADER-01): the AskAway view shows a themed loader from the first paint and removes it
// once AITalk has rendered (or after a fail-safe), so unstyled controls are never seen. Seen from the shell HTML.
// Run: node test-webview-loader.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8').replace(/\r/g, '');
const html = src.slice(src.indexOf('return `<!DOCTYPE html>'));

const styleAt = html.indexOf('#aa-loader {');
const cssLink = html.indexOf('<link href="${styleUriWithVersion}"');
const loaderAt = html.indexOf('<div id="aa-loader"');
const bodyAt = html.indexOf('<body>');
const mainAt = html.indexOf('<div class="main-container">');
assert.ok(styleAt > 0 && loaderAt > 0, 'loader style and element exist');
assert.ok(loaderAt > bodyAt && loaderAt < mainAt, 'loader is the first thing in the body, before the app');
assert.ok(html.slice(html.indexOf('<style>'), html.indexOf('</style>')).includes('#aa-loader'), 'loader style is inline, not in main.css');
assert.ok(html.indexOf('<title>AskAway</title>') < styleAt, 'inline style follows the stylesheet links');
assert.ok(cssLink > 0 && cssLink < styleAt, 'loader style does not depend on main.css');
assert.ok(/prefers-reduced-motion/.test(html), 'loader respects reduced motion');

const scriptStart = html.indexOf('<script nonce="${nonce}">') + '<script nonce="${nonce}">'.length;
const script = html.slice(scriptStart, html.indexOf('</script>', scriptStart));

function run(initialText) {
	const classes = new Set();
	let removed = false;
	const timers = [];
	const loader = { classList: { add: c => classes.add(c) }, remove: () => { removed = true; } };
	const root = { textContent: initialText };
	let domReady;
	let mutate;
	const sandbox = {
		window: {},
		document: {
			getElementById: id => (id === 'aa-loader' ? (removed ? null : loader) : id === 'aitalk-root' ? root : null),
			addEventListener: (event, fn) => { if (event === 'DOMContentLoaded') domReady = fn; },
		},
		setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
		requestAnimationFrame: fn => fn(),
		MutationObserver: class { constructor(fn) { mutate = fn; } observe() {} disconnect() {} },
	};
	vm.runInNewContext(script, sandbox);
	domReady();
	return { classes, timers, root, mutate: () => mutate(), isRemoved: () => removed, flush: () => timers.splice(0).forEach(t => t.fn()) };
}

// Waiting: stays visible while the placeholder is shown.
let r = run('Loading AITalk…');
assert.equal(r.classes.has('aa-loader-out'), false, 'visible while AITalk has not rendered');
assert.ok(r.timers.some(t => t.ms === 8000), 'a fail-safe removes the loader after 8s');

// AITalk renders: loader fades out and is removed.
r.root.textContent = 'Priya: hello';
r.mutate();
assert.equal(r.classes.has('aa-loader-out'), true, 'fades out after AITalk renders');
r.flush();
assert.equal(r.isRemoved(), true, 'removed after the fade');

// Fail-safe path.
r = run('Loading AITalk…');
r.timers.find(t => t.ms === 8000).fn();
assert.equal(r.classes.has('aa-loader-out'), true, 'fail-safe hides a stuck loader');

console.log('test-webview-loader: ok');
