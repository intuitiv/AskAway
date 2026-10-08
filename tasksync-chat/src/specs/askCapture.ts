import * as fs from 'fs';
import * as path from 'path';

export type AskKind = 'request' | 'bug' | 'correction' | 'side remark' | 'repeated ask';
export interface AskQuestion {
    text: string;
    options: string[];
    recommendation: string;
    answer?: string;
}
export interface CapturedAsk {
    kind: AskKind;
    text: string;
    existingRow?: { file: string; id: string };
    questions?: AskQuestion[];
}
export interface AskRow {
    file: string;
    id: string;
    text: string;
    done: boolean;
    evidence: string;
    waitingReason?: string;
    questions?: AskQuestion[];
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
const identity = (text: string): string => clean(text).toLowerCase();
// Task-line grammar from specKitScanner.ts TASK_LINE, including suffixed IDs.
const TASK_LINE = /^\s*[-*]\s*\[([ xX])\]\s*(T\d+[a-zA-Z]*)?\s*(.*)$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class AskRefusal extends Error {
    constructor(message: string, public candidates?: Array<{ file: string; id: string; text: string }>) { super(message); }
}

export function containedAskPath(root: string, file: string): string {
    if (file !== 'specs' && !/^specs\/(?:BACKLOG\.md|\d+-[a-z0-9-]+\/tasks\.md)$/.test(file)) { throw new AskRefusal('Invalid ask row file'); }
    const workspace = fs.realpathSync(root);
    const base = path.join(workspace, 'specs');
    const absolute = path.join(workspace, file);
    let ancestor = absolute;
    const missing: string[] = [];
    while (!fs.existsSync(ancestor)) {
        // A dangling symlink must not be treated as a new target.
        try { if (fs.lstatSync(ancestor).isSymbolicLink()) { throw new AskRefusal('Path escapes workspace specs'); } }
        catch (error) { if (error instanceof AskRefusal) { throw error; } }
        missing.unshift(path.basename(ancestor));
        ancestor = path.dirname(ancestor);
    }
    const resolved = path.join(fs.realpathSync(ancestor), ...missing);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) { throw new AskRefusal('Path escapes workspace specs'); }
    return absolute;
}

function readAskFile(root: string, file: string): string {
    const absolute = containedAskPath(root, file);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { throw new AskRefusal('Ask file exceeds read bound or is not a file'); }
    return fs.readFileSync(absolute, 'utf8');
}

function writeAskFile(root: string, file: string, markdown: string): void {
    const absolute = containedAskPath(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(containedAskPath(root, file), markdown, 'utf8');
}

export function readAskDocuments(root: string): Record<string, string> {
    const dir = containedAskPath(root, 'specs');
    const files = ['specs/BACKLOG.md'];
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        if (/^\d+-[a-z0-9-]+$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) { files.push(`specs/${entry.name}/tasks.md`); }
    }
    const documents: Record<string, string> = {};
    for (const file of files) {
        const absolute = containedAskPath(root, file);
        if (fs.existsSync(absolute)) { documents[file] = readAskFile(root, file); }
    }
    return documents;
}

function uniqueRow(tracked: AskRow[], ref: { file: string; id: string }): AskRow {
    const candidates = tracked.filter(row => row.file === ref.file && row.id === ref.id);
    if (candidates.length > 1) { throw new AskRefusal('Ambiguous ask reference', candidates.map(({ file, id, text }) => ({ file, id, text }))); }
    if (!candidates.length) { throw new AskRefusal('Referenced ask row does not exist'); }
    return candidates[0];
}

