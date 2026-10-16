import { roomFor } from './actors';
const rules = require('../../media/aitalk/talkRules.js');
const validatorMember = () => rules.defaultMembers.find((member: any) => member.kind === 'validator');

/** The Validator actor: registers at activation, stays, and answers what is routed to it by calling the Validator model. */
export function registerAITalkValidator(root: string, invoke: (text: string, id: string) => Promise<unknown>) {
    const room = roomFor(root);
    const self = validatorMember();
    let pending: Promise<unknown> = Promise.resolve();
    const answer = (message: { id: string; text: string }, tracker: { delivered(): void; read(): void }) => {
        const run = pending.then(async () => {
            tracker.delivered();
            room.typing(self.id, true);
            try { return await invoke(message.text, message.id); }
            finally { room.typing(self.id, false); tracker.read(); }
        });
        pending = run.catch(error => { console.warn('[AskAway] AITalk Validator failed:', error); });
        return run;
    };
    room.register({ id: self.id, displayName: self.displayName, kind: self.kind, rank: self.rank, colour: self.colour,
        receive: answer, receiveReply: (_original, reply, tracker) => answer(reply, tracker) });
    return { dispose: () => room.unregister(self.id, false), flush: () => pending };
}

/** askaway_validator: the Agent's question is posted in AITalk as an Agent message @Validator; the answer replies to it. */
export function askValidator(root: string, question: string): Promise<unknown> {
    const room = roomFor(root);
    room.registerAgent();
    const agent = rules.defaultMembers.find((member: any) => member.kind === 'agent');
    const posted = room.post(agent.id, `@${validatorMember().displayName} ${question}`);
    return posted.deliveries[0] ?? Promise.resolve(undefined);
}
