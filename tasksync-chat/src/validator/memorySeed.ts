import * as fs from 'fs';
import * as path from 'path';
import { canonicalFact, KnowledgeFact, KnowledgeScope, KnowledgeStore } from './knowledgeStore';
import { redactRecordOrDrop } from './redact';

export interface MemorySeedOptions {
    marker: string;
    sources: Array<{ directory: string; scope: KnowledgeScope }>;
}

/** Preserve unstructured files whole, and retain headings/code in structured memories. */
export function memoryFileFacts(file: string): KnowledgeFact[] {
    const contents = fs.readFileSync(file, 'utf8');
    const lines = contents.split(/\r?\n/);
    if (!lines.some(line => /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(line))) {
        return [{ text: contents || '(Empty markdown file)', from: `${file}:1` }];
    }
    const facts: KnowledgeFact[] = [];
    let text: string[] = [], start = 1, fence = '';
    const flush = () => {
        if (text.length) facts.push({ text: text.join('\n'), from: `${file}:${start}` });
        text = [];
    };
    lines.forEach((line, i) => {
        const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
        if (!fence && (/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(line) || !line.trim())) flush();
        if (!line.trim() && !fence) return;
        if (!text.length) start = i + 1;
        text.push(line);
        if (delimiter) fence = fence ? (delimiter[1][0] === fence ? '' : fence) : delimiter[1][0];
    });
    flush();
    return facts.length ? facts : [{ text: contents || '(Empty markdown file)', from: `${file}:1` }];
}

export async function importMemoryFiles(store: KnowledgeStore | undefined,
    files: Array<{ file: string; scope: KnowledgeScope }>) {
    const report = { filesImported: 0, factsPlanned: 0, factsStored: 0, merged: 0,
        refused: [] as Array<{ from: string; reason: string }>,
        items: [] as Array<{ from: string; status: string; id?: string }> };
    const existing = store ? await store.export() : [];
    const replaced = new Set(existing.map(item => item.supersedesId));
    const key = (fact: KnowledgeFact, scope: KnowledgeScope) => JSON.stringify([scope.project, scope.agentId, scope.spec, canonicalFact(fact.text)]);
    const known = new Map(existing.filter(item => !replaced.has(item.id)).map(item => [key(item.fact, item.scope), item.id]));
    for (const { file, scope } of files) {
        for (const fact of memoryFileFacts(file)) {
            report.factsPlanned++;
            const from = fact.from!;
            if (!redactRecordOrDrop({ fact, scope })) {
                report.refused.push({ from, reason: 'Knowledge input rejected by secret gate' });
                report.items.push({ from, status: 'refused' });
                continue;
            }
            const factKey = key(fact, scope);
            if (known.has(factKey)) {
                report.merged++;
                report.items.push({ from, status: 'merged', id: known.get(factKey) });
            } else if (store) {
                try {
                    const item = await store.remember(fact, scope);
                    known.set(factKey, item.id);
                    report.factsStored++;
                    report.items.push({ from, status: 'stored', id: item.id });
                } catch (error) {
                    if (!/secret gate/i.test(String((error as Error)?.message))) throw error;
                    report.refused.push({ from, reason: 'Knowledge input rejected by secret gate' });
                    report.items.push({ from, status: 'refused' });
                }
            } else {
                known.set(factKey, 'planned');
                report.items.push({ from, status: 'planned' });
            }
        }
        report.filesImported++;
    }
    return report;
}

/** Only the migration reads markdown; the marker is outside the source folders. */
export async function seedMemories(store: KnowledgeStore, options: MemorySeedOptions): Promise<void> {
    if (fs.existsSync(options.marker)) return;
    for (const source of options.sources) {
        const visit = async (directory: string) => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    if (!options.sources.some(other => other !== source && path.resolve(other.directory) === path.resolve(file))) await visit(file);
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
                const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
                let text = '', start = 0, fenced = false;
                const flush = async () => {
                    const fact = { text: text.trim(), from: `${file}:${start}` };
                    if (fact.text && redactRecordOrDrop(fact)) await store.remember(fact, source.scope);
                    text = '';
                };
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
                    if (fenced) continue;
                    if (/^\s*#/.test(line) || !line.trim()) { await flush(); continue; }
                    const bullet = line.match(/^\s*(?:[-*+] |\d+[.)] )(.*)/);
                    if (bullet) await flush();
                    if (!text) start = i + 1;
                    text += (text ? ' ' : '') + (bullet ? bullet[1] : line.trim());
                }
                await flush();
            }
        };
        await visit(source.directory);
    }
    fs.mkdirSync(path.dirname(options.marker), { recursive: true });
    fs.writeFileSync(options.marker, 'seeded\n', { flag: 'wx' });
}
