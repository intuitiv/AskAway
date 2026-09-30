import * as fs from 'fs';
import * as path from 'path';
import { readRunRecords, SpecFacts, specFacts } from './runRecords';
import { specsStaleness, StaleEntry } from './staleness';
import { impliedStage, nextStep, SpecArtifacts, SpecKitStage, stageButton, stageMismatch, StageMismatch } from './stages';

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

export interface SpecTaskSummary {
    id: string;
    text: string;
    done: boolean;
    phase: string;
    cycleId: string;
    /** Leading `[...]` markers, e.g. `P`, `US1`, `cloud`, `local: needs mesh`. */
    tags: string[];
    story: string;
}

export interface SpecCycleTask {
    id: string;
    text: string;
    done: boolean;
    phase: string;
    specId: string;
    specSlug: string;
}

export interface SpecCycleSummary {
    id: string;
    phase: string;
    title: string;
    description: string;
    verification: string;
    total: number;
    done: number;
    state: 'ready' | 'running' | 'complete';
    nextTaskId: string;
    nextTaskText: string;
    specCount: number;
    tasks: SpecCycleTask[];
}

export interface SpecStory {
    id: string;
    title: string;
    priority: string;
    independentTest: string;
    successCriteria: string[];
    total: number;
    done: number;
}

export interface SpecSummary {
    id: string;
    slug: string;
    dir: string;
    title: string;
    purpose: string;
    stage: SpecStage;
    total: number;
    done: number;
    percent: number;
    nextTaskId: string;
    nextTaskText: string;
    clarifications: number;
    phases: SpecPhase[];
    tasks: SpecTaskSummary[];
    cycles: SpecCycleSummary[];
    active: boolean;
    hasPlan: boolean;
    hasTasks: boolean;
    lastActivity: number;
    startedAt: number;
    trackedDays: number;
    branch: string;
    implementationRecords: number;
    completedTasksByDay: Array<{ day: string; taskIds: string[] }>;
    pullRequestUrl: string;
    cost?: { requests: number; nanoAiu: number; turns: number; days: number };
    /** Spec Kit stage: stored (newest run record) or implied by artifacts when nothing is stored. */
    specKitStage: SpecKitStage;
    stageSource: 'records' | 'artifacts';
    impliedStage: SpecKitStage;
    mismatch: StageMismatch | null;
    nextStep: string;
    stageButton: string;
    artifacts: SpecArtifacts;
    facts: SpecFacts;
    /** Artifacts older (by git commit order) than an artifact they are generated from. */
    stale: StaleEntry[];
    /** User stories from spec.md with progress from tasks tagged `[USn]` or under their story phase. */
    stories: SpecStory[];
}

export interface SpecScanResult {
    enabled: boolean;
    specsRoot: string;
    activeSlug: string;
    repositoryUrl: string;
    /** False when the workspace is not a git repository; staleness is then unknown, not "fresh". */
    stalenessAvailable: boolean;
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

function readRepositoryUrl(workspaceRoot: string): string {
    try {
        let gitDir = path.join(workspaceRoot, '.git');
        if (fs.statSync(gitDir).isFile()) {
            const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(gitDir, 'utf8'));
            if (!match) { return ''; }
            gitDir = path.resolve(workspaceRoot, match[1].trim());
        }
        let configFile = path.join(gitDir, 'config');
        if (!fs.existsSync(configFile)) {
            const commonDir = readTextFile(path.join(gitDir, 'commondir')).trim();
            if (commonDir) { configFile = path.join(path.resolve(gitDir, commonDir), 'config'); }
        }
        const config = readTextFile(configFile);
        const origin = /\[remote\s+"origin"\][\s\S]*?^\s*url\s*=\s*(.+)$/im.exec(config)?.[1]?.trim() || '';
        const github = /^(?:git@github\.com:|https?:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/i.exec(origin);
        return github ? `https://github.com/${github[1].replace(/\.git$/i, '')}` : '';
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

function oldestMtime(dir: string): number {
    let oldest = Number.POSITIVE_INFINITY;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile()) { continue; }
            try { oldest = Math.min(oldest, fs.statSync(path.join(dir, entry.name)).mtimeMs); } catch { /* skip */ }
        }
    } catch { /* unreadable dir — skip */ }
    return Number.isFinite(oldest) ? oldest : 0;
}

