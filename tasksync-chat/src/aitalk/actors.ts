import * as path from 'path';
import { AITalkStore } from './store';
const rules = require('../../media/aitalk/talkRules.js');

/** One AITalk message as actors see it. */
export interface TalkMessage { id: string; author: string; text: string; replyTo?: string; details?: string; recipients?: string[]; attachments?: Array<{ name: string; path: string }> }
/** Returned for every routed message; the receiving actor drives it: sent → delivered → read. */
export interface Tracker { readonly messageId: string; readonly recipient: string; delivered(): void; read(): void }
export interface ActorIdentity { id: string; displayName: string; kind: string; rank: number; colour?: string }
/** A participant. Push actors implement the receive methods; pull actors (Agent, workers) take messages on their next tool call. */
export interface Actor extends ActorIdentity {
    /** Workers leave once every message they posted is answered. */
    leaveWhenAnswered?: boolean;
    receive?(message: TalkMessage, tracker: Tracker): unknown;
    receiveReply?(original: TalkMessage, reply: TalkMessage, tracker: Tracker): unknown;
    receiveReaction?(message: TalkMessage, emoji: string, by: string): unknown;
}
export interface PostOptions { replyTo?: string; details?: string; kind?: string; attachments?: Array<{ name: string; path: string }>; fields?: Record<string, unknown> }
export interface Posted { message: TalkMessage; trackers: Tracker[]; deliveries: Promise<unknown>[] }
export interface ActorHandle {
    post(text: string, options?: PostOptions): Posted;
    reply(messageId: string, text: string, options?: PostOptions): Posted;
    react(messageId: string, emoji: string): void;
    typing(on: boolean): void;
    unregister(): void;
}

const member = (name: string) => rules.defaultMembers.find((item: any) => item.kind === name);

/** The AITalk room: registry of actors, routing of messages to them, trackers and typing. */
export class Room {
    readonly store: AITalkStore;
    private readonly actors = new Map<string, Actor>();
    private readonly workerNames = new Map<string, string>();
    private readonly reactionWatchers = new Set<(message: TalkMessage, emoji: string, by: string) => void>();
    constructor(readonly workspace: string) { this.store = new AITalkStore(workspace); }

