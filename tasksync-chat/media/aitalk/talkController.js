import { talkHtml, mentionsHtml, mentioning } from './talkRender.js';
import { selectReply, routeMessage, owner } from './talkRules.js';
import { presenceHtml, createPresence } from './presence.js';
import { presenceChange, deliveryEvent } from './talkRules.js';
export function createTalkController({ host, events = host, post, options = {} }) {
const document = { getElementById: () => host, addEventListener: (...args) => events.addEventListener(...args), get activeElement() { return events.activeElement ?? globalThis.document?.activeElement; }, querySelector: selector => events.querySelector?.(selector) ?? globalThis.document?.querySelector(selector) };
const window = { askawayPostMessage: post, addEventListener() {} };
let availability = { mode: 'here' }, presenceOpen = false, presenceReset = 'never';
let state = { messages: [], members: [] }, reply, draft = '', emoji = false, attachments = [], caret = [0, 0];
const root = () => document.getElementById('aitalk-root');
let composing = false, deferredState;
function renderAITalk(next = state) {
    if (composing) { deferredState = next; return; }
    const refresh = next !== state;
    const expanded = new Set(state.messages.filter(message => message.expanded).map(message => message.id));
    const members = next.members || [...new Map(next.messages.filter(message => message.author).map(message => [message.author, { id: message.author, displayName: message.displayName || message.author, kind: message.authorKind || message.participantKind, rank: message.rank || 0, presence: 'joined' }])).values()];
    state = { ...next, members: members.map(member => member.kind === 'user' ? { ...member, presence: 'joined' } : member), messages: next.messages.map(message => expanded.has(message.id) ? { ...message, expanded: true } : message) };
    const host = root();
    if (!host) return;
    const oldThread = host.querySelector('.talk-thread');
    const top = oldThread?.scrollTop;
    const bottom = !oldThread || oldThread.scrollHeight - oldThread.scrollTop - oldThread.clientHeight < 40;
    const oldComposer = host.querySelector('textarea');
    const focused = oldComposer && document.activeElement === oldComposer;
    const selection = focused ? [oldComposer.selectionStart, oldComposer.selectionEnd, oldComposer.selectionDirection] : undefined;
    if (oldComposer && refresh) draft = oldComposer.value;
    host.innerHTML = talkHtml(state.messages, { ...options, typing: state.typing, unread: state.unread, members: state.members, reply, draft, emoji, attachments, embedded: options.embedded !== false, presence: { ...availability, open: presenceOpen, reset: presenceReset, name: state.userName || state.members.find(member => member.kind === 'user')?.displayName || '', photo: state.userPhoto || '' } });
    const thread = host.querySelector('.talk-thread');
    if (thread) thread.scrollTop = bottom ? thread.scrollHeight : top;
    if (focused) {
        const composer = host.querySelector('textarea');
        composer.focus();
        composer.setSelectionRange(...selection);
    }
}
function receive(data) {
    if (data.type === 'aitalkState') renderAITalk(data.data);
    if (data.type === 'availabilityState') { availability = data.data || { mode: 'here' }; renderAITalk(); }
    if (data.type === 'openPresence') { presenceOpen = true; renderAITalk(); }
    if (data.type === 'aitalkAttachments') { attachments.push(...data.files); draft = root().querySelector('textarea').value; renderAITalk(); }
}
function sendMessage() {
    const text = root().querySelector('textarea').value;
    if (!text.trim()) return;
    const recipients = routeMessage({ text, replyTo: reply?.id, author: owner(state.members)?.id }, state.messages, state.members);
    window.askawayPostMessage({ type: reply ? 'aitalkReply' : 'aitalkPost', text, replyTo: reply?.id, recipients, attachments });
    reply = undefined; draft = ''; attachments = []; emoji = false; renderAITalk();
}
document.addEventListener('click', event => {
    if (options.embedded !== false && !event.target.closest('#aitalk-root')) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset?.tab) { post({ type: 'talkTab', tab: button.dataset.tab }); root().querySelectorAll?.('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== button.dataset.tab; }); return; }
    if (button.hasAttribute('data-bottom')) { const thread = root().querySelector('.talk-thread'); thread.scrollTop = thread.scrollHeight; state.unread = 0; renderAITalk(); return; }
    if (button.hasAttribute('data-react-more')) { const extra = button.parentElement.querySelector('.talk-react-extra'); extra.hidden = !extra.hidden; return; }
    if (button.hasAttribute('data-send')) {
        sendMessage();
    } else if (button.dataset.reply) { reply = selectReply(state.messages, button.dataset.reply); renderAITalk(); }
    else if (button.hasAttribute('data-cancel-reply')) { reply = undefined; renderAITalk(); }
    else if (button.dataset.react) { const message = state.messages.find(item => item.id === button.dataset.msg); window.askawayPostMessage(message?.draftId && button.dataset.react === '👍' ? { type: 'aitalkApproveDraft', draftId: message.draftId } : { type: 'aitalkReact', replyTo: button.dataset.msg, emoji: button.dataset.react }); }
    else if (button.classList?.contains('presence-trigger')) { presenceOpen = !presenceOpen; renderAITalk(); }
    else if (button.dataset.presence) { const control = createPresence({ mode: availability.mode, reset: presenceReset }); control.choose(button.dataset.presence); const value = control.snapshot(); window.askawayPostMessage({ type: 'setAvailability', mode: value.mode, until: value.expiresAt ? new Date(value.expiresAt).toISOString() : '', note: '' }); presenceOpen = false; renderAITalk(); }
    else if (button.dataset.mention) { draft = draft.replace(/@[^\s@]*$/, '@' + button.dataset.mention + ' '); renderAITalk(); root().querySelector('textarea').focus(); }
    else if (button.hasAttribute('data-emoji')) { const input = root().querySelector('textarea'); draft = input.value; caret = [input.selectionStart ?? draft.length, input.selectionEnd ?? draft.length]; emoji = !emoji; renderAITalk(); }
    else if (button.dataset.insertEmoji) { draft = draft.slice(0, caret[0]) + button.dataset.insertEmoji + draft.slice(caret[1]); emoji = false; renderAITalk(); const input = root().querySelector('textarea'); input.focus(); input.setSelectionRange(caret[0] + button.dataset.insertEmoji.length, caret[0] + button.dataset.insertEmoji.length); }
    else if (button.hasAttribute('data-attach')) window.askawayPostMessage({ type: 'aitalkAttach' });
    else if (button.dataset.more) { state.messages = state.messages.map(message => message.id === button.dataset.more ? { ...message, expanded: !message.expanded } : message); renderAITalk(); }
});
document.addEventListener('input', event => {
    if (!event.target.matches('textarea')) return;
    draft = event.target.value;
    const menu = root().querySelector('.talk-mentions');
    if (!mentioning(draft)) menu?.remove();
    else if (!menu) root().querySelector('.talk-composer').insertAdjacentHTML('afterbegin', mentionsHtml(state.members));
});
document.addEventListener('change', event => { if (event.target.matches?.('#aitalk-root .presence-reset select')) presenceReset = event.target.value; });
document.addEventListener('contextmenu', event => {
    const bubble = event.target.closest('#aitalk-root .talk-bubble[data-msg]');
    if (bubble) { event.preventDefault(); bubble.classList.toggle('reacting'); }
});
document.addEventListener('keydown', event => {
    const menu = root()?.querySelector('.talk-mentions');
    const choices = menu ? [...(menu.querySelectorAll?.('[data-mention]') || [])] : [];
    if (choices.length && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Escape') { menu.remove(); return; }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { mentionIndex = (mentionIndex + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; choices.forEach((choice, index) => choice.setAttribute('aria-selected', String(index === mentionIndex))); return; }
        draft = draft.replace(/@[^\s@]*$/, '@' + choices[mentionIndex].dataset.mention + ' '); renderAITalk(); root().querySelector('textarea').focus(); return;
    }
    if (event.target.matches?.('#aitalk-root textarea') && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage(); return; }
    const bubble = event.target.closest('#aitalk-root .talk-bubble[data-msg]');
    const reactionButtons = [...(bubble?.querySelectorAll?.('.talk-react-bar [role="menuitem"]') || [])];
    const reactionIndex = reactionButtons.indexOf(event.target);
    if (reactionIndex >= 0 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); reactionButtons[(reactionIndex + (event.key === 'ArrowRight' ? 1 : -1) + reactionButtons.length) % reactionButtons.length].focus(); return; }
    if (bubble && event.key === 'Enter') { bubble.classList.toggle('reacting'); event.preventDefault(); }
    if (event.key === 'Escape') root()?.querySelectorAll('.reacting').forEach(el => el.classList.remove('reacting'));
});
document.addEventListener('compositionstart', event => { if (event.target.matches?.('#aitalk-root textarea')) composing = true; });
document.addEventListener('compositionend', event => {
    if (!event.target.matches?.('#aitalk-root textarea')) return;
    composing = false; draft = event.target.value;
    if (deferredState) { const next = deferredState; deferredState = undefined; renderAITalk(next); }
});
document.addEventListener('click', event => {
    const link = event.target.closest('#aitalk-root [data-tab="Trace"]');
    if (link) { event.preventDefault(); document.querySelector('.widget-tab[data-tab="observability"]')?.click(); }
});
let mentionIndex = 0, pressTimer;
document.addEventListener('pointerdown', event => { const bubble = event.target.closest?.('.talk-bubble[data-msg]'); if (bubble && event.pointerType === 'touch') pressTimer = setTimeout(() => bubble.classList.add('reacting'), 500); });
for (const name of ['pointerup', 'pointercancel', 'pointermove', 'scroll']) document.addEventListener(name, () => { clearTimeout(pressTimer); });
function step(value) {
    if (value.do === 'typing') state.typing = value.who;
    if (value.do === 'add') { state.typing = ''; state.messages.push(value.message); }
    if (value.do === 'join' || value.do === 'leave') { const changed = presenceChange(state.members, value.who, value.do === 'join'); state.members = changed.registry; state.messages.push(...changed.notices); }
    if (value.do === 'event' || value.do === 'deliver') state.messages = state.messages.map(message => message.id === value.id ? deliveryEvent(message, value.event || 'delivered') : message);
    if (value.do === 'react') state.messages = state.messages.map(message => message.id === value.id ? { ...message, reactions: [...(message.reactions || []), { emoji: value.emoji, by: [value.by] }] } : message);
    renderAITalk();
}
return { render: renderAITalk, receive, step, snapshot: () => state };
}
