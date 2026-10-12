import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
// esbuild bundles the same browser rules; no second participant or routing configuration.
const rules = require('../../media/aitalk/talkRules.js');
const live = new Map<string, { active: boolean; workers: Array<{ id: string; displayName: string; running: boolean }> }>();
export function setAITalkPresence(workspace: string, active: boolean, workers: Array<{ id: string; displayName: string; running: boolean }>): void {
    live.set(workspace, { active, workers: workers.map(worker => ({ ...worker, displayName: `${worker.displayName} · ${worker.id}` })) });
}
export function setAITalkTurnActive(workspace: string, active: boolean): void { const previous = live.get(workspace); live.set(workspace, { active, workers: previous?.workers ?? [] }); }
export function isAITalkTurnActive(workspace: string): boolean { return live.get(workspace)?.active ?? false; }
export class AITalkStore {
    readonly file: string;
    constructor(private workspace: string, private registry = rules.defaultMembers) { this.file = path.join(workspace, '.askaway', 'aitalk', 'messages.jsonl'); }
    snapshot(full = false): { messages: any[]; members: any[] } {
        let members = this.registry.map((member: any) => ({ ...member }));
        const presence = live.get(this.workspace);
        for (const worker of presence?.workers ?? []) members.push({ ...worker, kind: 'worker', rank: 100, presencePolicy: 'joinsPerTurn', presence: worker.running ? 'online' : 'left' });
        let messages: any[] = [];
        let text = '';
        try { text = fs.readFileSync(this.file, 'utf8'); } catch { /* New workspace. */ }
        for (const line of text.split('\n')) {
            try {
                const event = JSON.parse(line);
                if (!event || typeof event !== 'object') continue;
                if (event.deliveryEvent) {
                    messages = messages.map((message: any) => event.ids.includes(message.id)
                        ? { ...rules.deliveryEvent(message, event.deliveryEvent), receivedBy: [...new Set([...(message.receivedBy || []), event.recipient])] } : message);
                    continue;
                }
                const next = event.emoji ? rules.reactMessage(messages.find((message: any) => message.id === event.replyTo), event.emoji, event.author, messages, members, event.id)
                    : rules.postMessage(event, messages, members);
                members = next.registry; messages = next.messages;
            } catch { /* Torn or invalid event does not hide subsequent messages. */ }
        }
        members = members.map((member: any) => ({ ...member, presence: member.presencePolicy === 'alwaysPresent' ? 'online'
            : member.kind === 'agent' ? presence?.active ? 'online' : 'left'
            : member.kind === 'worker' ? presence?.workers.find(worker => worker.id === member.id)?.running ? 'online' : 'left' : member.presence }));
        return { messages: full ? messages : messages.slice(-500), members };
    }
    post(text: string, replyTo?: string, author?: string, details?: string, kind?: string, attachments?: Array<{ name: string; path: string }>) {
        const state = this.snapshot(true);
        const user = state.members.find((member: any) => member.kind === 'user');
        const actor = author || user.id;
        if (!state.members.some((member: any) => member.id === actor)) throw new Error('Unknown participant');
        this.markRead(actor);
        const message = rules.replyMessage(String(text).slice(0, 8000), actor, rules.selectReply(state.messages, replyTo), randomUUID());
        rules.postMessage(message, state.messages, state.members);
        this.append({ ...message, ...(attachments?.length ? { attachments } : {}), ...(kind ? { kind } : {}), ...(details ? { details: String(details).slice(0, 8000) } : {}), time: new Date().toTimeString().slice(0, 5), ts: Date.now() });
        return this.snapshot();
    }
    reply(text: string, replyTo: string) { return this.post(text, replyTo); }
    agentId(): string | undefined { return this.snapshot().members.find((member: any) => member.kind === 'agent')?.id; }
    markRead(recipient: string): void {
        const ids = this.snapshot(true).messages.filter((message: any) => message.receivedBy?.includes(recipient) && message.delivery === 'delivered').map((message: any) => message.id);
        if (ids.length) this.append({ deliveryEvent: 'read', recipient, ids });
    }
    takeForTool(recipient: string): any[] {
        const state = this.snapshot(true);
        if (!rules.participant(state.members, recipient)) return [];
        const received = state.messages.filter((message: any) => message.recipients?.includes(recipient) && !message.receivedBy?.includes(recipient))
            .sort((a: any, b: any) => (rules.participant(state.members, b.author)?.rank ?? 0) - (rules.participant(state.members, a.author)?.rank ?? 0));
        if (received.length) this.append({ deliveryEvent: 'delivered', recipient, ids: received.map((message: any) => message.id) });
        return received.map((message: any) => ({ id: message.id, author: message.author, text: message.text, ...(message.attachments ? { attachments: message.attachments } : {}), ...(message.details ? { details: message.details } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) }));
    }
    react(replyTo: string, emoji: string) {
        const state = this.snapshot();
        if (!['👍', '👎', '❤️', '😂', '🙏', '🎉', '👀', '✅', '🤔'].includes(emoji)) throw new Error('Unknown reaction');
        if (!state.messages.some((message: any) => message.id === replyTo)) throw new Error('Unknown message');
        this.append({ id: randomUUID(), author: state.members.find((member: any) => member.kind === 'user').id, replyTo, emoji, ts: Date.now() });
        return this.snapshot();
    }
    private append(event: object) {
        let size = 0;
        try { size = fs.statSync(this.file).size; } catch { /* New workspace. */ }
        if (size > 10 * 1024 * 1024) throw new Error('AITalk storage limit reached');
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.appendFileSync(this.file, JSON.stringify(event) + '\n');
    }
}
