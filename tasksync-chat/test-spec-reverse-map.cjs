const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));
const repo = path.dirname(__dirname);
const slugs = ['005-speckit-guided-flow', '007-validator-agent', '001-async-subagent-runner'];
const texts = Object.fromEntries(slugs.map(slug => [slug, Object.fromEntries(['spec.md', 'tasks.md'].map(name =>
    [name, fs.readFileSync(path.join(repo, 'specs', slug, name), 'utf8')]))]));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = slugs.flatMap(slug => ['spec.md', 'tasks.md'].map(name => path.join(repo, 'specs', slug, name)));
const before = files.map(hash);
const build = path.join(__dirname, '.spec-reverse-map-build');
fs.mkdirSync(build, { recursive: true });
try {
    for (const name of ['stages', 'runRecords', 'staleness', 'specKitScanner']) {
        fs.writeFileSync(path.join(build, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8'),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
    }
    const { scanSpecs } = require(path.join(build, 'specKitScanner'));
    const scan = scanSpecs(repo);
    const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
    new vm.Script(webview);
    const list = { innerHTML: '' };
    const ui = { specsShowDone: true, specsShowAll: true, specsWorkExpanded: {}, specsExpanded: {}, specsState: scan,
        SPEC_STAGE_LABEL: {}, document: { getElementById: id => id === 'specs-list' ? list : null },
        escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') };
    vm.createContext(ui);
    vm.runInContext(webview.slice(webview.indexOf('function specAgo(ms)'), webview.indexOf('function onSpecsListClick(e)')), ui);
    const counts = [];
    for (const slug of slugs) {
        const spec = scan.specs.find(spec => spec.slug === slug);
        assert.ok(spec, slug);
        const stories = [...texts[slug]['spec.md'].matchAll(/^### User Story (\d+)\s*[-–—:]\s*(.+)$/gm)];
        const tasks = texts[slug]['tasks.md'].split(/\r?\n/).map(line => /^\s*-\s*\[([ xX])\]\s+(T\d+[a-z]?)\s+(.*)$/.exec(line)).filter(Boolean);
        assert.equal(spec.stories.length, stories.length);
        assert.equal(spec.tasks.length, tasks.length);
        ui.specsState = { ...scan, specs: [spec] };
        ui.specsExpanded[slug] = true;
        ui.renderSpecs();
        const html = list.innerHTML;
        const groups = [...html.matchAll(/<details class="spec-work-phase"[^>]*data-work-key="([^"]+)"[^>]*>([\s\S]*?)<\/details>/g)];
        const byId = new Map(groups.map(group => [group[1].split('|').at(-1), group[2]]));
        const headings = groups.map(group => /class="spec-phase-name">([\s\S]*?)<\/span>/.exec(group[2])[1]);
        assert.ok(headings.every(heading => !/Phase|CY-/.test(heading)), 'no phase or cycle headings');
        assert.doesNotMatch(html, /<details class="spec-cycle"|class="spec-cycle-id"/);
        for (const story of stories) {
            const group = byId.get('US' + story[1]);
            assert.ok(group && group.includes(ui.formatSpecInline(story[2])), `story ${story[1]} appears`);
            const parsed = spec.stories.find(item => item.id === 'US' + story[1]);
            if (parsed.independentTest) assert.ok(group.includes(ui.formatSpecInline(parsed.independentTest)));
        }
        let mapped = 0, unlinked = 0;
        for (const task of tasks) {
            const story = /\[US(\d+)\]/i.exec(task[3]);
            const id = story ? 'US' + story[1] : 'unlinked';
            const group = byId.get(id);
            assert.ok(group && group.includes(`class="spec-work-id">${task[2]}</span>`), `${slug} ${task[2]} under ${id}`);
            assert.equal(groups.filter(group => group[2].includes(`class="spec-work-id">${task[2]}</span>`)).length, 1, 'task appears in exactly one group');
            story ? mapped++ : unlinked++;
        }
        if (unlinked) assert.equal(groups.at(-1)[1], slug + '|story|unlinked', 'unlinked group is last');
        assert.equal(groups.length, stories.length + (unlinked ? 1 : 0));
        counts.push(`${slug.slice(0, 3)} stories=${stories.length} mapped=${mapped} unlinked=${unlinked}`);
    }
    assert.deepEqual(files.map(hash), before, 'scanning/rendering never changes spec or task bytes');
    console.log('PASS EV-SPEC-REVERSE-MAP ' + counts.join('; ') + '; bytes unchanged');
} finally {
    fs.rmSync(build, { recursive: true, force: true });
}
