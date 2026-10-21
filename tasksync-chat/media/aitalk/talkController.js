import { talkHtml, talkParts, mentionsHtml, mentioning } from './talkRender.js';
import { selectReply } from './talkRules.js';
import { createPresence, bindPresenceInteractions } from './presence.js';
// The AITalk widget: it only receives data (registered actors, messages, typing, ticks) and emits user intents
// (post, reply, react, @mention, availability). Storybook feeds simulated actors; the extension feeds real ones.
export function createTalkController({ host, events = host.ownerDocument || host, post, options = {} }) {
const inside = target => !host.contains || host.contains(target);
const document = { addEventListener: (name, listener) => events.addEventListener(name, event => { if (inside(event.target)) listener(event); }), get activeElement() { return events.activeElement ?? host.ownerDocument?.activeElement; } };
let availability = createPresence();
let state = { messages: [], members: [] }, reply, draft = '', emoji = false, attachments = [], caret = [0, 0];
let painted;
let avatars = (typeof window !== 'undefined' && window.askawayMemberAvatars) || {};
const root = () => host;
let composing = false, deferredState;
const regionOf = key => { const element = host.querySelector?.(`[data-talk-region="${key}"]`); return element?.dataset?.talkRegion === key ? element : undefined; };
function renderAITalk(next = state) {
    if (composing) { deferredState = next; return; }
    const refresh = next !== state;
    const expanded = new Set(state.messages.filter(message => message.expanded).map(message => message.id));
    const members = next.members || [...new Map(next.messages.filter(message => message.author).map(message => [message.author, { id: message.author, displayName: message.displayName || message.author, kind: message.authorKind || message.participantKind, rank: message.rank || 0, presence: 'joined' }])).values()];
    state = { ...next, members: members.map(member => member.kind === 'user' ? { ...member, presence: 'joined' } : member), messages: next.messages.map(message => expanded.has(message.id) ? { ...message, expanded: true } : message) };
    if (!host) return;
    const oldThread = host.querySelector('.talk-thread');
    const top = oldThread?.scrollTop;
    const bottom = !oldThread || oldThread.scrollHeight - oldThread.scrollTop - oldThread.clientHeight < 40;
    const oldComposer = host.querySelector('textarea');
    const focused = oldComposer && document.activeElement === oldComposer;
    const selection = focused ? [oldComposer.selectionStart, oldComposer.selectionEnd, oldComposer.selectionDirection] : undefined;
    if (oldComposer && refresh) draft = oldComposer.value;
    // Team portraits arrive from the Team tab (memberId -> avatarSrc); users keep their own photo.
    const faceOf = m => avatars[m.memberId] || avatars[m.id] || '';
    const viewMembers = state.members.map(m => m.avatarSrc || m.photo ? m : m.kind === 'user' ? (state.userPhoto ? { ...m, photo: state.userPhoto } : m) : faceOf(m) ? { ...m, avatarSrc: faceOf(m) } : m);
    const view = { ...options, avatarFor: options.avatarFor || (id => avatars[id] || ''), typing: state.typing, unread: state.unread, members: viewMembers, reply, draft, emoji, attachments, embedded: options.embedded !== false, presence: { ...availability.snapshot(), name: state.userName || state.members.find(member => member.kind === 'user')?.displayName || '', photo: state.userPhoto || '' } };
    const parts = talkParts(state.messages, view);
    const changed = painted ? Object.keys(parts).filter(key => parts[key] !== painted[key]) : Object.keys(parts);
    // Patch only changed regions; an unchanged region (an open avatar menu, the composer) is never re-mounted.
    const slots = painted && changed.map(regionOf);
    if (slots && slots.every(Boolean)) changed.forEach((key, index) => { slots[index].innerHTML = parts[key]; });
    else host.innerHTML = talkHtml(state.messages, view);
    painted = parts;
    const thread = host.querySelector('.talk-thread');
    if (thread && changed.includes('thread')) thread.scrollTop = bottom ? thread.scrollHeight : top;
    if (focused && (!slots || changed.includes('composer'))) {
        const composer = host.querySelector('textarea');
        composer.focus();
        composer.setSelectionRange(...selection);
    }
}
function receive(data) {
    if (data.type === 'aitalkState') renderAITalk(data.data);
    if (data.type === 'memberAvatars') { avatars = data.data || {}; if (painted) renderAITalk(); }
    if (data.type === 'availabilityState') { availability = createPresence({ ...availability.snapshot(), ...(data.data || { mode: 'here' }), until: data.data?.until || '' }); renderAITalk(); }
    if (data.type === 'openPresence') { if (!availability.snapshot().open) availability.toggle(); renderAITalk(); }
    if (data.type === 'aitalkAttachments') { attachments.push(...data.files); draft = root().querySelector('textarea').value; renderAITalk(); }
}
let selectedMentionMemberId;
// webview.js publishes window.askawayMemberAvatars and fires this event whenever the Team data changes.
events.addEventListener('askaway-member-avatars', () => receive({ type: 'memberAvatars', data: (typeof window !== 'undefined' && window.askawayMemberAvatars) || {} }));
// Routing is the room's job: the widget only says what the user wrote and what it replies to.
function sendMessage() {
    const text = root().querySelector('textarea').value;
    if (!text.trim()) return;
    post({ type: reply ? 'aitalkReply' : 'aitalkPost', text, replyTo: reply?.id, attachments, ...(selectedMentionMemberId ? { mentionMemberId: selectedMentionMemberId } : {}) });
    reply = undefined; draft = ''; attachments = []; emoji = false; selectedMentionMemberId = undefined; renderAITalk();
}
document.addEventListener('click', event => {
    const trace = event.target.closest('a.talk-trace-link[data-tab]');
    if (trace?.dataset?.tab) { event.preventDefault(); post({ type: 'talkTab', tab: trace.dataset.tab }); return; }
    // Only a member's face or name opens Team (reviewer, 2026-10-21). The whole message row carries data-member-id, so
    // matching any [data-member-id] ancestor made every click on a bubble, reaction or chip switch tabs.
    const memberEl = event.target.closest?.('.talk-sender, .talk-avatar, .talk-quote-who, .talk-mention, .aitalk-roster-name, .aitalk-presence-label');
    const selected = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? String(window.getSelection() || '') : '';
    const memberId = memberEl && !selected && !event.target.closest?.('button') && !memberEl.dataset?.mention && (memberEl?.dataset?.memberId || memberEl?.dataset?.member || (memberEl?.classList?.contains?.('talk-mention') ? String(memberEl.textContent || '').replace(/^@/, '').trim().toLowerCase() : ''));
    if (memberId) {
        if (typeof window !== 'undefined' && typeof window.focusTeamMember === 'function') window.focusTeamMember(memberId);
        post({ type: 'talkMember', member: memberId, memberId });
        return;
    }
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset?.tab) { post({ type: 'talkTab', tab: button.dataset.tab }); root().querySelectorAll?.('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== button.dataset.tab; }); return; }
    if (button.hasAttribute('data-clear-chat')) { post({ type: 'aitalkClear' }); return; }
    if (button.hasAttribute('data-bottom')) { const thread = root().querySelector('.talk-thread'); thread.scrollTop = thread.scrollHeight; state.unread = 0; renderAITalk(); return; }
    if (button.hasAttribute('data-react-more')) { const extra = button.parentElement.querySelector('.talk-react-extra'); extra.hidden = !extra.hidden; return; }
    if (button.hasAttribute('data-send')) {
        sendMessage();
    } else if (button.dataset.reply) { reply = selectReply(state.messages, button.dataset.reply); renderAITalk(); }
    else if (button.hasAttribute('data-cancel-reply')) { reply = undefined; renderAITalk(); }
    else if (button.dataset.react) { const message = state.messages.find(item => item.id === button.dataset.msg); post(message?.draftId && button.dataset.react === '👍' ? { type: 'aitalkApproveDraft', draftId: message.draftId } : { type: 'aitalkReact', replyTo: button.dataset.msg, emoji: button.dataset.react }); }
    else if (button.dataset.mention) { selectedMentionMemberId = button.dataset.memberId || undefined; draft = draft.replace(/@[^\s@]*$/, '@' + button.dataset.mention + ' '); renderAITalk(); root().querySelector('textarea').focus(); }
    else if (button.hasAttribute('data-emoji')) { const input = root().querySelector('textarea'); draft = input.value; caret = [input.selectionStart ?? draft.length, input.selectionEnd ?? draft.length]; emoji = !emoji; renderAITalk(); }
    else if (button.dataset.insertEmoji) { draft = draft.slice(0, caret[0]) + button.dataset.insertEmoji + draft.slice(caret[1]); emoji = false; renderAITalk(); const input = root().querySelector('textarea'); input.focus(); input.setSelectionRange(caret[0] + button.dataset.insertEmoji.length, caret[0] + button.dataset.insertEmoji.length); }
    else if (button.hasAttribute('data-attach')) post({ type: 'aitalkAttach' });
    else if (button.dataset.more) { state.messages = state.messages.map(message => message.id === button.dataset.more ? { ...message, expanded: !message.expanded } : message); renderAITalk(); }
});
document.addEventListener('input', event => {
    if (!event.target.matches('textarea')) return;
    draft = event.target.value;
    const menu = root().querySelector('.talk-mentions');
    if (!mentioning(draft)) menu?.remove();
    else if (!menu) root().querySelector('.talk-composer').insertAdjacentHTML('afterbegin', mentionsHtml(state.members, { draft }));
});
document.addEventListener('contextmenu', event => {
    const bubble = event.target.closest('.talk-bubble[data-msg]');
    if (bubble) { event.preventDefault(); bubble.classList.toggle('reacting'); }
});
document.addEventListener('keydown', event => {
    const menu = root()?.querySelector('.talk-mentions');
    const choices = menu ? [...(menu.querySelectorAll?.('[data-mention]') || [])] : [];
    if (choices.length && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Escape') { menu.remove(); return; }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { mentionIndex = (mentionIndex + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; choices.forEach((choice, index) => choice.setAttribute('aria-selected', String(index === mentionIndex))); return; }
        selectedMentionMemberId = choices[mentionIndex].dataset?.memberId || undefined;
        draft = draft.replace(/@[^\s@]*$/, '@' + choices[mentionIndex].dataset.mention + ' '); renderAITalk(); root().querySelector('textarea').focus(); return;
    }
    if (event.target.matches?.('textarea') && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage(); return; }
    const bubble = event.target.closest('.talk-bubble[data-msg]');
    const reactionButtons = [...(bubble?.querySelectorAll?.('.talk-react-bar [role="menuitem"]') || [])];
    const reactionIndex = reactionButtons.indexOf(event.target);
    if (reactionIndex >= 0 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); reactionButtons[(reactionIndex + (event.key === 'ArrowRight' ? 1 : -1) + reactionButtons.length) % reactionButtons.length].focus(); return; }
    if (bubble && ['Enter', 'ContextMenu'].includes(event.key) || bubble && event.key === 'F10' && event.shiftKey) { bubble.classList.toggle('reacting'); event.preventDefault(); }
    if (event.key === 'Escape') closeReactions();
});
document.addEventListener('compositionstart', event => { if (event.target.matches?.('textarea')) composing = true; });
document.addEventListener('compositionend', event => {
    if (!event.target.matches?.('textarea')) return;
    composing = false; draft = event.target.value;
    if (deferredState) { const next = deferredState; deferredState = undefined; renderAITalk(next); }
});
function closeReactions() { host.querySelectorAll?.('.reacting').forEach(el => el.classList.remove('reacting')); }
events.addEventListener('click', event => { if (!inside(event.target) || !event.target.closest?.('.talk-react-bar')) closeReactions(); });
let mentionIndex = 0, pressTimer;
document.addEventListener('pointerdown', event => { const bubble = event.target.closest?.('.talk-bubble[data-msg]'); if (bubble && event.pointerType === 'touch') pressTimer = setTimeout(() => bubble.classList.add('reacting'), 500); });
for (const name of ['pointerup', 'pointercancel', 'pointermove', 'scroll']) document.addEventListener(name, () => { clearTimeout(pressTimer); });
bindPresenceInteractions({ root: host, events, control: () => availability, choose: value => post({ type: 'setAvailability', mode: value.mode, until: value.expiresAt ? new Date(value.expiresAt).toISOString() : '', note: '' }), paint: focus => { renderAITalk(); if (focus) { const value = availability.snapshot(); (value.open ? host.querySelectorAll?.('[data-presence]')[value.focusIndex] : host.querySelector('.presence-trigger'))?.focus(); } } });
return { render: renderAITalk, receive, snapshot: () => state };
}
