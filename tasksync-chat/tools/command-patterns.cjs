#!/usr/bin/env node
// Should the main agent's terminal commands be grouped into a bash/git worker?
// Usage: node tools/command-patterns.cjs [--json] <main.jsonl> [<main.jsonl> ...]
const fs = require('node:fs');

const READ_WORDS = new Set(['rg', 'grep', 'find', 'ls', 'cat', 'head', 'tail']);

function family(command) {
    const words = String(command || '').trim().replace(/^rtk\s+/, '').split(/\s+/).filter(Boolean);
    const first = words[0] || '';
    if (first === 'git') { return words[1] ? `git ${words[1]}` : 'git'; }
    if (first === 'npm' || first === 'node') { return 'npm/node'; }
    if (first === 'npx') { return words[1] === 'tsc' || words[1] === 'esbuild' ? `npx ${words[1]}` : 'other'; }
    if (first === 'cp') { return 'cp'; }
    if (READ_WORDS.has(first)) { return 'read'; }
    if (first === 'opencode') { return 'opencode'; }
    return 'other';
}

const isGit = (command) => /^git(\s|$)/.test(String(command || '').trim().replace(/^rtk\s+/, ''));

function parseArgs(raw) {
    try { const value = JSON.parse(raw); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}

function bump(map, key, by = 1) { map[key] = (map[key] || 0) + by; }

function analyzeFile(file) {
    const result = {
        file, turns: 0, toolCalls: {}, terminalCommands: 0, gitCommands: 0, families: {}, workerActions: {}, bursts: [],
    };
    let turn = [];
    const flush = () => {
        collectBursts(turn, result);
        turn = [];
    };
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) { continue; }
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (!event || typeof event !== 'object') { continue; }
        if (event.type === 'user_message') { flush(); result.turns++; continue; }
        if (event.type === 'llm_request') { turn.push({ kind: 'llm', attrs: event.attrs || {} }); continue; }
        if (event.type !== 'tool_call') { continue; }
        const name = String(event.name || 'unknown');
        bump(result.toolCalls, name);
        const args = parseArgs(event.attrs?.args);
        if (name === 'run_in_terminal') {
            const command = String(args.command || '');
            result.terminalCommands++;
            if (isGit(command)) { result.gitCommands++; }
            bump(result.families, family(command));
            turn.push({ kind: 'cmd', command });
        } else {
            if (name === 'worker') { bump(result.workerActions, String(args.action || 'unknown')); }
            turn.push({ kind: 'other' });
        }
    }
    flush();
    return result;
}

/** A burst is a maximal run of >=2 terminal commands with no other tool call between them. */
function collectBursts(events, result) {
    let run = [];
    const close = () => {
        if (run.length >= 2) {
            const first = events.indexOf(run[0]);
            const last = events.indexOf(run[run.length - 1]);
            const between = events.slice(first, last + 1).filter((e) => e.kind === 'llm');
            const nano = between.reduce((sum, e) => sum + (Number(e.attrs.copilotUsageNanoAiu) || 0), 0);
            result.bursts.push({
                length: run.length, commands: run.map((e) => e.command), requestsBetween: between.length,
                aiuBetween: nano / 1e9, inputTokensBetween: between.reduce((sum, e) => sum + (Number(e.attrs.inputTokens) || 0), 0),
            });
        }
        run = [];
    };
    for (const event of events) {
        if (event.kind === 'cmd') { run.push(event); } else if (event.kind === 'other') { close(); }
    }
    close();
}

function summarize(files) {
    const burstCommands = files.reduce((n, f) => n + f.bursts.reduce((m, b) => m + b.length, 0), 0);
    const commands = files.reduce((n, f) => n + f.terminalCommands, 0);
    const git = files.reduce((n, f) => n + f.gitCommands, 0);
    return {
        burstCommands,
        requestsBetween: files.reduce((n, f) => n + f.bursts.reduce((m, b) => m + b.requestsBetween, 0), 0),
        aiuBetween: files.reduce((n, f) => n + f.bursts.reduce((m, b) => m + b.aiuBetween, 0), 0),
        gitShare: commands ? git / commands : 0,
        terminalCommands: commands,
        gitCommands: git,
    };
}

function total(files) {
    const sum = { file: 'TOTAL', turns: 0, toolCalls: {}, terminalCommands: 0, gitCommands: 0, families: {}, workerActions: {}, bursts: [] };
    for (const f of files) {
        sum.turns += f.turns;
        sum.terminalCommands += f.terminalCommands;
        sum.gitCommands += f.gitCommands;
        for (const k of Object.keys(f.toolCalls)) { bump(sum.toolCalls, k, f.toolCalls[k]); }
        for (const k of Object.keys(f.families)) { bump(sum.families, k, f.families[k]); }
        for (const k of Object.keys(f.workerActions)) { bump(sum.workerActions, k, f.workerActions[k]); }
        sum.bursts.push(...f.bursts);
    }
    return sum;
}

function text(report) {
    const out = [];
    for (const f of [...report.files, report.total]) {
        out.push(`== ${f.file}`, `reviewer turns: ${f.turns}`, `terminal commands: ${f.terminalCommands}`,
            `tool calls: ${JSON.stringify(f.toolCalls)}`, `families: ${JSON.stringify(f.families)}`, `worker actions: ${JSON.stringify(f.workerActions)}`);
        for (const b of f.bursts) {
            out.push(`burst of ${b.length}: ${b.commands.join(' ; ')} | ${b.requestsBetween} requests between, ${b.aiuBetween.toFixed(4)} AIU, ${b.inputTokensBetween} input tokens`);
        }
    }
    const s = report.summary;
    out.push(`SUMMARY: ${s.burstCommands} burst commands, ${s.requestsBetween} requests between them, ${s.aiuBetween.toFixed(4)} AIU, git share ${(s.gitShare * 100).toFixed(0)}%`);
    return out.join('\n');
}

function main(argv) {
    const json = argv.includes('--json');
    const paths = argv.filter((a) => a !== '--json');
    if (paths.length === 0) { console.error('usage: command-patterns.cjs [--json] <main.jsonl>...'); process.exit(2); }
    const files = paths.map(analyzeFile);
    const report = { files, total: total(files), summary: summarize(files) };
    console.log(json ? JSON.stringify(report, null, 2) : text(report));
}

main(process.argv.slice(2));
