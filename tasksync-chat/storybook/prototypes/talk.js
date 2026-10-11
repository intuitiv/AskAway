export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textHtml = text => escapeHtml(text).replace(/@(agent|validator|build-1)\b/gi, '<mark>@$1</mark>');
const participants = { You: ['Y', 'you'], Agent: ['A', 'agent'], Validator: ['V', 'validator'], 'build-1': ['B1', 'worker'] };
export function ticksHtml(message) {
    if (!message.delivery) return '';
    const delivered = message.delivery === 'delivered';
    return `<span class="talk-ticks ${delivered ? 'delivered' : ''}" aria-label="${delivered ? 'Delivered' : 'Posted'}" title="${escapeHtml(delivered ? `Seen by Agent with its next tool call · ${message.tool}` : 'Posted · waiting for a tool response')}">${delivered ? '✓✓' : '✓'}</span>`;
}
export function messageHtml(message, messages) {
    if (message.kind === 'day') return `<div class="talk-day">${escapeHtml(message.text)}</div>`;
    if (message.kind === 'system') return `<div class="talk-system">${escapeHtml(message.emoji || '•')} <strong>${escapeHtml(message.text)}</strong> ${ticksHtml(message)}</div>`;
    if (message.kind === 'progress') return `<details class="talk-progress"><summary>✅ <strong>${escapeHtml(message.text)}</strong> · ${message.updates.length} updates</summary>${message.updates.map(line => `<div class="talk-system">${textHtml(line)}</div>`).join('')}</details>`;
    if (message.kind === 'heads-up') return `<aside class="talk-headsup"><strong>👋 Quick check</strong><p>${textHtml(message.text)}</p><button data-reply="${escapeHtml(message.id)}">Reply to Agent</button> <button class="talk-chip" data-tab="Trace">trace ↗</button></aside>`;
    const [initials, color] = participants[message.author] || ['?', 'agent'];
    const parent = messages.find(m => m.id === message.replyTo);
    const reply = parent ? `<a class="talk-quote" href="#talk-${escapeHtml(parent.id)}"><strong>↩ ${escapeHtml(parent.author)}</strong><span>${textHtml(parent.text)}</span></a>` : '';
    const questions = (message.questions || []).map((q, i) => `<section class="talk-question"><strong>${i + 1}. ${escapeHtml(q.question)}</strong><p>${escapeHtml(q.answer)}</p><div class="talk-actions"><button data-vote="up" aria-label="Approve question ${i + 1}" aria-pressed="${q.vote === 'up'}">👍</button><button data-vote="down" aria-label="Reject question ${i + 1}" aria-pressed="${q.vote === 'down'}">👎</button><button data-reply="${escapeHtml(message.id)}" data-question="${i + 1}">reply</button></div>${q.correction ? `<label class="talk-correction">Your correction<textarea aria-label="Correction for question ${i + 1}">${escapeHtml(q.correction)}</textarea></label>` : ''}</section>`).join('');
    const recipient = parent?.author === 'Agent' || /@agent\b/i.test(message.text || '');
    return `<article id="talk-${escapeHtml(message.id)}" class="talk-message ${color}">${message.author === 'You' ? '' : `<span class="talk-avatar ${color}" aria-hidden="true">${initials}</span>`}<div class="talk-bubble"><strong class="talk-author">${escapeHtml(message.author)}</strong>${reply}<p>${textHtml(message.text || '')}</p>${questions}<footer><time>${escapeHtml(message.time || '10:42')}</time>${ticksHtml(message)}</footer>${message.author === 'You' && !recipient ? `<small class="talk-routing">Agent won't see this</small>` : ''}<div class="talk-actions">${(message.reactions || []).map(r => `<button data-reaction aria-label="React ${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}<button data-reply="${escapeHtml(message.id)}">reply</button>${message.trace ? '<button class="talk-chip" data-tab="Trace">trace ↗</button>' : ''}</div></div></article>`;
}
export function traceHtml(sessions, traceRowsHtml) {
    return `<section class="talk-trace" aria-label="Trace"><h2>Trace</h2><p class="talk-muted">Main turns · workers · validator sessions</p>${sessions.map(session => `<details class="talk-trace-session" open><summary><strong>${escapeHtml(session.label)}</strong><span>${escapeHtml(session.time)} · ${escapeHtml(session.status)}</span></summary><div class="talk-trace-scroll"><table class="obs-timeline-table">${traceRowsHtml(session.events, { now: 1791716400000 })}</table></div></details>`).join('')}</section>`;
}
export function talkHtml(messages, options = {}) {
    const { moderator = 'User', availability = 'here', name = 'Talk', composer = '', unread = 0 } = options;
    return `<div class="talk-prototype moderator-${moderator.toLowerCase()}" data-availability="${escapeHtml(availability)}"><nav class="talk-tabs" aria-label="Panel tabs">${[name, 'Specs', 'Trace', 'Workers', 'Settings'].map((tab, i) => `<button data-tab="${i === 0 ? 'Talk' : tab}" aria-pressed="${i === 0}">${escapeHtml(tab)}</button>`).join('')}</nav><div class="talk-panel" data-panel="Talk"><header class="talk-header"><div><h2>${escapeHtml(name)}</h2><span>You · Agent · Validator</span></div><span class="talk-owner">${escapeHtml(moderator)} moderating</span></header><div class="talk-thread" role="log" aria-label="Group chat">${messages.length ? messages.map(m => messageHtml(m, messages)).join('') : '<div class="talk-empty"><span>✦</span><h3>A little room to think.</h3><p>Ask Validator, nudge Agent, or leave a note.</p><p>Use @agent when you want it picked up.</p></div>'}<div id="talk-bottom"></div></div>${unread ? `<button class="talk-unread" data-bottom>${unread} unread · jump to bottom ↓</button>` : ''}<div class="talk-composer">${composer.includes('@') ? '<div class="talk-mentions" role="listbox" aria-label="Mention a participant">'+['agent', 'validator', 'build-1'].map(p => `<button role="option" data-mention="${p}">@${p}<span>${p === 'agent' ? 'Main agent' : p === 'validator' ? 'Sees everything' : 'Worker'}</span></button>`).join('')+'</div>' : ''}<label class="talk-draft-label">Message the group<textarea aria-label="Message the group" placeholder="Message… @ to mention">${escapeHtml(composer)}</textarea></label><button class="talk-send" data-send aria-label="Post message">↑</button><small>You + Validator get everything. Agent/workers get mentions & replies only.</small></div></div><div data-panel="Trace" hidden>${options.trace || ''}</div><p class="talk-presence-note">Availability dot stays in the VS Code title bar · ${escapeHtml(availability)}</p></div>`;
}
export const traceSessions = ['Main turn · sidebar layout', 'Worker run · build-1', 'Validator session · gate'].map((label, i) => ({ label, time: `10:${40 + i}`, status: 'finished', events: [{ kind: 'request', id: String(i + 1), model: i === 2 ? 'Validator' : i === 1 ? 'build-1' : 'Agent', inputTokens: 1200, outputTokens: 160, cachedTokens: 1000, nanoAiu: 200000000 }] }));
const basics = [
    { kind: 'day', text: 'Today · Sunday, 11 October' },
    { id: 'a1', author: 'Agent', text: 'Keep the sidebar narrow?', time: '10:40' },
    { id: 'y1', author: 'You', text: '@agent yes. Try 420px.', replyTo: 'a1', time: '10:41', delivery: 'delivered', tool: 'commentary', reactions: ['👍 1'] },
    { id: 'v1', author: 'Validator', text: 'Works for me. Keep the composer in reach.', time: '10:42' },
    { id: 'y2', author: 'You', text: 'I like the softer border.', time: '10:43', delivery: 'posted' },
];
export const scenarios = {
    ShellUser: { messages: basics, moderator: 'User' },
    ShellValidator: { messages: basics, moderator: 'Validator', availability: 'awayValidator' },
    GroupChatBasics: { messages: basics, composer: '@' },
    Ticks: { messages: [...basics, { id: 'y3', author: 'You', text: '@agent keep the blue ticks.', delivery: 'posted', time: '10:44' }] },
    ValidatorAnswers: { messages: [{ id: 'questions', author: 'Validator', text: 'Two things to settle:', questions: [{ question: 'Keep the name Talk?', answer: 'Proposed: Talk for beta.', vote: 'up' }, { question: 'Hide old updates?', answer: 'Proposed: remove them after the run.', vote: 'down', correction: 'Keep them collapsed, not deleted.' }] }] },
    AgentProgress: { messages: [{ kind: 'progress', text: 'Layout ready', updates: ['🧭 Checked the current sidebar.', '🛠 Built the narrow layout.', '✅ 12 checks passed.'] }, { id: 'check', kind: 'heads-up', text: 'The reply chips fit. Want the timestamps quieter?' }, { id: 'done', author: 'Agent', text: 'The run is ready to review.', trace: true }] },
    AsyncCompletion: { messages: [{ id: 'gate', kind: 'system', text: 'Gate finished ✓ — Agent gets it with its next tool call', delivery: 'posted' }], async: true },
    WorkersJoin: { messages: [{ kind: 'system', text: 'build-1 joined' }, { id: 'w1', author: 'build-1', text: '@validator should I keep the reply preview to one line?' }, { id: 'wv', author: 'Validator', text: 'Yes. Let the full quote open on click.', replyTo: 'w1' }, { kind: 'system', text: 'build-1 left' }] },
    EmptyState: { messages: [] },
    LongBusyThread: { messages: [basics[0], ...Array.from({ length: 32 }, (_, i) => ({ id: `busy-${i}`, author: ['You', 'Agent', 'Validator'][i % 3], text: ['@agent try the smaller spacing.', 'Done. Have a look.', 'The reply still reads clearly.', 'Yes, keep this one.'][i % 4], time: `11:${String(i).padStart(2, '0')}` }))], unread: 6 },
};
export const betaMessages = after => [{ id: 'beta-agent', author: 'Agent', text: 'Is the narrow layout okay?' }, { id: 'beta-validator', author: 'Validator', text: 'Yes. Keep the composer fixed.', ...(after ? { replyTo: 'beta-agent' } : {}) }];
