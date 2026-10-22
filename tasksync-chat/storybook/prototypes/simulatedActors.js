// Simulated AITalk actors for Storybook: the same widget as production, fed by a scripted room
// instead of the extension. Actors register/leave, type, post, react and drive the user's ticks.
import { defaultMembers, owner, postMessage, reactMessage, deliveryEvent, presenceChange } from '../../media/aitalk/talkRules.js';

export function createSimulatedRoom({ messages = [], members = defaultMembers, typing = '', unread = 0, render, schedule = setTimeout }) {
    let state = { messages: [...messages], members, typing, unread };
    let sent = 0;
    const emit = () => render({ ...state, messages: [...state.messages] });
    const tick = (id, event) => { state.messages = state.messages.map(message => message.id === id ? deliveryEvent(message, event) : message); };
    // One scripted actor action: join/leave banner, typing, post, react, or a tracker tick on a user message.
    function act(value) {
        if (value.do === 'typing') state.typing = value.who;
        if (value.do === 'add') { state.typing = ''; state.messages = [...state.messages, value.message]; }
        if (value.do === 'join' || value.do === 'leave') { const changed = presenceChange(state.members, value.who, value.do === 'join'); state.members = changed.registry; state.messages = [...state.messages, ...changed.notices]; }
        if (value.do === 'event' || value.do === 'deliver') tick(value.id, value.event || 'delivered');
        if (value.do === 'react') state.messages = state.messages.map(message => message.id === value.id ? { ...message, reactions: [...(message.reactions || []), { emoji: value.emoji, by: [value.by] }] } : message);
        emit();
    }
    // User intents from the widget; the routed actor's tracker goes sent → delivered → read.
    function intent(action) {
        const me = owner(state.members).id;
        if (action.type === 'aitalkPost' || action.type === 'aitalkReply') {
            const result = postMessage({ id: `sent-${sent++}`, author: me, text: action.text, replyTo: action.replyTo, attachments: action.attachments }, state.messages, state.members);
            state.messages = result.messages;
            const id = result.messages.at(-1).id;
            emit();
            schedule(() => act({ do: 'event', id, event: 'delivered' }), 1600);
            schedule(() => act({ do: 'event', id, event: 'read' }), 2400);
        }
        const pendingDraft = id => state.messages.find(message => message.draftId && message.webexDraft?.state === 'pending' && (message.draftId === id || message.id === id));
        if (action.type === 'aitalkReact' && action.emoji === '👎' && pendingDraft(action.replyTo)) { settleDraft(pendingDraft(action.replyTo), 'rejected'); return; }
        if (action.type === 'aitalkReact') { state.messages = reactMessage(state.messages.find(message => message.id === action.replyTo), action.emoji, me, state.messages, state.members, `reaction-${sent++}`).messages; emit(); }
        // 👍 on a Webex draft is the permission: the simulated tool host sends it once and the card turns Sent.
        if (action.type === 'aitalkApproveDraft' && pendingDraft(action.draftId)) settleDraft(pendingDraft(action.draftId), 'sent');
    }
    function settleDraft(card, outcome) {
        const webexDraft = { ...card.webexDraft, state: outcome };
        state.messages = state.messages.map(message => message === card ? { ...message, draftId: '', webexDraft } : message);
        act({ do: 'add', message: { id: `draft-outcome-${sent++}`, author: owner(state.members).id, replyTo: card.id, text: outcome === 'sent' ? `👍 Approved: sent to ${webexDraft.recipientLabel}.` : `👎 Rejected: nothing was sent to ${webexDraft.recipientLabel}.`, delivery: 'posted' } });
    }
    return { act, intent, snapshot: () => state, start: emit };
}