function rows(file: string, markdown: string, lineNumbers?: number[]): AskRow[] {
    const result: AskRow[] = [];
    const lines = markdown.split(/\r?\n/);
    let inTable = false;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const task = TASK_LINE.exec(line);
        const cells = line.startsWith('|') ? line.split('|').slice(1, -1).map(cell => cell.trim()) : [];
        if (cells.length === 5 && /^\|(?:\s*:?-+:?\s*\|){5}\s*$/.test(lines[index + 1] || '')) { inTable = cells[0] === 'ID'; index++; continue; }
        if (!cells.length && !line.startsWith('<!-- ask-questions ')) { inTable = false; }
        if ((!task || !task[2]) && (!inTable || cells.length !== 5 || cells[0] === 'ID' || /^:?-+:?$/.test(cells[0]))) { continue; }
        const rawText = task ? task[3].replace(/^(?:\[[^\]]+\]\s*)+/, '') : cells[1].replace(/&#124;/g, '|');
        const outcomeAt = /\s+(Evidence|Waiting):\s*/i.exec(rawText);
        const waitingReason = task
            ? (outcomeAt?.[1].toLowerCase() === 'waiting' ? rawText.slice(outcomeAt.index + outcomeAt[0].length) : '')
            : (/^(WAITING|BLOCKED|NEEDS-DECISION)\b/i.test(cells[2]) ? cells[3].replace(/&#124;/g, '|') : '');
        lineNumbers?.push(index);
        result.push({
            file, id: task ? task[2] : cells[0],
            text: outcomeAt ? rawText.slice(0, outcomeAt.index) : rawText,
            done: task ? task[1].toLowerCase() === 'x' : /^DONE\b/i.test(cells[2]),
            evidence: task ? (outcomeAt?.[1].toLowerCase() === 'evidence' ? rawText.slice(outcomeAt.index + outcomeAt[0].length) : '') : cells[3].replace(/&#124;/g, '|'),
            ...(waitingReason ? { waitingReason } : {})
        });
    }
    for (const match of markdown.matchAll(/^<!-- ask-questions (\S+) (\S+) -->$/gm)) {
        const row = result.find(entry => entry.id === match[1]);
        if (row) { row.questions = JSON.parse(decodeURIComponent(match[2])); }
    }
    return result;
}

function questionMetadata(markdown: string, id: string, questions: AskQuestion[]): string {
    for (const question of questions) {
        if (!clean(question.text) || !question.options.length || question.options.some(option => !clean(option)) || !clean(question.recommendation)) {
            throw new Error('Questions require text, options and a recommendation');
        }
    }
    const marker = `<!-- ask-questions ${id} `;
    const lines = markdown.split('\n').filter(line => !line.startsWith(marker));
    const text = lines.join('\n');
    return `${text}${text.endsWith('\n') ? '' : '\n'}${marker}${encodeURIComponent(JSON.stringify(questions))} -->\n`;
}

/** Pure boundary: callers supply extracted asks, not Spec Kit commands. */
export function captureAskRows(documents: Record<string, string>, target: string, asks: CapturedAsk[]): {
    documents: Record<string, string>; rows: AskRow[];
} {
    const next = { ...documents };
    const tracked = Object.entries(next).flatMap(([file, markdown]) => rows(file, markdown));
    const accounted: AskRow[] = [];
    for (const ask of asks) {
        const text = clean(ask.text);
        if (!text) { throw new Error('An ask must have text'); }
        const existing = ask.existingRow
            ? uniqueRow(tracked, ask.existingRow)
            : tracked.find(row => identity(row.text) === identity(text));
        if (ask.existingRow && !existing) { throw new Error('Referenced ask row does not exist'); }
        if (existing) {
            if (ask.questions) {
                const questions = [...(existing.questions || [])];
                for (const question of ask.questions) {
                    if (!questions.some(entry => identity(entry.text) === identity(question.text))) { questions.push(question); }
                }
                next[existing.file] = questionMetadata(next[existing.file], existing.id, questions);
                existing.questions = questions;
            }
            accounted.push({ ...existing }); continue;
        }
        const backlog = target === 'specs/BACKLOG.md';
        const prefix = backlog ? 'ASK-' : 'T';
        const max = tracked.filter(row => row.file === target && row.id.startsWith(prefix))
            .reduce((value, row) => Math.max(value, parseInt(row.id.slice(prefix.length), 10) || 0), 0);
        const id = `${prefix}${String(max + 1).padStart(3, '0')}`;
        if (!(target in next)) {
            next[target] = backlog
                ? '# Consolidated Backlog\n\n| ID | What | State | Evidence / next check | Source |\n|---|---|---|---|---|\n'
                : '# Tasks\n';
        }
        const line = backlog
            ? `| ${id} | ${text.replace(/\|/g, '&#124;')} | READY | Awaiting work | ${ask.kind} |`
            : `- [ ] ${id} [${ask.kind}] ${text}`;
        next[target] += `${next[target].endsWith('\n') ? '' : '\n'}${line}\n`;
        if (ask.questions) { next[target] = questionMetadata(next[target], id, ask.questions); }
        const row: AskRow = { file: target, id, text, done: false, evidence: '',
            ...(ask.questions ? { questions: ask.questions } : {}) };
        tracked.push(row);
        accounted.push({ ...row });
    }
    return { documents: next, rows: accounted };
}

export function captureAsks(root: string, activeSpec: string | undefined, asks: CapturedAsk[]): AskRow[] {
    if (activeSpec && !/^\d+-[a-z0-9-]+$/.test(activeSpec)) { throw new Error('Invalid spec slug'); }
    const target = activeSpec ? `specs/${activeSpec}/tasks.md` : 'specs/BACKLOG.md';
    containedAskPath(root, target);
    const documents = readAskDocuments(root);
    const result = captureAskRows(documents, target, asks);
    for (const [file, markdown] of Object.entries(result.documents)) {
        if (markdown === documents[file]) { continue; }
        writeAskFile(root, file, markdown);
    }
    return result.rows;
}

export type AskOutcome = { status: 'done'; evidence: string } | { status: 'waiting'; reason: string };
export interface AskProgress {
    file: string;
    id: string;
    text: string;
    status: 'done' | 'waiting' | 'open';
    evidence: string;
    reason: string;
}

/** Coverage-table data derived from persisted rows, without filesystem or rendering dependencies. */
export function askProgressReport(documents: Record<string, string>): AskProgress[] {
    return Object.entries(documents).flatMap(([file, markdown]) => rows(file, markdown)).map(row => {
        const done = row.done && !!row.evidence.trim();
        const reason = row.waitingReason || (row.done && !done ? 'Completion evidence missing' : '');
        return { file: row.file, id: row.id, text: row.text, status: done ? 'done' : reason ? 'waiting' : 'open',
            evidence: done ? row.evidence : '', reason: done ? '' : reason };
    });
}

export function updateAskOutcome(root: string, ref: { file: string; id: string }, outcome: AskOutcome): AskRow {
    if (!/^specs\/(?:BACKLOG\.md|\d+-[a-z0-9-]+\/tasks\.md)$/.test(ref.file)) {
        throw new Error('Invalid ask row file');
    }
    const detail = clean(outcome.status === 'done' ? outcome.evidence : outcome.reason);
    if (!detail) { throw new Error(outcome.status === 'done' ? 'Completion requires evidence' : 'Waiting requires a reason'); }
    const markdown = readAskFile(root, ref.file);
    const lineNumbers: number[] = [];
    const tracked = rows(ref.file, markdown, lineNumbers);
    const selected = uniqueRow(tracked, ref);
    const selectedLine = lineNumbers[tracked.indexOf(selected)];
    const updated = markdown.split('\n').map((line, index) => {
        if (index !== selectedLine) { return line; }
        const task = TASK_LINE.exec(line.replace(/\r$/, ''));
        if (task?.[2] === ref.id) {
            const withoutOutcome = line.replace(/\r$/, '').replace(/\s+(?:Evidence|Waiting):[\s\S]*$/i, '');
            return `${withoutOutcome.replace(/\[([ xX])\]/, outcome.status === 'done' ? '[x]' : '[ ]')} ${outcome.status === 'done' ? 'Evidence' : 'Waiting'}: ${detail}${line.endsWith('\r') ? '\r' : ''}`;
        }
        const cells = line.startsWith('|') ? line.split('|').slice(1, -1).map(cell => cell.trim()) : [];
        if (cells.length === 5 && cells[0] === ref.id) {
            cells[2] = outcome.status === 'done' ? 'DONE' : 'WAITING';
            cells[3] = detail.replace(/\|/g, '&#124;');
            return `| ${cells.join(' | ')} |${line.endsWith('\r') ? '\r' : ''}`;
        }
        return line;
    }).join('\n');
    writeAskFile(root, ref.file, updated);
    return rows(ref.file, updated).find(row => row.id === ref.id)!;
}

export function updateAskQuestions(root: string, ref: { file: string; id: string }, questions: AskQuestion[]): AskRow {
    if (!/^specs\/(?:BACKLOG\.md|\d+-[a-z0-9-]+\/tasks\.md)$/.test(ref.file)) { throw new Error('Invalid ask row file'); }
    const markdown = readAskFile(root, ref.file);
    uniqueRow(rows(ref.file, markdown), ref);
    const updated = questionMetadata(markdown, ref.id, questions);
    writeAskFile(root, ref.file, updated);
    return rows(ref.file, updated).find(row => row.id === ref.id)!;
}

/** One message for the entire tracked document set; no per-ask message delivery. */
export function batchAskQuestions(documents: Record<string, string>): string | null {
    const lines: string[] = [];
    let number = 0;
    for (const [file, markdown] of Object.entries(documents)) {
        for (const row of rows(file, markdown)) {
            if (row.done && row.evidence.trim()) { continue; }
            const open = (row.questions || []).filter(question => !question.answer?.trim());
            if (!open.length) { continue; }
            lines.push(`### ${row.id} — ${row.text} (${row.file})`);
            for (const question of open) {
                lines.push(`${++number}. ${clean(question.text)}`,
                    `   Options: ${question.options.map(clean).join(' / ')}`,
                    `   Recommendation: ${clean(question.recommendation)}`);
            }
        }
    }
    return number ? `Please answer these open questions in one reply:\n\n${lines.join('\n')}` : null;
}
