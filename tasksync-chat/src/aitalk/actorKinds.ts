import type { Actor, ActorIdentity, TalkMessage, Tracker } from './actors';

/** Every participant is an Actor; these are the four concrete kinds. The chat widget only ever sees the Actor interface. */
abstract class RoomActor implements Actor {
    declare id: string;
    declare displayName: string;
    declare kind: string;
    declare rank: number;
    declare colour?: string;
    declare memberId?: string;
    declare name?: string;
    declare role?: string;
    declare leaveWhenAnswered?: boolean;
    constructor(identity: ActorIdentity) { Object.assign(this, identity); }
}

/** Takes its messages on its next tool call (the room queues them); nothing is pushed. */
abstract class PullActor extends RoomActor {}

/** The main agent: registers when its turn starts, leaves when it ends. */
export class MainAgentActor extends PullActor {}

/** A worker: joins when it first posts and leaves once every message it posted is answered. */
export class WorkerActor extends PullActor {
    constructor(identity: ActorIdentity) { super(identity); this.leaveWhenAnswered = true; }
}

/** The reviewer: the widget is the delivery surface, so a message addressed to the user is delivered as soon as it is in the room. */
export class UserActor extends RoomActor {
    receive(_message: TalkMessage, tracker: Tracker): void { tracker.delivered(); }
}

/** The Validator (Priya) answers at once: it takes what is routed to it, one at a time, shows typing while it works and drives the ticks. */
export class ValidatorActor extends RoomActor {
    #pending: Promise<unknown> = Promise.resolve();
    readonly #answer: (text: string, id: string) => Promise<unknown>;
    readonly #typing: (on: boolean) => void;
    constructor(identity: ActorIdentity, answer: (text: string, id: string) => Promise<unknown>, typing: (on: boolean) => void) {
        super(identity);
        this.#answer = answer;
        this.#typing = typing;
    }
    receive(message: TalkMessage, tracker: Tracker): Promise<unknown> { return this.#take(message, tracker); }
    receiveReply(_original: TalkMessage, reply: TalkMessage, tracker: Tracker): Promise<unknown> { return this.#take(reply, tracker); }
    /** Resolves when everything routed so far has been answered. */
    flush(): Promise<unknown> { return this.#pending; }
    #take(message: TalkMessage, tracker: Tracker): Promise<unknown> {
        const run = this.#pending.then(async () => {
            tracker.delivered();
            this.#typing(true);
            try { return await this.#answer(message.text, message.id); }
            finally { this.#typing(false); tracker.read(); }
        });
        this.#pending = run.catch(error => { console.warn('[AskAway] AITalk Validator failed:', error); });
        return run;
    }
}
