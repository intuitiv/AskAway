const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const storybook = path.resolve(__dirname, '..');
const staticRoot = path.join(storybook, 'storybook-static');
const repo = path.resolve(storybook, '../..');
const output = path.join(repo, 'tasksync-chat/docs/screenshots');
const captures = [
    { name: 'aitalk-room.png', id: 'aitalk-talk--full-conversation', selector: '.talk-prototype', content: '.talk-bubble' },
    { name: 'workers-tab.png', id: 'askaway-sample-conversation--turn-one-done', selector: '.aa-sidebar:has(#panel-team)', content: '#workers-list' },
    { name: 'trace-tab.png', id: 'aitalk-trace-tab--main-workers-and-validator', selector: '.talk-trace', content: '.talk-trace-session', tab: 'Trace' },
];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

async function main() {
    const index = JSON.parse(await fs.readFile(path.join(staticRoot, 'index.json'), 'utf8'));
    for (const capture of captures) assert.ok(index.entries[capture.id], `Missing story ${capture.id}; run npm run build-storybook in ${storybook}`);
    const server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            const file = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(staticRoot + path.sep)) { response.writeHead(403).end(); return; }
            const bytes = await fs.readFile(file);
            response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(bytes);
        } catch { response.writeHead(404).end(); }
    });
    let browser;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        browser = await chromium.launch();
        const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 3, colorScheme: 'dark' });
        await fs.mkdir(output, { recursive: true });
        for (const capture of captures) {
            const errors = [];
            const onError = error => errors.push(error.message);
            page.on('pageerror', onError);
            await page.goto(`http://127.0.0.1:${server.address().port}/iframe.html?id=${capture.id}&viewMode=story`, { waitUntil: 'networkidle' });
            // VS Code normally supplies these host variables; the standalone iframe does not.
            await page.addStyleTag({ content: `:root {
                --vscode-editor-background: #1f1f1f;
                --vscode-editorWidget-background: #252526;
                --vscode-sideBar-background: #181818;
                --vscode-descriptionForeground: #9d9d9d;
                --vscode-textLink-foreground: #4daafc;
                --vscode-focusBorder: #0078d4;
                --vscode-testing-iconPassed: #89d185;
                --vscode-charts-purple: #b180d7;
                --vscode-charts-orange: #d18616;
                --vscode-widget-shadow: rgba(0,0,0,.36);
            } body { background: #1f1f1f; }` });
            if (capture.tab) await page.locator(`button[data-tab="${capture.tab}"]`).click();
            const component = page.locator(capture.selector);
            await component.waitFor({ state: 'visible' });
            assert.notEqual(await component.evaluate(element => getComputedStyle(element.closest('.talk-prototype') || element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Component must have an opaque dark background');
            await page.locator(capture.content).first().waitFor({ state: 'visible' });
            assert.ok((await page.locator(capture.content).first().innerText()).trim(), `Empty ${capture.name}`);
            await page.evaluate(() => document.fonts.ready);
            await page.mouse.move(0, 0);
            const file = path.join(output, capture.name);
            await component.screenshot({ path: file, animations: 'disabled' });
            page.off('pageerror', onError);
            assert.deepEqual(errors, [], `Story errors: ${capture.id}`);
            const png = await fs.readFile(file);
            assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            const width = png.readUInt32BE(16);
            const height = png.readUInt32BE(20);
            assert.ok(width >= 1100 && width <= 1300 && height > 0, `Unexpected dimensions ${width}x${height}`);
            const relative = path.relative(repo, file).split(path.sep).join('/');
            for (const readme of ['README.md', 'tasksync-chat/README.md']) {
                const text = await fs.readFile(path.join(repo, readme), 'utf8');
                const link = readme === 'README.md' ? relative : `https://raw.githubusercontent.com/intuitiv/TaskSync/main/${relative}`;
                assert.ok(text.includes(`](${link})`), `${readme} must link ${capture.name}`);
            }
            console.log(`${relative}: ${png.length} bytes (${width}x${height}) — ${capture.id}`);
        }
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
