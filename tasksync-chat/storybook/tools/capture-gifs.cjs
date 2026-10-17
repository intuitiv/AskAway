// Records the README GIFs from the Storybook build, which renders the real webview markup, render code and CSS.
// Run: npm run build-storybook (or set SB_STATIC to any built folder), then node tools/capture-gifs.cjs [clip-name ...]
// Needs Playwright's Chromium and ffmpeg. Output: ../docs/screenshots/<name>.gif
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const storybook = path.resolve(__dirname, '..');
const staticRoot = path.resolve(process.env.SB_STATIC || path.join(storybook, 'storybook-static'));
const output = path.resolve(storybook, '../docs/screenshots');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// VS Code normally supplies these host variables; the standalone iframe does not.
const THEME = `:root {
    --vscode-editor-background: #1f1f1f; --vscode-editorWidget-background: #252526; --vscode-sideBar-background: #181818;
    --vscode-descriptionForeground: #9d9d9d; --vscode-textLink-foreground: #4daafc; --vscode-focusBorder: #0078d4;
    --vscode-foreground: #cccccc; --vscode-panel-border: #2b2b2b; --vscode-testing-iconPassed: #89d185;
    --vscode-charts-purple: #b180d7; --vscode-charts-orange: #d18616; --vscode-widget-shadow: rgba(0,0,0,.36);
    --vscode-scrollbarSlider-background: rgba(121,121,121,.4); --vscode-scrollbarSlider-hoverBackground: rgba(100,100,100,.7);
} body { background: #1f1f1f; }`;

// Both clips replay the Team story's 40 s turn with the real Team names: Bhaskar (main agent) asks Priya (validator),
// Anika, Diego and Tara pick up tasks, and the user @-mentions Diego. AITalk shows the conversation; Team shows the members.
const panelScroll = page => page.evaluate(() => (document.getElementById('panel-team') || {}).scrollTop || 0);
const clips = [
    { name: 'aitalk-live.gif', id: 'aitalk-team-tab--active-turn', seconds: 36, fps: 10, width: 380, speed: 1.5 },
    {
        name: 'team-tab.gif', id: 'aitalk-team-tab--active-turn', args: 'activeTab:team', seconds: 42, fps: 8, width: 360, speed: 1.6,
        act: async page => {
            const at = async seconds => { await page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - started))); };
            const started = Date.now();
            await page.mouse.move(210, 420);
            // Diego picks up two tasks at ~16 s: open them, then scroll the list so the scrollbar is seen.
            await at(18);
            await page.locator('[data-member-tasks-toggle="diego"]').click();
            await at(21);
            for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(100); }
            assert.ok(await panelScroll(page) > 100, 'the Team list really scrolls');
            await at(25);
            for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(100); }
            await page.locator('[data-member-tasks-toggle="diego"]').click();
            // Tara verifies at ~32 s and the tasks complete at ~36 s.
            await at(41);
        },
    },
];

function ffmpeg(args) {
    const result = childProcess.spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
}

async function record(browser, port, clip, tmp) {
    const viewport = clip.viewport || { width: 900, height: 900 };
    const context = await browser.newContext({ viewport, colorScheme: 'dark', recordVideo: { dir: tmp, size: viewport } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const startedAt = Date.now();
    await page.goto(`http://127.0.0.1:${port}/iframe.html?id=${clip.id}&viewMode=story${clip.args ? '&args=' + clip.args : ''}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: THEME });
    const root = page.locator('#storybook-root > *').first();
    await root.waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    const box = await root.boundingBox();
    assert.ok(box && box.width > 100 && box.height > 100, `Story ${clip.id} rendered nothing`);
    const readyAt = (Date.now() - startedAt) / 1000;
    const recordingStart = Date.now();
    if (clip.act) { await clip.act(page); }
    const remaining = clip.seconds * 1000 - (Date.now() - recordingStart);
    if (remaining > 0) { await page.waitForTimeout(remaining); }
    const video = page.video();
    await context.close();
    assert.deepEqual(errors, [], `Story errors: ${clip.id}`);
    return { file: await video.path(), readyAt, box, viewport };
}

function encode(clip, recorded, destination) {
    const pad = 6;
    const x = Math.max(0, Math.floor(recorded.box.x) - pad);
    const y = Math.max(0, Math.floor(recorded.box.y) - pad);
    const w = Math.min(recorded.viewport.width - x, Math.ceil(recorded.box.width) + pad * 2) & ~1;
    const h = Math.min(recorded.viewport.height - y, Math.ceil(recorded.box.height) + pad * 2) & ~1;
    const speed = clip.speed || 1;
    const filter = `crop=${w}:${h}:${x}:${y},setpts=PTS/${speed},fps=${clip.fps},scale=${clip.width}:-2:flags=lanczos`;
    ffmpeg(['-ss', String(recorded.readyAt + 0.2), '-i', recorded.file, '-t', String(clip.seconds / speed),
        '-vf', `${filter},split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        '-loop', '0', destination]);
}

async function main() {
    const wanted = process.argv.slice(2);
    const selected = clips.filter(clip => !wanted.length || wanted.includes(clip.name) || wanted.includes(clip.name.replace(/\.gif$/, '')));
    assert.ok(selected.length, `No clip matches ${wanted.join(', ')}`);
    const index = JSON.parse(await fs.readFile(path.join(staticRoot, 'index.json'), 'utf8'));
    for (const clip of selected) { assert.ok(index.entries[clip.id], `Missing story ${clip.id}; run npm run build-storybook in ${storybook}`); }
    const server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            const file = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(staticRoot + path.sep)) { response.writeHead(403).end(); return; }
            response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(await fs.readFile(file));
        } catch { response.writeHead(404).end(); }
    });
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'askaway-gif-'));
    let browser;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        // Playwright hides scrollbars in headless mode by default; the GIFs should show them.
        browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
        await fs.mkdir(output, { recursive: true });
        for (const clip of selected) {
            const recorded = await record(browser, server.address().port, clip, tmp);
            const destination = path.join(output, clip.name);
            encode(clip, recorded, destination);
            const bytes = (await fs.stat(destination)).size;
            console.log(`${path.relative(path.resolve(storybook, '../..'), destination)}: ${(bytes / 1048576).toFixed(2)} MB — ${clip.id}`);
        }
    } finally {
        if (browser) { await browser.close(); }
        await new Promise(resolve => server.close(resolve));
        await fs.rm(tmp, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
