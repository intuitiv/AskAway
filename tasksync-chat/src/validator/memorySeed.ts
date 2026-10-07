import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeScope, KnowledgeStore } from './knowledgeStore';
import { redactRecordOrDrop } from './redact';

export interface MemorySeedOptions {
    marker: string;
    sources: Array<{ directory: string; scope: KnowledgeScope }>;
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