    /** At activation nobody but the user is registered; actors register themselves again. */
    activate(): void {
        for (const item of this.store.snapshot().members) if (item.kind !== 'user' && item.presence === 'joined' && !this.actors.has(item.id)) this.store.setPresence(item, false);
    }
    register(actor: Actor): ActorHandle {
        this.actors.set(actor.id, actor);
        const { leaveWhenAnswered: _leave, receive: _r, receiveReply: _rr, receiveReaction: _rx, ...identity } = actor;
        this.store.setPresence({ presencePolicy: actor.leaveWhenAnswered ? 'leavesWhenAnswered' : 'registered', ...identity }, true);
        return this.handle(actor.id);
    }
    unregister(id: string): void {
        this.actors.delete(id); this.store.setTyping(id, false);
        const known = this.store.snapshot().members.find(item => item.id === id);
        if (known) this.store.setPresence(known, false);
    }
    isRegistered(id: string): boolean { return this.store.snapshot().members.some(item => item.id === id && item.presence === 'joined'); }
    handle(id: string): ActorHandle {
        return {
            post: (text, options) => this.post(id, text, options),
            reply: (messageId, text, options) => this.post(id, text, { ...options, replyTo: messageId }),
            react: (messageId, emoji) => this.react(id, messageId, emoji),
            typing: on => this.typing(id, on),
            unregister: () => this.unregister(id),
        };
    }
    /** Posts as a registered actor and routes the message: @tag → that actor, reply → owner, user direct → Validator. */
    post(author: string, text: string, options: PostOptions = {}): Posted {
        const state = this.store.post(text, options.replyTo, author, options.details, options.kind, options.attachments, options.fields);
        this.store.setTyping(author, false);
        const message = state.messages.at(-1) as TalkMessage;
        const parent = message.replyTo ? state.messages.find(item => item.id === message.replyTo) : undefined;
        // Replying to a message you received is the read receipt.
        if (parent?.recipients?.includes(author)) this.store.track('read', author, [parent.id]);
        const trackers: Tracker[] = [], deliveries: Promise<unknown>[] = [];
        for (const recipient of message.recipients ?? []) {
            const tracker = this.tracker(message.id, recipient);
            trackers.push(tracker);
            const actor = this.actors.get(recipient);
            if (!actor) continue;
            const result = parent?.author === recipient && actor.receiveReply ? actor.receiveReply(parent, message, tracker) : actor.receive?.(message, tracker);
            deliveries.push(Promise.resolve(result));
        }
        this.releaseAnswered();
        return { message, trackers, deliveries };
    }
    userPost(text: string, replyTo?: string, attachments?: PostOptions['attachments']): Posted {
        return this.post(member('user').id, text, { replyTo, attachments });
    }
    react(by: string, messageId: string, emoji: string): void {
        const state = this.store.react(messageId, emoji, by);
        const message = state.messages.find(item => item.id === messageId);
        const owner = message && this.actors.get(message.author);
        if (owner && owner.id !== by) void Promise.resolve(owner.receiveReaction?.(message, emoji, by)).catch(() => undefined);
        if (message) for (const watch of this.reactionWatchers) { try { watch(message, emoji, by); } catch { /* One watcher never blocks the reaction. */ } }
        this.releaseAnswered();
    }
    /** Room-level reaction event, for cards whose meaning is not owned by the posting actor (e.g. Webex draft approval). */
    onReaction(watch: (message: TalkMessage, emoji: string, by: string) => void): () => void {
        this.reactionWatchers.add(watch);
        return () => { this.reactionWatchers.delete(watch); };
    }
    typing(id: string, on: boolean): void { this.store.setTyping(id, on && this.actors.has(id)); }
    typingText(): string {
        const members = this.store.snapshot().members;
        const names = this.store.typingIds().filter(id => members.some(item => item.id === id && item.presence === 'joined')).map(id => members.find(item => item.id === id)?.displayName ?? id);
        return names.length ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
    }
    snapshot() { return { ...this.store.snapshot(), typing: this.typingText() }; }
    tracker(messageId: string, recipient: string): Tracker {
        return { messageId, recipient, delivered: () => this.store.track('delivered', recipient, [messageId]), read: () => this.store.track('read', recipient, [messageId]) };
    }

    /** The main agent registers when its turn starts (or its first tool call of the turn) and leaves at turn end. */
    registerAgent(): void { const agent = member('agent'); if (!this.actors.has(agent.id) || !this.isRegistered(agent.id)) this.register(identity(agent)); }
    unregisterAgent(): void { this.unregister(member('agent').id); }
    /** Workers are only known while they run; they register when they post and leave once all their messages are answered. */
    workerLifecycle(worker: { id: string; displayName: string }, running: boolean): void {
        if (running) this.workerNames.set(worker.id, worker.displayName);
        this.releaseAnswered();
    }
    workerPost(workerId: string, text: string, options: PostOptions = {}): Posted {
        if (!this.isRegistered(workerId)) {
            const name = this.workerNames.get(workerId);
            this.register({ id: workerId, displayName: name ? `${name} · ${workerId}` : workerId, kind: 'worker', rank: 100, leaveWhenAnswered: true });
        }
        return this.post(workerId, text, options);
    }
    private releaseAnswered(): void {
        const leaving = [...this.actors.values()].filter(actor => actor.leaveWhenAnswered);
        if (!leaving.length) return;
        const { messages, members } = this.store.snapshot(true);
        for (const actor of leaving) {
            const since = members.find(item => item.id === actor.id)?.joinedAt ?? 0;
            const own = messages.filter(item => item.author === actor.id && item.kind !== 'system' && (item.ts ?? 0) >= since);
            if (own.every(item => messages.some(other => other.replyTo === item.id && other.author !== actor.id))) this.unregister(actor.id);
        }
    }
}
const identity = (item: any): Actor => ({ id: item.id, displayName: item.displayName, kind: item.kind, rank: item.rank, colour: item.colour });

const rooms = new Map<string, Room>();
/** One room per workspace, keyed by its resolved path so every caller meets the same actors. */
export function roomFor(workspace: string): Room {
    const key = path.resolve(workspace);
    let room = rooms.get(key);
    if (!room) { room = new Room(key); rooms.set(key, room); }
    return room;
}
