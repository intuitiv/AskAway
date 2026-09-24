// Plays a commentary feed through the REAL Commentary tab code (panel markup from webviewProvider.ts,
// render block from media/webview.js, styles from media/main.css) in a standalone page, item by item.
// Run: node tools/play-commentary.cjs [--feed <state.json>] [--workspace <path>] [--interval 1200] [--open]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.join(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const slice = (text, start, end, label) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from);
    if (from < 0 || to < 0) { throw new Error(`cannot find ${label}`); }
    return text.slice(from, to + end.length);
};

function commentaryKey(workspace) {
    let resolved = workspace;
    try { resolved = fs.realpathSync(workspace); } catch { /* keep */ }
    return resolved.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

const workspace = arg('--workspace', path.join(root, '..'));
const feedFile = arg('--feed', path.join(os.homedir(), '.askaway', 'commentary', `${commentaryKey(workspace)}.json`));
const state = JSON.parse(fs.readFileSync(feedFile, 'utf8'));
const items = (state.items || []).filter((item) => item.ts > (state.clearedAt || 0));
const interval = Number(arg('--interval', '1200'));

const webview = fs.readFileSync(path.join(root, 'media', 'webview.js'), 'utf8');
const renderBlock = slice(webview, '// ── Commentary tab: pure render', '// ── end Commentary pure render ──', 'commentary render block');
const provider = fs.readFileSync(path.join(root, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
const panel = slice(provider, '<div class="tab-panel" id="panel-commentary">', '</div><!-- End panel-commentary -->', 'commentary panel markup')
    .replace('class="tab-panel"', 'class="tab-panel active"');
const css = fs.readFileSync(path.join(root, 'media', 'main.css'), 'utf8');

// VS Code Dark Modern values, so the page looks like the real sidebar outside VS Code.
const theme = `:root{--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-editor-font-family:Menlo,monospace;
--vscode-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;
--vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;--vscode-charts-green:#89d185;--vscode-charts-blue:#3794ff;--vscode-charts-yellow:#cca700;--vscode-charts-red:#f14c4c;}
body{background:#181818;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;margin:0;display:flex;justify-content:center}
.play-frame{width:380px;padding:10px;border-left:1px solid #2b2b2b;border-right:1px solid #2b2b2b;min-height:100vh;box-sizing:border-box}
.play-bar{display:flex;gap:6px;align-items:center;font-size:11px;margin-bottom:8px;opacity:.9}
.play-bar button{font-size:11px}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>AskAway · Live commentary play</title>
<style>${css}\n${theme}</style></head><body><div class="play-frame">
<div class="play-bar"><button id="play-toggle">Pause</button><button id="play-restart">Restart</button>
<span id="play-status"></span></div>
${panel}
</div><script>
${renderBlock}
var FEED = ${JSON.stringify({ goal: state.goal || '', archivedCount: 0, items })};
var shown = [], timer = null, filter = 'all';
function paint() {
  var view = { goal: FEED.goal, archivedCount: FEED.archivedCount, items: shown };
  document.getElementById('cm-feed').innerHTML = renderCommentaryHtml(view, filter);
  document.getElementById('play-status').textContent = shown.length + ' / ' + FEED.items.length + ' balls';
}
function step() { if (shown.length >= FEED.items.length) { stop(); return; } shown.push(FEED.items[shown.length]); paint(); }
function start() { stop(); timer = setInterval(step, ${interval}); document.getElementById('play-toggle').textContent = 'Pause'; }
function stop() { if (timer) clearInterval(timer); timer = null; document.getElementById('play-toggle').textContent = 'Play'; }
document.getElementById('play-toggle').onclick = function () { timer ? stop() : start(); };
document.getElementById('play-restart').onclick = function () { shown = []; paint(); start(); };
document.getElementById('cm-goal-input').value = FEED.goal;
document.getElementById('cm-filters').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-cm-filter]'); if (!btn) return;
  filter = btn.getAttribute('data-cm-filter');
  this.querySelectorAll('[data-cm-filter]').forEach(function (b) { b.classList.toggle('active', b === btn); });
  paint();
});
paint(); start();
</script></body></html>`;

const out = arg('--out', '/tmp/aa/commentary-play.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`COMMENTARY-PLAY WRITTEN ${out} items=${items.length} source=${feedFile}`);
if (process.argv.includes('--open')) { childProcess.spawnSync('open', [out]); }
