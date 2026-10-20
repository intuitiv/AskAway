import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { rosterIdentity } from './names';
// esbuild bundles the same browser rules; no second participant or routing configuration.
const rules = require('../../media/aitalk/talkRules.js');
let last = 0;
/** Monotonic timestamp shared by messages and registration events, so their order merges exactly. */
const stamp = () => (last = Math.max(Date.now(), last + 0.001));
const lines = (file: string) => { try { return fs.readFileSync(file, 'utf8').split('\n'); } catch { return []; } };
export const REACTIONS = ['👍', '👎', '❤️', '😂', '🙏', '🎉', '👀', '✅', '🤔'];
/** Append-only AITalk logs: messages with tracker (delivered/read) events, and actor registration (joined/left) events. */
export class AITalkStore {
    readonly file: string;
    readonly presenceFile: string;
    readonly typingFile: string;
    constructor(private workspace: string, private registry = rules.defaultMembers) {
        this.file = path.join(workspace, '.askaway', 'aitalk', 'messages.jsonl');
        this.presenceFile = path.join(workspace, '.askaway', 'aitalk', 'presence.jsonl');
        this.typingFile = path.join(workspace, '.askaway', 'aitalk', 'typing.jsonl');
    }
    snapshot(full = false): { messages: any[]; members: any[] } {
        let members = this.registry.map((member: any) => ({ ...member, presence: member.kind === 'user' ? 'joined' : 'left', joinedAt: null, leftAt: null }));
        let messages: any[] = [];
        const parse = (line: string) => { try { const event = JSON.parse(line); return event && typeof event === 'object' ? event : undefined; } catch { return undefined; } };
        const registrations = lines(this.presenceFile).map(parse).filter(Boolean);
        const events: any[] = [];
        for (const event of lines(this.file).map(parse).filter(Boolean)) {
            while (registrations.length && typeof event.ts === 'number' && registrations[0].ts <= event.ts) events.push(registrations.shift());
            events.push(event);
        }
        events.push(...registrations);
        for (const event of events) {
            try {
                if (!event || typeof event !== 'object') continue;
                if (event.presenceEvent) {
                    const previous = members.find((member: any) => member.id === event.member.id);
                    const member = { ...previous, ...event.member, presence: event.presenceEvent,
                        joinedAt: event.presenceEvent === 'joined' ? event.ts : previous?.joinedAt ?? null,
                        leftAt: event.presenceEvent === 'left' ? event.ts : null,
                        reconnecting: event.quiet === true && event.presenceEvent === 'left' };
                    members = [...members.filter((item: any) => item.id !== member.id), member];
                    if (!event.quiet) messages.push({ id: event.id, author: member.id, memberId: member.memberId || member.id, kind: 'system', text: `${member.displayName} ${event.presenceEvent}`, ts: event.ts });
                    continue;
                }
                if (event.updateEvent) {
                    // A card update (e.g. a Webex draft turning Sent) never changes who posted it or its id.
                    messages = messages.map((message: any) => message.id === event.updateEvent ? { ...message, ...event.fields, id: message.id, author: message.author } : message);
                    continue;
                }
                if (event.deliveryEvent) {
                    messages = messages.map((message: any) => event.ids.includes(message.id)
                        ? { ...rules.deliveryEvent(message, event.deliveryEvent), receivedBy: [...new Set([...(message.receivedBy || []), event.recipient])] } : message);
                    continue;
                }
                const next = event.emoji ? rules.reactMessage(messages.find((message: any) => message.id === event.replyTo), event.emoji, event.author, messages, members, event.id)
                    : rules.postMessage(event, messages, members);
                messages = [...messages, ...next.messages.slice(messages.length).filter((message: any) => message.kind !== 'system')];
            } catch { /* Torn or invalid event does not hide subsequent messages. */ }
        }
        // Ticks belong to user messages only; other participants' messages never carry them.
        const user = members.find((member: any) => member.kind === 'user');
        messages = messages.map(message => {
            const { tick: _tick, ...rest } = message;
            return message.author && message.author === user?.id ? { ...rest, tick: message.delivery === 'posted' ? 'sent' : message.delivery } : rest;
        });
        return { messages: full ? messages : messages.slice(-500), members: members.map((member: any) => rosterIdentity(member)).sort((a: any, b: any) => b.rank - a.rank) };
    }
    setPresence(member: any, present: boolean, announce = true): void {
        const previous = this.snapshot().members.find(item => item.id === member.id);
        const presenceEvent = present ? 'joined' : 'left';
        if (previous?.presence === presenceEvent && (!present || previous.joinedAt) && previous.memberId === member.memberId && previous.displayName === member.displayName) return;
        if (!previous && !present) return;
        const quiet = !announce || (present && previous?.reconnecting && previous.memberId === member.memberId);
        this.append({ id: randomUUID(), presenceEvent, member, quiet: Boolean(quiet), ts: stamp() }, this.presenceFile);
    }
    /** Only a registered (joined) participant can post. */
    post(text: string, replyTo?: string, author?: string, details?: string, kind?: string, attachments?: Array<{ name: string; path: string }>, fields?: Record<string, unknown>) {
        const state = this.snapshot(true);
        const user = state.members.find((member: any) => member.kind === 'user');
        const actor = rules.participant(state.members, author || user.id);
        if (!actor) throw new Error('Unknown participant');
        if (actor.presence !== 'joined') throw new Error(`${actor.displayName} is not registered in AITalk`);
        this.markRead(actor.id);
        const message = rules.replyMessage(String(text).slice(0, 8000), actor.id, rules.selectReply(state.messages, replyTo), randomUUID());
        rules.postMessage(message, state.messages, state.members);
        this.append({ ...fields, ...message, ...(attachments?.length ? { attachments } : {}), ...(kind ? { kind } : {}), ...(details ? { details: String(details).slice(0, 8000) } : {}), time: new Date().toTimeString().slice(0, 5), ts: stamp() });
        return this.snapshot(true);
    }
    /** Appends a change to an existing message's card fields; the log stays append-only. */
    update(id: string, fields: Record<string, unknown>): void {
        this.append({ updateEvent: id, fields, ts: stamp() });
    }
    agentId(): string | undefined { return this.snapshot().members.find((member: any) => member.kind === 'agent')?.id; }
    setTyping(id: string, on: boolean): void {
        this.append({ id, until: on ? Date.now() + 90000 : 0 }, this.typingFile);
    }
    typingIds(): string[] {
        const active = new Map<string, number>();
        for (const line of lines(this.typingFile)) {
            try { const event = JSON.parse(line); active.set(event.id, event.until); } catch { /* Torn event. */ }
        }
        return [...active].filter(([, until]) => until > Date.now()).map(([id]) => id);
    }
    /** Tracker event from the receiving participant: delivered (double grey) or read (double blue). */
    track(event: 'delivered' | 'read', recipient: string, ids: string[]): void {
        if (ids.length) this.append({ deliveryEvent: event, recipient, ids });
    }
    markRead(recipient: string): void {
        this.track('read', recipient, this.snapshot(true).messages.filter((message: any) => message.receivedBy?.includes(recipient) && message.delivery === 'delivered').map((message: any) => message.id));
    }
    takeForTool(recipient: string): any[] {
        const state = this.snapshot(true);
        if (!rules.participant(state.members, recipient)) return [];
        const received = state.messages.filter((message: any) => message.recipients?.includes(recipient) && !message.receivedBy?.includes(recipient))
            .sort((a: any, b: any) => (rules.participant(state.members, b.author)?.rank ?? 0) - (rules.participant(state.members, a.author)?.rank ?? 0));
        this.track('delivered', recipient, received.map((message: any) => message.id));
        return received.map((message: any) => ({ id: message.id, author: message.author, text: message.text, ...(message.attachments ? { attachments: message.attachments } : {}), ...(message.details ? { details: message.details } : {}), ...(message.replyTo ? { replyTo: message.replyTo } : {}) }));
    }
    react(replyTo: string, emoji: string, author?: string) {
        const state = this.snapshot(true);
        if (!REACTIONS.includes(emoji)) throw new Error('Unknown reaction');
        if (!state.messages.some((message: any) => message.id === replyTo)) throw new Error('Unknown message');
        const by = rules.participant(state.members, author || state.members.find((member: any) => member.kind === 'user').id);
        if (by?.presence !== 'joined') throw new Error('Participant is not registered in AITalk');
        this.append({ id: randomUUID(), author: by.id, replyTo, emoji, ts: stamp() });
        return this.snapshot(true);
    }
    /** Clears the conversation. Who is in the room stays; their old join/leave lines go with the messages. */
    clear(): void {
        const present = new Map<string, any>();
        for (const line of lines(this.presenceFile)) {
            try {
                const event = JSON.parse(line);
                if (event?.presenceEvent && event.member?.id) present.set(event.member.id, event);
            } catch { /* Torn event. */ }
        }
        const kept = [...present.values()].filter(event => event.presenceEvent === 'joined').map(event => ({ ...event, quiet: true }));
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, '');
        fs.writeFileSync(this.presenceFile, kept.map(event => JSON.stringify(event) + '\n').join(''));
        fs.writeFileSync(this.typingFile, '');
    }
    private append(event: object, file = this.file) {
        let size = 0;
        try { size = fs.statSync(file).size; } catch { /* New workspace. */ }
        if (size > 10 * 1024 * 1024) throw new Error('AITalk storage limit reached');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(event) + '\n');
    }
}
