export const defaultMembers = [
    { id: 'you', kind: 'user', displayName: 'You', colour: 'who-you', rank: 400, presencePolicy: 'alwaysPresent', canProxyWhenAway: false },
    { id: 'agent', kind: 'agent', displayName: 'Agent', colour: 'who-agent', rank: 200, presencePolicy: 'joinsPerTurn', canProxyWhenAway: false },
    { id: 'validator', kind: 'validator', displayName: 'Validator', colour: 'who-validator', rank: 300, presencePolicy: 'alwaysPresent', canProxyWhenAway: true },
].map(member => ({ ...member, name: member.displayName, presence: 'online' }));

export function resolveRosterMember(idOrName, members = defaultMembers) {
    if (!idOrName) return undefined;
    const raw = typeof idOrName === 'string' ? idOrName : (idOrName.memberId || idOrName.id || idOrName.displayName || idOrName.name || '');
    const key = String(raw).trim().toLowerCase();
    if (!key) return undefined;
    return members.find(m => [m.id, m.memberId, m.name, m.displayName, m.nativeAgent].some(v => v && v.toLowerCase() === key));
}

export function memberIdOf(member) {
    if (!member) return '';
    if (typeof member === 'string') return member;
    if (member.memberId) return member.memberId;
    return member.id || '';
}

export const deliveryEvents = { sent: 'posted', delivered: 'delivered', sessionStart: 'delivered', read: 'read', firstResponse: 'read', firstToolCall: 'read' };
export function participant(registry, id) {
    if (id === undefined || id === null) return undefined;
    const key = String(id).toLowerCase();
    return registry.find(p => [p.id, p.memberId, p.displayName, p.name, memberIdOf(p)].some(value => value?.toLowerCase() === key))
        || registry.find(p => (['you', 'cpo', 'reviewer'].includes(key) && p.kind === 'user') || (key === 'validator' && p.kind === 'validator') || (['agent', 'build', 'askaway build', 'aa.orchestrator'].includes(key) && p.kind === 'agent'));
}
export const displayName = p => p.name || p.displayName || p.id;
export const owner = registry => [...registry].sort((a, b) => b.rank - a.rank)[0];
export const primaryReply = (messages, registry) => [...messages].sort((a, b) => (participant(registry, b.author)?.rank || 0) - (participant(registry, a.author)?.rank || 0))[0];

export function mentionCandidates(members = defaultMembers, draft = '') {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(String(draft || ''));
    const query = match ? match[1].toLowerCase() : '';
    const modId = owner(members)?.id;
    return members.filter(m => m && m.presence !== 'left' && m.kind !== 'user' && m.id !== modId).filter(m => {
        if (!query) return true;
        const roster = resolveRosterMember(m, members);
        const role = m.role || roster?.role || m.kind || '';
        return [displayName(m), m.name, m.id, m.memberId, memberIdOf(m), role].some(v => v && String(v).toLowerCase().includes(query));
    });
}

export function routeMessage(message, messages, registry) {
    const explicitId = message.mentionMemberId || message.toActorId;
    const explicit = explicitId ? participant(registry, explicitId) : undefined;
    const targets = explicit ? [explicit.id] : registry.filter(p => {
        const roster = resolveRosterMember(p, registry);
        const names = [p.id, p.memberId, p.name, displayName(p), roster?.name, roster?.id].filter(Boolean).map(name => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return names.some(name => new RegExp(`@${name}(?![\\w-])`, 'i').test(message.text));
    }).map(p => p.id);
    const parent = messages.find(m => m.id === message.replyTo);
    const replyAuthor = parent?.author || message.quote?.author;
    const recipient = participant(registry, replyAuthor);
    if (recipient) targets.push(recipient.id);
    const author = participant(registry, message.author);
    const routed = [...new Set(targets)].filter(id => id !== author?.id);
    // A user's direct message (no @tag, not a reply) goes to the Validator.
    const validator = registry.find(p => p.kind === 'validator');
    if (!routed.length && !message.replyTo && author && author.kind === 'user' && validator) routed.push(validator.id);
    return routed;
}
export function presenceChange(registry, id, present) {
    const member = participant(registry, id);
    if (!member || member.presencePolicy === 'alwaysPresent' || (member.presence !== 'left') === present) return { registry, notices: [] };
    return { registry: registry.map(p => p === member ? { ...p, presence: present ? 'online' : 'left' } : p),
        notices: [{ kind: 'system', memberId: memberIdOf(member), author: member.id, text: `${displayName(member)} ${present ? 'joined' : 'left'}` }] };
}
export function postMessage(message, messages, registry) {
    if (!String(message.text || '').trim()) throw new Error('Crisp text is mandatory');
    if (message.questions || message.answers) throw new Error('Each answer must be its own message');
    // Registration is the actor's job: routing never makes a recipient join.
    const recipients = routeMessage(message, messages, registry);
    return { registry, messages: [...messages, { ...message, recipients, ...(message.mentionMemberId || message.toActorId ? { toActorId: message.mentionMemberId || message.toActorId } : {}), delivery: 'posted' }] };
}
export function reactMessage(message, emoji, reactor, messages, registry, id) {
    const route = reactionRoute(message, emoji, reactor, messages, registry);
    const posted = postMessage({ id, author: reactor, text: emoji, replyTo: message.id, quote: selectReply(messages, message.id),
        feedback: route.feedback }, messages, registry);
    posted.messages[posted.messages.length - 1].recipients = route.recipient ? [route.recipient] : [];
    return posted;
}
export function deliveryEvent(message, event, map = deliveryEvents) {
    const state = map[event];
    const rank = { posted: 0, delivered: 1, read: 2 };
    return state && (rank[state] ?? 0) >= (rank[message.delivery] ?? 0) ? { ...message, delivery: state } : message;
}
export function nextToolCall(messages, recipient, map = deliveryEvents) {
    return { received: messages.filter(m => m.recipients?.includes(recipient) && !m.receivedBy?.includes(recipient)),
        messages: messages.map(m => m.recipients?.includes(recipient)
            ? { ...deliveryEvent(m, 'firstToolCall', map), receivedBy: [...new Set([...(m.receivedBy || []), recipient])] } : m) };
}
export function reactionRoute(message, emoji, reactor, messages, registry) {
    const author = participant(registry, message.author);
    const by = participant(registry, reactor);
    const question = messages.find(m => m.id === message.replyTo);
    const asker = participant(registry, question?.author);
    if ((emoji === '👍' || emoji === '👎') && asker?.id === by?.id) return { recipient: author?.id, feedback: true };
    if (emoji === '👍' && message.confirmation) return { recipient: author?.id, feedback: false };
    if (emoji === '👍' && asker && by?.rank > author?.rank) return { recipient: asker.id, feedback: false };
    return { recipient: author?.id, feedback: true };
}
export const selectReply = (messages, id) => {
    const message = messages.find(m => m.id === id);
    return message && { id: message.id, author: message.author, text: message.text };
};
export const replyMessage = (text, author, reply, id) => ({ id, author, text, ...(reply ? { replyTo: reply.id, quote: reply } : {}) });