function extractFeatureBranch(tasksText: string): string {
    return /\*\*Branch:\*\*\s*`?([^`·\r\n]+?)`?\s*(?:·|$)/im.exec(tasksText)?.[1]?.trim() ||
        /^\*\*Feature branch:\*\*\s*`?([^`\r\n]+?)`?\s*$/im.exec(tasksText)?.[1]?.trim() || '';
}

function extractTitle(specText: string, slug: string): string {
    for (const line of specText.split(/\r?\n/)) {
        const m = /^#\s+(.+?)\s*$/.exec(line);
        if (m) { return m[1].replace(/^Feature Specification:\s*/i, '').trim(); }
    }
    return slug.replace(/^\d+[-_]?/, '').replace(/[-_]/g, ' ').trim() || slug;
}

function extractPurpose(specText: string): string {
    const explicit = /^\*\*(?:Purpose|Summary)\*\*:\s*(.+(?:\r?\n(?!\s*\r?$|#|\*\*[^*]+\*\*:).+)*)/im.exec(specText);
    return explicit ? explicit[1].replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function countClarifications(...texts: string[]): number {
    let n = 0;
    for (const text of texts) {
        n += (text.match(/\[NEEDS CLARIFICATION/g) || []).length;
    }
    return n;
}

function stripTaskTags(text: string): string {
    return text
        .replace(/\[(P|US\d+|CY-\d+|mesh|cloud|local:[^\]]*|[A-Z]{1,4}\d*)\]/gi, '')
        .replace(/^\s*\*{4}\s*/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function extractPullRequestUrl(...texts: string[]): string {
    for (const text of texts) {
        const match = /https:\/\/github\.com\/[^\s<>)]+\/pull\/\d+/i.exec(text);
        if (match) { return match[0]; }
    }
    return '';
}

function parseCompletedTasksByDay(implementationText: string): Array<{ day: string; taskIds: string[] }> {
    const days = new Map<string, Set<string>>();
    for (const line of implementationText.split(/\r?\n/)) {
        const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
        if (cells.length < 3 || !/^\d+$/.test(cells[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(cells[2])) { continue; }
        const taskId = /\b(T\d+[a-zA-Z]*)\b/.exec(cells[1])?.[1]?.toUpperCase();
        if (!taskId) { continue; }
        const tasks = days.get(cells[2]) || new Set<string>();
        tasks.add(taskId);
        days.set(cells[2], tasks);
    }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, taskIds]) => ({ day, taskIds: [...taskIds] }));
}

function parseTaskTags(text: string): string[] {
    const tags: string[] = [];
    const lead = /^\s*\[([^\]]+)\]/;
    let rest = text;
    for (let m = lead.exec(rest); m; m = lead.exec(rest)) {
        tags.push(m[1].trim());
        rest = rest.slice(m[0].length);
    }
    return tags;
}

interface ParsedTask extends SpecTaskSummary { }

interface TaskParse {
    total: number;
    done: number;
    phases: SpecPhase[];
    nextId: string;
    nextText: string;
    tasks: ParsedTask[];
}

function parseTasks(text: string): TaskParse {
    const phases: SpecPhase[] = [];
    let current: SpecPhase | undefined;
    let total = 0;
    let done = 0;
    let nextId = '';
    let nextText = '';
    const tasks: ParsedTask[] = [];

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
        const rawText = task[3] || '';
        const cycleMatch = /\[CY-(\d+)\]/i.exec(rawText);
        const tags = parseTaskTags(rawText);
        tasks.push({
            id: task[2] || '',
            text: stripTaskTags(rawText),
            done: isDone,
            phase: current?.name || '',
            cycleId: cycleMatch ? `CY-${cycleMatch[1].padStart(3, '0')}` : '',
            tags,
            story: (tags.find(tag => /^US\d+$/i.test(tag)) || '').toUpperCase()
        });
        total++;
        if (current) { current.total++; }
        if (isDone) {
            done++;
            if (current) { current.done++; }
        } else if (!nextId && !nextText) {
            nextId = task[2] || '';
            nextText = stripTaskTags(rawText);
        }
    }

    return { total, done, phases: phases.filter(p => p.total > 0), nextId, nextText, tasks };
}

interface CycleMetadata { title: string; description: string; verification: string; }

function parseCycleMetadata(text: string): Map<string, CycleMetadata> {
    const result = new Map<string, CycleMetadata>();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim().startsWith('|')) { continue; }
        const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
        if (cells.length < 3 || !/^CY-\d+$/i.test(cells[0])) { continue; }
        const id = `CY-${cells[0].slice(3).padStart(3, '0')}`;
        result.set(id, { title: cells[1], description: cells[2], verification: cells[3] || '' });
    }
    return result;
}

function cyclePurpose(taskText: string): string {
    const action = taskText.split(/\s+[—–]\s+/)[0].trim();
    return action.length > 160 ? `${action.slice(0, 157)}...` : action;
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

function parseStories(specText: string, tasks: ParsedTask[]): SpecStory[] {
    const stories: SpecStory[] = [];
    let current: SpecStory | undefined;
    for (const line of specText.split(/\r?\n/)) {
        const head = /^###\s+User Story\s+(\d+)\s*[-–—:]\s*(.+?)\s*(?:\(Priority:\s*(P\d+)\))?\s*$/i.exec(line);
        if (head) {
            current = { id: `US${head[1]}`, title: head[2], priority: head[3] || '', independentTest: '', successCriteria: [], total: 0, done: 0 };
            stories.push(current);
            continue;
        }
        if (/^##\s/.test(line)) { current = undefined; }
        const test = /^\*\*Independent Test\*\*:\s*(.+)$/.exec(line);
        if (test && current && !current.independentTest) { current.independentTest = test[1].trim(); }
        const sc = /^\s*[-*]\s*\*\*(SC-\d+)\*\*:.*Verified by:\s*([^\n]+)$/i.exec(line);
        if (sc) {
            for (const id of sc[2].match(/US\d+/gi) || []) {
                stories.find(story => story.id === id.toUpperCase())?.successCriteria.push(sc[1]);
            }
        }
    }
    for (const story of stories) {
        const phase = new RegExp(`User Story ${story.id.slice(2)}\\b`, 'i');
        const members = tasks.filter(task => task.story === story.id || (!task.story && phase.test(task.phase)));
        story.total = members.length;
        story.done = members.filter(task => task.done).length;
    }
    return stories;
}

function hasMarkdown(dir: string): boolean {
    try {
        return fs.readdirSync(dir).some(name => name.endsWith('.md'));
    } catch {
        return false;
    }
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
    const empty: SpecScanResult = { enabled: false, specsRoot, activeSlug: '', repositoryUrl: '', stalenessAvailable: false, specs: [] };
    let entries: fs.Dirent[];
    try {
        if (!fs.statSync(specsRoot).isDirectory()) { return empty; }
        entries = fs.readdirSync(specsRoot, { withFileTypes: true });
    } catch {
        return empty;
    }

    const activeSlug = readActiveSlug(workspaceRoot);
    const staleness = specsStaleness(specsRoot);
    const specs: SpecSummary[] = [];
    const tasksBySlug = new Map<string, ParsedTask[]>();

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
        const dir = path.join(specsRoot, entry.name);
        const specText = readTextFile(path.join(dir, 'spec.md'));
        const planText = readTextFile(path.join(dir, 'plan.md'));
        const tasksText = readTextFile(path.join(dir, 'tasks.md'));
        const implementationText = readTextFile(path.join(dir, 'implementation-log.md'));
        if (!specText && !planText && !tasksText) { continue; }

        const parsed = parseTasks(tasksText);
        tasksBySlug.set(entry.name, parsed.tasks);
        const clarifications = countClarifications(specText, planText);
        const hasPlan = planText.length > 0;
        const hasTasks = tasksText.length > 0;

        const startedAt = oldestMtime(dir);
        const lastActivity = newestMtime(dir);
        const artifacts: SpecArtifacts = {
            spec: specText.length > 0,
            clarified: /^##\s+Clarifications\b/m.test(specText),
            plan: hasPlan,
            checklists: hasMarkdown(path.join(dir, 'checklists')),
            tasks: hasTasks,
            tasksTotal: parsed.total,
            tasksDone: parsed.done
        };
        const { records, skipped } = readRunRecords(workspaceRoot, entry.name);
        const facts = specFacts(records, skipped);
        const specKitStage = facts.storedStage || impliedStage(artifacts);
        specs.push({
            id: (/^\d+/.exec(entry.name) || [''])[0],
            slug: entry.name,
            dir,
            title: extractTitle(specText, entry.name),
            purpose: extractPurpose(specText),
            stage: deriveStage({ hasPlan, hasTasks, total: parsed.total, done: parsed.done, clarifications }),
            total: parsed.total,
            done: parsed.done,
            percent: parsed.total > 0 ? Math.round((parsed.done / parsed.total) * 100) : 0,
            nextTaskId: parsed.nextId,
            nextTaskText: parsed.nextText,
            clarifications,
            phases: parsed.phases,
            tasks: parsed.tasks,
            cycles: [],
            active: entry.name === activeSlug,
            hasPlan,
            hasTasks,
            lastActivity,
            startedAt,
            trackedDays: startedAt && lastActivity ? Math.max(1, Math.ceil((lastActivity - startedAt) / 86400000)) : 0,
            branch: extractFeatureBranch(tasksText),
            implementationRecords: countLogRows(implementationText),
            completedTasksByDay: parseCompletedTasksByDay(implementationText),
            pullRequestUrl: extractPullRequestUrl(specText, planText, tasksText, implementationText),
            specKitStage,
            stageSource: facts.storedStage ? 'records' : 'artifacts',
            impliedStage: impliedStage(artifacts),
            mismatch: facts.storedStage ? stageMismatch(facts.storedStage, artifacts) : null,
            nextStep: nextStep(specKitStage, artifacts),
            stageButton: stageButton(specKitStage, artifacts),
            artifacts,
            facts,
            stale: staleness.bySlug.get(entry.name) || [],
            stories: parseStories(specText, parsed.tasks)
        });
    }

    const metadata = parseCycleMetadata(readTextFile(path.join(workspaceRoot, '.specify', 'cycles.md')));
    const cycles = new Map<string, SpecCycleTask[]>();
    for (const spec of specs) {
        for (const task of tasksBySlug.get(spec.slug) || []) {
            if (!task.cycleId) { continue; }
            const members = cycles.get(task.cycleId) || [];
            members.push({ id: task.id, text: task.text, done: task.done, phase: task.phase, specId: spec.id, specSlug: spec.slug });
            cycles.set(task.cycleId, members);
        }
    }
    for (const spec of specs) {
        const specCycleIds = new Set((tasksBySlug.get(spec.slug) || []).map(task => task.cycleId).filter(Boolean));
        spec.cycles = [...specCycleIds].map(id => {
            const tasks = cycles.get(id) || [];
            const done = tasks.filter(task => task.done).length;
            const next = tasks.find(task => !task.done);
            const meta = metadata.get(id);
            const state: SpecCycleSummary['state'] = done === tasks.length
                ? 'complete'
                : done > 0 ? 'running' : 'ready';
            return {
                id,
                phase: tasks.find(task => task.specSlug === spec.slug)?.phase || tasks[0]?.phase || 'Other work',
                title: meta?.title && meta.title.toUpperCase() !== id.toUpperCase() ? meta.title : '',
                description: meta?.description || cyclePurpose(next?.text || tasks[0]?.text || ''),
                verification: meta?.verification || '',
                total: tasks.length,
                done,
                state,
                nextTaskId: next?.id || '',
                nextTaskText: next?.text || '',
                specCount: new Set(tasks.map(task => task.specSlug)).size,
                tasks
            };
        }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    }

    specs.sort((a, b) => {
        if (a.active !== b.active) { return a.active ? -1 : 1; }
        return a.slug.localeCompare(b.slug, undefined, { numeric: true });
    });

    return { enabled: specs.length > 0, specsRoot, activeSlug, repositoryUrl: readRepositoryUrl(workspaceRoot), stalenessAvailable: staleness.available, specs };
}
