import * as path from 'path';
import { AITalkStore } from './store';
import { rosterIdentity } from './names';
import { MainAgentActor, UserActor, WorkerActor } from './actorKinds';
export { MainAgentActor, UserActor, ValidatorActor, WorkerActor } from './actorKinds';
import { resolveMainAgentIdentity, type MainAgentIdentity } from '../team/roster';
export { resolveMainAgentIdentity } from '../team/roster';
const rules = require('../../media/aitalk/talkRules.js');

/** One AITalk message as actors see it. */
export interface TalkMessage { id: string; author: string; text: string; replyTo?: string; details?: string; recipients?: string[]; attachments?: Array<{ name: string; path: string }> }
/** Returned for every routed message; the receiving actor drives it: sent → delivered → read. */
export interface Tracker { readonly messageId: string; readonly recipient: string; delivered(): void; read(): void }
export interface ActorIdentity { id: string; displayName: string; kind: string; rank: number; colour?: string; memberId?: string; name?: string; role?: string }
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

export function mainAgentActor(selectedAgent = 'AskAway Build'): Actor {
    const base = member('agent');
    const persona = resolveMainAgentIdentity(selectedAgent);
    return new MainAgentActor({
        ...identity(base),
        id: persona.id,
        memberId: persona.id,
        displayName: persona.name,
        name: persona.name,
        role: persona.role,
    });
}

/** The AITalk room: registry of actors, routing of messages to them, trackers and typing. */
export class Room {
    readonly store: AITalkStore;
    selectedAgent?: string;
    private readonly actors = new Map<string, Actor>();
    private readonly workerNames = new Map<string, string>();
    private readonly reactionWatchers = new Set<(message: TalkMessage, emoji: string, by: string) => void>();
    private readonly replyWaiters = new Map<string, Set<(reply: TalkMessage) => void>>();
    constructor(readonly workspace: string, selectedAgent?: string) {
        this.store = new AITalkStore(workspace);
        this.selectedAgent = selectedAgent;
        // The reviewer is always in the room; unlike the others the user never registers or leaves.
        const user = member('user');
        this.actors.set(user.id, new UserActor(identity(user)));
    }

    setSelectedAgent(selectedAgent: string): MainAgentIdentity {
        this.selectedAgent = selectedAgent;
        return resolveMainAgentIdentity(selectedAgent);
    }

    mainAgentIdentity(selectedAgent = this.selectedAgent || 'AskAway Build'): MainAgentIdentity {
        return resolveMainAgentIdentity(selectedAgent);
    }

