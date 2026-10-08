import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { ValidatorObserver } from './observer';
import { redactOrDrop } from './redact';

export class ValidatorTriggers {
    private readonly dir: string;
    constructor(root: string, private readonly observer: () => Promise<ValidatorObserver>,
        private readonly spec: () => string, private readonly failed: () => void) {
        this.dir = path.join(root, '.askaway', 'validator-triggers');
    }
    private claim(kind: string, id: string): boolean {
        fs.mkdirSync(this.dir, { recursive: true });
        const file = path.join(this.dir, createHash('sha256').update(kind + ':' + id).digest('hex'));
        try { fs.writeFileSync(file, '', { flag: 'wx' }); return true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    }
    previousFinal(): string {
        try { return fs.readFileSync(path.join(this.dir, 'previous-final'), 'utf8'); } catch { return ''; }
    }
    async turnEnd(fullResponseMarkdown: string, messageId: string): Promise<void> {
        try {
            if (redactOrDrop(fullResponseMarkdown) === null || !this.claim('end', messageId)) return;
            fs.writeFileSync(path.join(this.dir, 'previous-final'), fullResponseMarkdown);
            await (await this.observer()).observe({ id: messageId, source: 'agent', text: fullResponseMarkdown, specSlug: this.spec(), force: true });
        } catch { this.failed(); }
    }
    async turnStart(previousFinal: string, userResponse: string, turnId: string): Promise<void> {
        try {
            if (!previousFinal || redactOrDrop(previousFinal + userResponse) === null || !this.claim('start', turnId)) return;
            await (await this.observer()).observe({ id: turnId, source: 'agent',
                text: 'Previous whole final message:\n' + previousFinal + '\nUser response:\n' + userResponse,
                specSlug: this.spec(), force: true });
        } catch { this.failed(); }
    }
    async memoryCall(query: string, agentId: string): Promise<string | null> {
        try {
            if (redactOrDrop(query + agentId) === null) return null;
            const result = await (await this.observer()).observe({ id: createHash('sha256').update(agentId + query).digest('hex'),
                source: 'memory:' + agentId, text: query, specSlug: this.spec(), force: true });
            return result.answer;
        } catch { this.failed(); return null; }
    }
    async validatorCall(text: string) {
        try {
            return await (await this.observer()).observe({ id: createHash('sha256').update(text).digest('hex'),
                source: 'agent', text, specSlug: this.spec(), force: true });
        } catch { this.failed(); }
    }
}
