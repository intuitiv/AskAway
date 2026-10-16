'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const ts = require('typescript');

const root = __dirname;
const providerPath = path.join(root, 'src', 'webview', 'webviewProvider.ts');
const rosterPath = path.join(root, 'src', 'team', 'roster.ts');
const workersStatePath = path.join(root, 'src', 'workers', 'workersState.ts');
const teamCssPath = path.join(root, 'media', 'team', 'team.css');

function loadTsModule(filePath, extraMocks = {}) {
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
        fileName: filePath,
    }).outputText;
    const mod = { exports: {} };
    const dirname = path.dirname(filePath);
    const customRequire = (id) => {
        if (id in extraMocks) return extraMocks[id];
        if (id.startsWith('.')) {
            const resolvedTs = path.resolve(dirname, id + '.ts');
            if (fs.existsSync(resolvedTs)) {
                return loadTsModule(resolvedTs, extraMocks);
            }
        }
        return require(id);
    };
    vm.runInThisContext(
        `(function (exports, require, module, __filename, __dirname) { ${transpiled}\n})`
    )(mod.exports, customRequire, mod, filePath, dirname);
    return mod.exports;
}

(async () => {
    // 1. Verify webviewProvider.ts CRLF, top-bar tab order, data-tab="team", #panel-team, and team.css link
    const providerSrc = fs.readFileSync(providerPath, 'utf8');

    const tabsBlockMatch = providerSrc.match(/<div class="widget-tabs"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(tabsBlockMatch, 'widget-tabs block must exist in webviewProvider.ts');
    const tabsBlock = tabsBlockMatch[1];

    const buttonRegex = /<button class="widget-tab[^"]*"\s+data-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
    const dataTabs = [];
    const labels = [];
    let match;
    while ((match = buttonRegex.exec(tabsBlock)) !== null) {
        dataTabs.push(match[1]);
        const cleanLabel = match[2].replace(/<span[\s\S]*?<\/span>/g, '').trim();
        labels.push(cleanLabel);
    }

    assert.deepEqual(
        labels,
        ['AITalk', 'Specs', 'Trace', 'Team', 'Settings'],
        'Top-bar tab labels must be in exact order: AITalk · Specs · Trace · Team · Settings (R-TEAM-01)'
    );
    assert.deepEqual(
        dataTabs,
        ['aitalk', 'specs', 'observability', 'team', 'settings'],
        'Top-bar data-tab attributes must use "team" for the 4th tab'
    );
    assert.ok(!tabsBlock.includes('>Workers<'), 'Top bar must not show legacy Workers label');
    assert.ok(!tabsBlock.includes('data-tab="workers"'), 'Top bar must not use data-tab="workers"');
    assert.ok(
        tabsBlock.includes('id="tab-badge-team"'),
        'Team tab button must have badge id="tab-badge-team"'
    );
    assert.ok(
        tabsBlock.includes('title="Team members in this workspace: state, cost, session links"'),
        'Team tab button must preserve its descriptive title tooltip'
    );

    assert.ok(
        providerSrc.includes('<div class="tab-panel" id="panel-team">'),
        'Team panel container must have id="panel-team"'
    );
    assert.ok(
        !providerSrc.includes('id="panel-workers"'),
        'webviewProvider.ts must not contain legacy id="panel-workers"'
    );
    assert.ok(
        providerSrc.includes("'media', 'team', 'team.css'") &&
            providerSrc.includes('<link href="${teamStyleUri}" rel="stylesheet">'),
        '_getHtmlContent must load media/team/team.css via asWebviewUri'
    );
    assert.ok(
        providerSrc.includes("'media', 'team', 'avatars'"),
        '_refreshWorkersState must resolve avatarSrc from media/team/avatars via asWebviewUri'
    );

    // 2. Verify src/team/roster.ts matches storybook/prototypes/team.js and resolves main agent identities
    const protoMod = await import(pathToFileURL(path.join(root, 'storybook', 'prototypes', 'team.js')).href);
    const rosterMod = loadTsModule(rosterPath);
    const sharedKit = protoMod.getWorkersKit();
    const sharedMember = protoMod.TEAM_ROSTER_FIXTURES[3];
    const sharedState = { now: 1700000000000, expandedTasksByMember: {} };
    const normalizedMember = sharedKit.normalizeTeamMember({ ...sharedMember, pinned: sharedMember.pinnedFirst, avatarSrc: protoMod.avatarFor(sharedMember.id), turnCost: sharedMember.turnDollars, monthCost: sharedMember.monthDollars, creativeStatus: sharedMember.idleStatus });
    assert.equal(protoMod.renderMemberRowHtml(sharedMember, sharedState), sharedKit.teamMemberRowHtml(normalizedMember, [], { generatedAt: sharedState.now, memberSettings: { [sharedMember.id]: { model: sharedMember.model } }, validatorTrace: [] }, { ['member:' + sharedMember.id]: false, highlightedMember: undefined }, undefined, {}), 'Storybook uses the production shared pure row renderer');

    assert.ok(Array.isArray(rosterMod.TEAM_ROSTER), 'TEAM_ROSTER must be exported as an array');
    // Rhea (Pega rules authoring) comes from the user's own profiles, not the extension (R-TEAM-46).
    assert.equal(rosterMod.TEAM_ROSTER.length, 11, 'TEAM_ROSTER ships 11 built-in members');
    const withoutCosts = ({ turnDollars, monthDollars, traceEvents, ...rest }) => JSON.parse(JSON.stringify(rest));
    assert.deepEqual(
        Array.from(rosterMod.TEAM_ROSTER, withoutCosts),
        Array.from(protoMod.TEAM_ROSTER_FIXTURES, withoutCosts),
        'TEAM_ROSTER (every field except costs and storybook-only traceEvents) must match storybook TEAM_ROSTER_FIXTURES'
    );

    assert.equal(
        rosterMod.resolveMainAgentIdentity('AA.Orchestrator').name,
        'Mahesh',
        'AA.Orchestrator must resolve to Mahesh'
    );
    assert.equal(
        rosterMod.resolveMainAgentIdentity('AskAway Build').name,
        'Bhaskar',
        'AskAway Build must resolve to Bhaskar'
    );
    const unknownIdentity = rosterMod.resolveMainAgentIdentity('Foo Agent');
    assert.equal(unknownIdentity.name, 'Foo Agent', 'Unknown agent must preserve raw name');
    assert.equal(unknownIdentity.initials, 'FA', 'Unknown agent must compute 2-letter initials');

    // 3. Verify src/workers/workersState.ts projects TeamMemberState[] with zero agy cost
    const workersStateMod = loadTsModule(workersStatePath);
    assert.equal(typeof workersStateMod.projectWorkersState, 'function');
    assert.equal(typeof workersStateMod.projectTeamMembers, 'function');

    const state = workersStateMod.projectWorkersState({
        list: () => [
            {
                workerId: 'w-agy-1',
                profile: 'build',
                adapter: 'agy',
                model: 'agy/gemini-4-argon-high',
                state: 'RUNNING',
                task: 'Implement Team shell',
                startedAt: 1700000000000,
                updatedAt: 1700000060000,
                usage: {
                    input: 1200,
                    output: 400,
                    reasoning: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    cost: 4.56,
                    steps: 2,
                },
            },
        ],
        facts: () => [],
        router: { worker: () => undefined, cacheExpiresAt: () => 0 },
        serverEndpoint: '',
    }, '/tmp/workspace');

    assert.ok(Array.isArray(state.members), 'projectWorkersState must return members array');
    assert.equal(state.members[0].id, 'priya', 'Priya (CPO) must be pinned first in state.members');
    assert.equal(state.members[0].pinned, true, 'Priya must have pinned: true');

    // Reviewer 2026-10-16: Bhaskar is the AskAway Build chat agent; the `build` worker task belongs to Anika.
    assert.ok(!state.members.some((m) => m.id === 'bhaskar'), 'no worker task is projected onto the main agent Bhaskar');
    const builder = state.members.find((m) => m.id === 'anika');
    assert.ok(builder, 'Anika (build profile) must be present in state.members');
    assert.equal(builder.adapter, 'agy', 'Anika running on agy must report adapter === "agy"');
    assert.equal(builder.turnCost, 0, 'agy worker must report turnCost === 0');
    assert.equal(builder.monthCost, 0, 'agy worker must report monthCost === 0');
    assert.equal(builder.avatarSrc, '', 'avatarSrc must default to empty string before webview URI enrichment');

    // 4. Verify media/team/team.css width rule and scoping (#panel-team full width, no bare #panel-aitalk override)
    const teamCss = fs.readFileSync(teamCssPath, 'utf8');
    assert.ok(
        !/^\s*#panel-aitalk\b/m.test(teamCss),
        'team.css must not target bare #panel-aitalk outside .team-storybook-shell'
    );
    assert.ok(
        /#panel-team\s*\{[^}]*width:\s*100%/s.test(teamCss),
        '#panel-team must use width: 100% in team.css to match other tabs (R-TEAM-31)'
    );

    console.log('PASS EV-TEAM-SHELL (tabs, #panel-team, roster, workersState members, agy $0 cost, team.css scoping)');
})();
