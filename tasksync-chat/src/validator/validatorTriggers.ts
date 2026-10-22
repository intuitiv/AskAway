import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { ValidatorObserver } from './observer';
import { redactOrDrop } from './redact';
import { ConversationStacks } from './conversationStack';

/** `validatorSession`: id of the Validator session the next run would reuse, or null for a new or retired one. `sessionContinues` is the older boolean form. */
const PREDICTION_WAIT_MS = 120_000;
const MODEL_PAIRS = 50;

export interface ValidatorTriggerDeps { stacks: ConversationStacks; validatorSession?: () => string | null; sessionContinues?: () => boolean }

export type ValidatorConversationReader = () => Array<{ ts: number; author?: string; text: string; details?: string }>;

export class ValidatorTriggers {
    private readonly dir: string;
    private turnId = '';
    private turnStartedAt = 0;
    /** The prediction run of each stacked agent entry, so a reviewer reply that arrives first can wait for it. */
    private readonly predicting = new Map<string, Promise<unknown>>();
    constructor(root: string, private readonly observer: () => Promise<ValidatorObserver>,
        private readonly spec: () => string, private readonly failed: () => void,
        private readonly readConversation: ValidatorConversationReader = () => [],
        private readonly deps?: ValidatorTriggerDeps) {
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
    /** ADR 0038 respond loop: stack the agent's final, then run turn-end with the stack text; the prediction's responseId is the stack entry id. */
    async onAgentFinal(input: { conversationKey: string; text: string; turnId: string }): Promise<void> {
        try {
            if (!this.deps) return;
            await this.turnEnd(input.text, input.turnId || createHash('sha256').update(input.text).digest('hex'), input);
        } catch { this.failed(); }
    }
    /** ADR 0038 learn loop: once per stacked reviewer message, compares the earlier agent entry's prediction with this reply. */
    async onReviewerReply(input: { conversationKey: string; text: string; turnId: string }): Promise<void> {
        try {
            const stacks = this.deps?.stacks;
            if (!stacks) return;
            const entries = stacks.read(input.conversationKey);
            let at = -1;
            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].role === 'user' && entries[i].turnId === input.turnId && entries[i].id) { at = i; break; }
            }
            if (at < 0) return;
            const user = entries[at];
            const agent = entries.slice(0, at).reverse().find(entry => entry.role === 'agent' && entry.id);
            if (!agent) return;
            const settling = this.predicting.get(agent.id as string);
            if (settling && !await this.settled(settling)) return;
            const observer = await this.observer();
            const specSlug = this.spec();
            if (!observer.predictions(specSlug || null).some(p => p.responseId === agent.id)) return;
            if (!this.claim('learned', user.id as string)) return;
            await observer.closeLoop({ id: agent.id as string, text: agent.text, specSlug: specSlug || undefined }, { id: user.id as string, text: user.text },
                this.prefix(entries, at));
        } catch { this.failed(); }
    }
    /** True when the prediction settled within the wait; false when it did not (the reply is then not learned from). */
    private async settled(prediction: Promise<unknown>): Promise<boolean> {
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([prediction.then(() => true, () => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), PREDICTION_WAIT_MS); })]);
        } finally { if (timer) clearTimeout(timer); }
    }
    /** ADR 0038: "Given U1, A1 ... An, You predicted Vn, And User response is U(n+1)": the stack up to and including the reviewer entry, capped like the model input. */
    private prefix(entries: Array<{ role: string; text: string }>, at: number): string {
        const first = Math.max(0, at + 1 - MODEL_PAIRS * 2);
        let turn = entries.slice(0, first).filter(entry => entry.role === 'user').length;
        return entries.slice(first, at + 1).map(entry => {
            if (entry.role === 'user') turn++;
            return `[${Math.max(turn, 1)}] ${entry.role === 'user' ? 'Reviewer' : 'Agent'}: ${entry.text}`;
        }).join('\n\n');
    }
    async turnEnd(fullResponseMarkdown: string, messageId: string, stack?: { conversationKey: string; turnId: string }): Promise<void> {
        try {
            if (redactOrDrop(fullResponseMarkdown) === null || !this.claim('end', messageId)) return;
            fs.writeFileSync(path.join(this.dir, 'previous-final'), fullResponseMarkdown);
            let observedId = messageId;
            let stackText = '';
            let session: string | null = null;
            if (stack && this.deps) {
                this.deps.stacks.append(stack.conversationKey, { role: 'agent', text: fullResponseMarkdown, turnId: stack.turnId, at: Date.now() });
                observedId = this.deps.stacks.lastEntryId(stack.conversationKey) ?? messageId;
                session = this.deps.validatorSession?.() ?? null;
                const continues = this.deps.validatorSession ? session !== null : this.deps.sessionContinues?.() ?? false;
                stackText = this.deps.stacks.buildInput(stack.conversationKey, { sessionContinues: continues, session: this.deps.validatorSession ? session ?? undefined : undefined });
            }
            const context = this.turnId ? this.storedMessages() : '';
            const conversation = this.readConversation()
                .filter(message => message.ts >= this.turnStartedAt && message.author && redactOrDrop(message.text) !== null)
                .map(message => `${message.author}: ${message.text}${message.details ? '\n' + message.details : ''}`).join('\n');
            const observing = (async () => (await this.observer()).observe({ id: observedId, source: 'agent', text: [stackText && 'Conversation:\n' + stackText, context, conversation].filter(Boolean).join('\n') + '\nFinal response:\n' + fullResponseMarkdown, specSlug: this.spec(), force: true, turnId: this.turnId || undefined, batch: true }))();
            if (stack && this.deps) this.predicting.set(observedId, observing);
            try {
                const response = await observing;
                // Delivered only after the model call succeeded, bound to the session that run used: a failed run is resent next time.
                if (stack && this.deps && !response.error && !response.skipped) this.deps.stacks.markDelivered(stack.conversationKey, observedId, response.sessionId ?? session ?? undefined);
            } finally { if (stack && this.deps) this.predicting.delete(observedId); }
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
