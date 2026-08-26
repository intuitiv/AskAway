import * as fs from 'fs';
import * as path from 'path';

/** Derived from which artifacts exist and how many tasks are ticked — Spec Kit stores no status field. */
export type SpecStage =
    | 'needs-clarify'
    | 'specified'
    | 'planned'
    | 'tasks-ready'
    | 'in-progress'
    | 'done';

export interface SpecPhase {
    name: string;
    total: number;
    done: number;
}

export interface SpecSummary {
    id: string;
    slug: string;
    dir: string;
    title: string;
    stage: SpecStage;
    total: number;
    done: number;
    percent: number;
    nextTaskId: string;
    nextTaskText: string;
    clarifications: number;
    phases: SpecPhase[];
    active: boolean;
    hasPlan: boolean;
    hasTasks: boolean;
    lastActivity: number;
    sessions: number;
}

export interface SpecScanResult {
    enabled: boolean;
    specsRoot: string;
    activeSlug: string;
    specs: SpecSummary[];
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TASK_LINE = /^\s*[-*]\s*\[([ xX])\]\s*(T\d+[a-zA-Z]*)?\s*(.*)$/;
const PHASE_HEADING = /^##\s+(.+?)\s*$/;

function readTextFile(file: string): string {
    try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { return ''; }
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

function newestMtime(dir: string): number {
    let newest = 0;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile()) { continue; }
            try {
                const m = fs.statSync(path.join(dir, entry.name)).mtimeMs;
                if (m > newest) { newest = m; }
            } catch { /* unreadable entry — skip */ }
        }
    } catch { /* unreadable dir — skip */ }
    return newest;
}

function extractTitle(specText: string, slug: string): string {
    for (const line of specText.split(/\r?\n/)) {
        const m = /^#\s+(.+?)\s*$/.exec(line);
        if (m) { return m[1].replace(/^Feature Specification:\s*/i, '').trim(); }
    }
    return slug.replace(/^\d+[-_]?/, '').replace(/[-_]/g, ' ').trim() || slug;
}

function countClarifications(...texts: string[]): number {
    let n = 0;
    for (const text of texts) {
        n += (text.match(/\[NEEDS CLARIFICATION/g) || []).length;
    }
    return n;
}

function stripTaskTags(text: string): string {
    return text.replace(/\[(P|US\d+|[A-Z]{1,4}\d*)\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

interface TaskParse {
    total: number;
    done: number;
    phases: SpecPhase[];
    nextId: string;
    nextText: string;
}

function parseTasks(text: string): TaskParse {
    const phases: SpecPhase[] = [];
    let current: SpecPhase | undefined;
    let total = 0;
    let done = 0;
    let nextId = '';
    let nextText = '';

    for (const raw of text.split(/\r?\n/)) {
        const heading = PHASE_HEADING.exec(raw);
        if (heading) {
            current = { name: heading[1].replace(/\s*\(.*\)\s*$/, ''), total: 0, done: 0 };
            phases.push(current);
            continue;
        }
        const task = TASK_LINE.exec(raw);
        if (!task) { continue; }
        const isDone = task[1].toLowerCase() === 'x';
        total++;
        if (current) { current.total++; }
        if (isDone) {
            done++;
            if (current) { current.done++; }
        } else if (!nextId && !nextText) {
            nextId = task[2] || '';
            nextText = stripTaskTags(task[3] || '');
        }
    }

    return { total, done, phases: phases.filter(p => p.total > 0), nextId, nextText };
}

function countLogRows(text: string): number {
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*\|\s*\d+\s*\|/.test(line)) { n++; }
    }
    return n;
}

function deriveStage(o: {
    hasPlan: boolean; hasTasks: boolean; total: number; done: number; clarifications: number;
}): SpecStage {
    if (o.hasTasks && o.total > 0) {
        if (o.done === o.total) { return 'done'; }
        if (o.done > 0) { return 'in-progress'; }
        return 'tasks-ready';
    }
    if (o.clarifications > 0) { return 'needs-clarify'; }
    if (o.hasPlan) { return 'planned'; }
    return 'specified';
}

function readActiveSlug(workspaceRoot: string): string {
    const raw = readTextFile(path.join(workspaceRoot, '.specify', 'feature.json'));
    if (!raw) { return ''; }
    try {
        const parsed = JSON.parse(raw) as { feature_directory?: string };
        const dir = (parsed.feature_directory || '').replace(/\\/g, '/').replace(/\/+$/, '');
        return dir ? dir.split('/').pop() || '' : '';
    } catch {
        return '';
    }
}

/** Scan `<workspaceRoot>/specs/*` for Spec Kit features. Returns `enabled: false` when there is no specs/ dir. */
export function scanSpecs(workspaceRoot: string): SpecScanResult {
    const specsRoot = path.join(workspaceRoot, 'specs');
    const empty: SpecScanResult = { enabled: false, specsRoot, activeSlug: '', specs: [] };
    let entries: fs.Dirent[];
    try {
        if (!fs.statSync(specsRoot).isDirectory()) { return empty; }
        entries = fs.readdirSync(specsRoot, { withFileTypes: true });
    } catch {
        return empty;
    }

    const activeSlug = readActiveSlug(workspaceRoot);
    const specs: SpecSummary[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
        const dir = path.join(specsRoot, entry.name);
        const specText = readTextFile(path.join(dir, 'spec.md'));
        const planText = readTextFile(path.join(dir, 'plan.md'));
        const tasksText = readTextFile(path.join(dir, 'tasks.md'));
        if (!specText && !planText && !tasksText) { continue; }

        const parsed = parseTasks(tasksText);
        const clarifications = countClarifications(specText, planText);
        const hasPlan = planText.length > 0;
        const hasTasks = tasksText.length > 0;

        specs.push({
            id: (/^\d+/.exec(entry.name) || [''])[0],
            slug: entry.name,
            dir,
            title: extractTitle(specText, entry.name),
            stage: deriveStage({ hasPlan, hasTasks, total: parsed.total, done: parsed.done, clarifications }),
            total: parsed.total,
            done: parsed.done,
            percent: parsed.total > 0 ? Math.round((parsed.done / parsed.total) * 100) : 0,
            nextTaskId: parsed.nextId,
            nextTaskText: parsed.nextText,
            clarifications,
            phases: parsed.phases,
            active: entry.name === activeSlug,
            hasPlan,
            hasTasks,
            lastActivity: newestMtime(dir),
            sessions: countLogRows(readTextFile(path.join(dir, 'implementation-log.md')))
        });
    }

    specs.sort((a, b) => {
        if (a.active !== b.active) { return a.active ? -1 : 1; }
        return a.slug.localeCompare(b.slug, undefined, { numeric: true });
    });

    return { enabled: specs.length > 0, specsRoot, activeSlug, specs };
}