    /** At activation nobody but the user is registered; actors register themselves again. */
    activate(): void {
        for (const item of this.store.snapshot().members) if (item.kind !== 'user' && item.presence === 'joined' && !this.actors.has(item.id)) this.store.setPresence(item, false, false);
    }
    register(actor: Actor): ActorHandle {
        const resolved = rosterIdentity(actor, this.selectedAgent);
        // Class actors keep their own instance (and private state); plain-object actors get the resolved copy.
        if (Object.getPrototypeOf(actor) === Object.prototype) actor = resolved; else Object.assign(actor, resolved);
        this.actors.set(actor.id, actor);
        const { leaveWhenAnswered: _leave, receive: _r, receiveReply: _rr, receiveReaction: _rx, ...identity } = actor;
        this.store.setPresence({ presencePolicy: actor.leaveWhenAnswered ? 'leavesWhenAnswered' : 'registered', ...identity }, true);
        return this.handle(actor.id);
    }
    unregister(id: string, announce = true): void {
        // The turn or run is over: everything delivered to this actor has been read.
        this.store.markRead(id);
        this.actors.delete(id); this.store.setTyping(id, false);
        const known = this.store.snapshot().members.find(item => item.id === id);
        if (known) this.store.setPresence(known, false, announce);
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
        if (parent && parent.author !== author) for (const waiter of [...(this.replyWaiters.get(parent.id) ?? [])]) { try { waiter(message); } catch { /* One waiter never blocks the post. */ } }
        this.releaseAnswered();
        return { message, trackers, deliveries };
    }
    /** Runs `callback` when someone other than its author replies to the message; returns a function that cancels it. */
    onReply(messageId: string, callback: (reply: TalkMessage) => void): () => void {
        const waiters = this.replyWaiters.get(messageId) ?? new Set();
        waiters.add(callback);
        this.replyWaiters.set(messageId, waiters);
        return () => { waiters.delete(callback); if (!waiters.size) this.replyWaiters.delete(messageId); };
    }
    /** Resolves with the first reply to the message within `ms`, or undefined: the asker then carries on and the reply reaches it on its next tool call. */
    awaitReply(messageId: string, ms: number): Promise<TalkMessage | undefined> {
        const messages = this.store.snapshot(true).messages;
        const asked = messages.find((item: any) => item.id === messageId);
        const already = messages.find((item: any) => item.replyTo === messageId && item.author !== asked?.author);
        if (already) return Promise.resolve(already as TalkMessage);
        return new Promise(resolve => {
            const stop = this.onReply(messageId, reply => { clearTimeout(timer); stop(); resolve(reply); });
            const timer = setTimeout(() => { stop(); resolve(undefined); }, ms);
        });
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
    typingText(rosterNames = false): string {
        const members = this.store.snapshot().members;
        const names = this.store.typingIds().filter(id => members.some(item => item.id === id && item.presence === 'joined')).map(id => { const member = members.find(item => item.id === id); return rosterNames ? rules.displayName(member || { id }) : member?.displayName ?? id; });
        return names.length ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
    }
    snapshot() { return { ...this.store.snapshot(), typing: this.typingText(true) }; }
    tracker(messageId: string, recipient: string): Tracker {
        return { messageId, recipient, delivered: () => this.store.track('delivered', recipient, [messageId]), read: () => this.store.track('read', recipient, [messageId]) };
    }

    /** The main agent registers when its turn starts (or its first tool call of the turn) and leaves at turn end. */
    registerAgent(selectedAgent?: string): ActorHandle {
        if (selectedAgent) this.selectedAgent = selectedAgent;
        const agent = member('agent');
        const persona = resolveMainAgentIdentity(this.selectedAgent || 'AskAway Build');
        const actor = new MainAgentActor({
            ...identity(agent),
            memberId: persona.id,
            name: persona.name,
            role: persona.role,
            displayName: this.selectedAgent ? persona.name : agent.displayName,
        });
        if (!this.actors.has(agent.id) || !this.isRegistered(agent.id) || this.actors.get(agent.id)?.memberId !== actor.memberId) return this.register(actor);
        return this.handle(agent.id);
    }
    unregisterAgent(): void { this.unregister(member('agent').id); }
    /** Workers are only known while they run; they register when they post and leave once all their messages are answered. */
    workerLifecycle(worker: { id: string; displayName: string }, running: boolean): void {
        if (running) this.workerNames.set(worker.id, worker.displayName); else this.store.markRead(worker.id);
        this.releaseAnswered();
    }
    workerPost(workerId: string, text: string, options: PostOptions = {}): Posted {
        if (!this.isRegistered(workerId)) {
            const name = this.workerNames.get(workerId);
            this.register(new WorkerActor({ id: workerId, displayName: name ? `${name} · ${workerId}` : workerId, kind: 'worker', rank: 100 }));
        }
        return this.post(workerId, text, options);
    }
    /**
     * Presence rule for guests (R-AITALK-51): a member other than the reviewer, the Validator and the main agent is in the room
     * only while one of its questions or approval cards is open, and leaves as soon as none is. It reads the shared store, not this
     * process's actors, so whichever process settles the last question or card also releases the member.
     */
    releaseAnswered(): void {
        const { messages, members } = this.store.snapshot(true);
        for (const member of members) {
            if (member.presence !== 'joined' || (member.kind !== 'worker' && member.presencePolicy !== 'leavesWhenAnswered')) continue;
            const since = member.joinedAt ?? 0;
            const own = messages.filter(item => item.author === member.id && item.kind !== 'system' && (item.ts ?? 0) >= since);
            // Joined a moment ago, its first message not in the log yet: it is about to ask.
            if (!own.length && Date.now() - since < 5000) continue;
            if (!own.some(item => openItem(item, messages))) this.unregister(member.id);
        }
    }
}
/**
 * A guest's message that still needs an answer. An approval card is open until its draft is settled (sent, failed, rejected or gone);
 * a question is open until someone else replies or reacts to it. A reply to someone else's message is an answer, not a question.
 */
function openItem(message: any, messages: any[]): boolean {
    if (message.webexDraft) return message.webexDraft.state === 'pending' && !!message.draftId;
    if (message.replyTo) return false;
    return !messages.some(other => other.replyTo === message.id && other.author !== message.author);
}
const identity = (item: any): Actor => ({ id: item.id, displayName: item.displayName, kind: item.kind, rank: item.rank, colour: item.colour });

const rooms = new Map<string, Room>();
/** One room per workspace, keyed by its resolved path so every caller meets the same actors. */
export function roomFor(workspace: string, selectedAgent?: string): Room {
    const key = path.resolve(workspace);
    let room = rooms.get(key);
    if (!room) { room = new Room(key, selectedAgent); rooms.set(key, room); }
    else if (selectedAgent) room.setSelectedAgent(selectedAgent);
    return room;
}
