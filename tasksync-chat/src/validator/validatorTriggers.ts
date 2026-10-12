import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { ValidatorObserver } from './observer';
import { redactOrDrop } from './redact';

export type ValidatorConversationReader = () => Array<{ ts: number; author?: string; text: string; details?: string }>;

export class ValidatorTriggers {
    private readonly dir: string;
    private turnId = '';
    private turnStartedAt = 0;
    constructor(root: string, private readonly observer: () => Promise<ValidatorObserver>,
        private readonly spec: () => string, private readonly failed: () => void,
        private readonly readConversation: ValidatorConversationReader = () => []) {
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
            const context = this.turnId ? this.storedMessages() : '';
            const conversation = this.readConversation()
                .filter(message => message.ts >= this.turnStartedAt && message.author && redactOrDrop(message.text) !== null)
                .map(message => `${message.author}: ${message.text}${message.details ? '\n' + message.details : ''}`).join('\n');
            await (await this.observer()).observe({ id: messageId, source: 'agent', text: [context, conversation].filter(Boolean).join('\n') + '\nFinal response:\n' + fullResponseMarkdown, specSlug: this.spec(), force: true, turnId: this.turnId || undefined, batch: true });
        } catch { this.failed(); }
    }
    async turnStart(previousFinal: string, userResponse: string, turnId: string): Promise<void> {
        try {
            this.turnId = turnId;
            if (redactOrDrop(previousFinal + userResponse) === null || !this.claim('start', turnId)) return;
            this.turnStartedAt = Date.now();
            this.storeMessage('Previous whole final message:\n' + previousFinal + '\nUser response:\n' + userResponse);
        } catch { this.failed(); }
    }
    storeMessage(text: string): void {
        if (!this.turnId || redactOrDrop(text) === null) return;
        fs.mkdirSync(this.dir, { recursive: true });
        fs.appendFileSync(this.messageFile(), JSON.stringify(text) + '\n');
    }
    private messageFile(): string {
        return path.join(this.dir, 'messages-' + createHash('sha256').update(this.turnId).digest('hex'));
    }
    private storedMessages(): string {
        try { return fs.readFileSync(this.messageFile(), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).join('\n'); }
        catch { return ''; }
    }
    async memoryCall(query: string, agentId: string): Promise<string | null> {
        try {
            if (redactOrDrop(query + agentId) === null) return null;
            const result = await (await this.observer()).observe({ id: createHash('sha256').update(agentId + query).digest('hex'),
                source: 'memory:' + agentId, text: query, specSlug: this.spec(), force: true, turnId: this.turnId || undefined });
            return result.answer;
        } catch { this.failed(); return null; }
    }
    async validatorCall(text: string, messageId?: string) {
        try {
            return await (await this.observer()).observe({ id: messageId ?? createHash('sha256').update(text).digest('hex'),
                source: 'agent', text, specSlug: this.spec(), force: true, turnId: this.turnId || undefined });
        } catch { this.failed(); }
    }
}
