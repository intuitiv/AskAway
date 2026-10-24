// Dark theme for AITalk (R-AITALK-78): the dark rules exist, use only theme variables, and under the Atom Material dark colours
// the incoming bubble, outgoing bubble and wallpaper are three different, readable colours. Light rules are untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const talk = read('media/aitalk/talk.css');
const main = read('media/main.css');
const DARK = 'body.vscode-dark';
const HC = 'body.vscode-high-contrast:not(.vscode-high-contrast-light)';

// ---- Light rules keep their key declarations (literal snapshot, independent of git); the dark section only holds dark-scoped rules ----
const lightDeclarations = [
    '--tk-bg: var(--vscode-editor-background);',
    '--tk-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));',
    '--tk-border: var(--vscode-contrastBorder, var(--vscode-panel-border));',
    '--tk-out: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-textLink-foreground)) 18%, var(--tk-bg));',
    '--tk-in: var(--tk-surface);',
    '--tk-wallpaper: var(--tk-bg);',
    '--tk-doodle: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);',
    '.talk-row.in .talk-bubble { background: var(--tk-in); color: var(--tk-in-fg); }',
    '.talk-row.out .talk-bubble { background: var(--tk-out); color: var(--tk-out-fg); }',
];
const darkAt = talk.indexOf('Dark themes (R-AITALK-78)');
assert.ok(darkAt > 0, 'dark section present');
const lightPart = talk.slice(0, darkAt);
for (const declaration of lightDeclarations) assert.ok(lightPart.includes(declaration), `light rule changed or removed: ${declaration}`);
for (const selector of talk.slice(darkAt).match(/^[^\s/*}][^{\n]*\{/gm)) assert.match(selector, /^body\.vscode-dark /, `dark section rule is dark-scoped: ${selector}`);
assert.match(main, /body\.vscode-dark \.trace-group, body\.vscode-high-contrast:not\(\.vscode-high-contrast-light\) \.trace-group \{/);
assert.match(main, /\.trace-group \{ margin: 8px 0; border: 1px solid var\(--vscode-widget-border\); border-radius: 6px; \}/, 'light Trace card border unchanged');


// ---- Dark rules exist, no hex / rgb ----
const marker = talk.indexOf('Dark themes (R-AITALK-78)');
assert.ok(marker > 0, 'dark section present');
const dark = talk.slice(marker);
assert.ok(dark.includes(`${DARK} .talk-prototype, ${HC} .talk-prototype {`), 'dark variable block scoped to dark and high-contrast dark');
assert.doesNotMatch(dark, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, 'no hard-coded colours in the dark rules');
const darkMainLine = main.split('\n').find(line => line.includes('.trace-group') && line.includes(DARK));
assert.ok(darkMainLine && !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(darkMainLine), 'Trace cards get a visible dark border from theme variables');
for (const declaration of dark.match(/--tk-[\w-]+:[^;]+;/g)) assert.match(declaration, /var\(|color-mix\(/, `uses theme variables: ${declaration}`);

// ---- A tiny CSS colour evaluator over the Atom Material (dark) theme colours ----
const atom = {
    'editor-background': '#263238', 'sideBar-background': '#232e33', 'editorWidget-background': '#232e33', 'panel-border': '#232e33',
    'input-background': '#20292e', foreground: '#cccccc', descriptionForeground: '#ccccccb3', 'textLink-foreground': '#3794ff',
    'testing-iconPassed': '#73c991', 'widget-shadow': '#0000005c', 'button-background': '#0e639c',
};
const vars = {};
for (const [key, value] of Object.entries(atom)) vars[`--vscode-${key}`] = value;
const declarations = (block) => Object.fromEntries([...block.matchAll(/(--tk-[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
Object.assign(vars, declarations(talk.slice(talk.indexOf('.talk-prototype {'), talk.indexOf('position: relative')))); // light/base defaults
const darkVars = declarations(dark.slice(dark.indexOf('.talk-prototype {'), dark.indexOf('}', dark.indexOf('.talk-prototype {'))));
Object.assign(vars, darkVars);

const splitArgs = (text) => { const out = []; let depth = 0; let current = ''; for (const ch of text) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; } else current += ch; } out.push(current.trim()); return out; };
function resolve(expression) {
    const text = expression.trim();
    if (text === 'transparent') return [0, 0, 0, 0];
    if (text.startsWith('#')) {
        let hex = text.slice(1);
        if (hex.length === 3) hex = [...hex].map(c => c + c).join('');
        return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1);
    }
    const call = /^([\w-]+)\((.*)\)$/s.exec(text);
    assert.ok(call, `cannot evaluate: ${text}`);
    const args = splitArgs(call[2]);
    if (call[1] === 'var') { const value = vars[args[0]]; return value !== undefined ? resolve(value) : resolve(args.slice(1).join(',')); }
    assert.equal(call[1], 'color-mix', `unsupported function ${call[1]}`);
    const part = (arg) => { const m = /^(.*?)\s+([\d.]+)%$/s.exec(arg); return m ? [resolve(m[1]), Number(m[2]) / 100] : [resolve(arg), undefined]; };
    let [a, pa] = part(args[1]); let [b, pb] = part(args[2]);
    if (pa === undefined && pb === undefined) { pa = 0.5; pb = 0.5; } else if (pa === undefined) pa = 1 - pb; else if (pb === undefined) pb = 1 - pa;
    const alpha = a[3] * pa + b[3] * pb;
    const total = pa * a[3] + pb * b[3];
    return [0, 1, 2].map(i => (a[i] * pa * a[3] + b[i] * pb * b[3]) / (total || 1)).concat(alpha);
}
const over = (top, under) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
const lum = (c) => { const [r, g, b] = c.slice(0, 3).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const colour = (name) => resolve(`var(${name})`);

const wallpaper = over(colour('--tk-wallpaper'), [0, 0, 0, 1]);
const incoming = over(colour('--tk-in'), wallpaper);
const outgoing = over(colour('--tk-out'), wallpaper);
const key = (c) => c.slice(0, 3).map(Math.round).join(',');
assert.equal(new Set([key(wallpaper), key(incoming), key(outgoing)]).size, 3, 'incoming, outgoing and wallpaper are three different colours');
assert.deepEqual(colour('--tk-wallpaper').slice(0, 3).map(Math.round), resolve('#232e33').slice(0, 3), 'the wallpaper is the side bar colour');
assert.ok(contrast(incoming, wallpaper) >= 1.1, `incoming bubble vs wallpaper ${contrast(incoming, wallpaper).toFixed(2)}`);
assert.ok(contrast(outgoing, wallpaper) >= 1.1, `outgoing bubble vs wallpaper ${contrast(outgoing, wallpaper).toFixed(2)}`);
assert.ok(contrast(incoming, outgoing) >= 1.05 || key(incoming) !== key(outgoing), 'incoming and outgoing differ');
const fg = colour('--tk-fg'); const muted = over(colour('--tk-muted'), incoming);
for (const [name, bubble] of [['incoming', incoming], ['outgoing', outgoing]]) {
    assert.ok(contrast(over(fg, bubble), bubble) >= 4.5, `${name} text contrast`);
    assert.ok(contrast(over(colour('--tk-muted'), bubble), bubble) >= 4.5, `${name} muted text contrast ${contrast(over(colour('--tk-muted'), bubble), bubble).toFixed(2)}`);
}
assert.ok(contrast(muted, wallpaper) >= 4.5, 'muted text on the wallpaper');
const edge = over(colour('--tk-edge'), incoming);
assert.ok(contrast(edge, incoming) >= 1.1, 'the bubble border is visible');
assert.ok(contrast(over(colour('--tk-border'), wallpaper), wallpaper) >= 1.3, 'header / composer border is visible');
console.log(`PASS EV-DARK-THEME-AITALK: dark rules theme-variables only; bubble/wallpaper contrast in=${contrast(incoming, wallpaper).toFixed(2)} out=${contrast(outgoing, wallpaper).toFixed(2)}; text>=4.5; light rules untouched`);
