import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
// esbuild bundles the same browser rules; no second participant or routing configuration.
const rules = require('../../media/aitalk/talkRules.js');
export class AITalkStore {
    readonly file: string;
    constructor(workspace: string) { this.file = path.join(workspace, '.askaway', 'aitalk', 'messages.jsonl'); }
    snapshot(): { messages: any[]; members: any[] } {
        let members = rules.defaultMembers.map((member: any) => ({ ...member }));
        let messages: any[] = [];
        let text = '';
        try { text = fs.readFileSync(this.file, 'utf8'); } catch { /* New workspace. */ }
        for (const line of text.split('\n')) {
            try {
                const event = JSON.parse(line);
                if (!event || typeof event !== 'object') continue;
                const next = event.emoji ? rules.reactMessage(messages.find((message: any) => message.id === event.replyTo), event.emoji, event.author, messages, members, event.id)
                    : rules.postMessage(event, messages, members);
                members = next.registry; messages = next.messages.slice(-500);
            } catch { /* Torn or invalid event does not hide subsequent messages. */ }
        }
        return { messages, members };
    }
    post(text: string, replyTo?: string, author?: string) {
        const state = this.snapshot();
        const user = state.members.find((member: any) => member.kind === 'user');
        const actor = author || user.id;
        if (!state.members.some((member: any) => member.id === actor)) throw new Error('Unknown participant');
        const message = rules.replyMessage(String(text).slice(0, 8000), actor, rules.selectReply(state.messages, replyTo), randomUUID());
        rules.postMessage(message, state.messages, state.members);
        this.append({ ...message, time: new Date().toTimeString().slice(0, 5), ts: Date.now() });
        return this.snapshot();
    }
    reply(text: string, replyTo: string) { return this.post(text, replyTo); }
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
