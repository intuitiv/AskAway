const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
(async () => {
    const render = await import('./media/aitalk/talkRender.js');
    const css = fs.readFileSync(path.join(__dirname, 'media/aitalk/talk.css'), 'utf8');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
    const main = fs.readFileSync(path.join(__dirname, 'media/main.css'), 'utf8');
    assert.doesNotMatch(main.slice(main.indexOf('body.avail-here'), main.indexOf('/* ===== Workers tab')), /#[0-9a-f]{3,8}\b|rgba?\(/i);
    const goalCss = main.match(/\.cm-goal-input \{[^}]*\}/)[0];
    assert.match(goalCss, /border: 1px solid var\(--vscode-input-border, var\(--vscode-contrastBorder, transparent\)\)/);
    assert.match(main, /\.cm-goal-input:focus \{ outline: 1px solid var\(--vscode-focusBorder\)/);
    assert.doesNotMatch(goalCss, /#[0-9a-f]{3,8}\b/i);
    const avatarCss = css.match(/\.talk-avatar \{[^}]*\}/)[0];
    assert.match(avatarCss, /background: var\(--vscode-badge-background\)/);
    assert.match(avatarCss, /color: var\(--vscode-badge-foreground\)/);
    assert.match(avatarCss, /box-shadow: 0 0 0 2px var\(--avatar-accent/);
    assert.doesNotMatch(css, /-webkit-text-fill-color|background: currentColor/);
    for (const who of ['you', 'agent', 'validator', 'worker', 'p0', 'p1', 'p2', 'p3']) {
        assert.match(css, new RegExp(`\\.talk-avatar\\.who-${who} \\{ --avatar-accent: var\\(--who-${who}\\); \\}`));
    }
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.doesNotMatch(provider, /data-tab="commentary"|id="panel-commentary"/);
    assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false);
    const output = await esbuild.build({ stdin: { contents: "export * from './src/commentary/commentary'; export * from './src/aitalk/delivery';", resolveDir: __dirname }, bundle: true, platform: 'node', write: false, format: 'cjs' });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, mod, mod.exports);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-light-'));
    mod.exports.configureAITalkDelivery(root);
    mod.exports.setMainTurnProbe(() => true);
    const store = new mod.exports.CommentaryStore({ dir: path.join(root, 'commentary') });
    for (const kind of ['update', 'heads-up']) assert.equal(store.post(root, { kind, text: `${kind} needs three plain words` }).status, 'POSTED');
    const messages = fs.readFileSync(path.join(root, '.askaway/aitalk/messages.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(messages.every(message => message.author === render.defaultMembers.find(member => member.kind === 'agent').id));
    const html = `<body class="vscode-light"><div class="talk-prototype">${render.threadHtml(messages)}</div><section class="presence-flyout">Personal availability</section><div class="trace-group">Trace</div></body>`;
    // R-AITALK-18: heads-ups are ordinary participant bubbles, not a highlighted strip.
    assert.match(html, /heads-up needs/); assert.doesNotMatch(html, /talk-bubble heads-up/); assert.match(html, /update needs/); assert.match(html, /vscode-light/);
    assert.ok(require('./package.json').scripts['pretest:workers'].includes('node test-theme-light.cjs'));
    console.log('PASS EV-THEME-LIGHT theme-variable AITalk/presence/Trace; sole AITalk feed; commentary agent bubbles and heads-up; CRLF');
})().catch(error => { console.error(error); process.exitCode = 1; });
