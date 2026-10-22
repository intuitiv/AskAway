// Shared AITalk renderer: pure functions, messages array -> HTML string.
// Production can adopt these as-is; nothing here touches the DOM.

import { escapeHtml, inlineMarkdown, markdownHtml, hasBlockMarkdown } from './markdown.js';
import { defaultMembers, participant, displayName, owner, primaryReply, resolveRosterMember, memberIdOf, mentionCandidates } from './talkRules.js';
export { escapeHtml } from './markdown.js';
import { presenceHtml } from './presence.js';
export { defaultMembers } from './talkRules.js';

export const initialsOf = name => {
    const words = String(name || '').trim().match(/[A-Za-z0-9]+/g) || [];
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

export function avatarBadgeHtml(member, { sizeClass = '', avatarFor, emptyAlt = true, hideInitialsText = false } = {}) {
    const rawId = memberIdOf(member) || (typeof member === 'string' ? member : member?.id || '?');
    const label = typeof member === 'string' ? member : displayName(member || { id: '?' });
    const initials = escapeHtml(member?.initials || initialsOf(label));
    const rawSrc = member?.avatarSrc || member?.photo || (typeof avatarFor === 'function' ? avatarFor(rawId) : '') || '';
    const cls = ['team-avatar-badge', sizeClass, rawSrc ? 'has-image' : 'has-initials'].filter(Boolean).join(' ');
    const id = escapeHtml(rawId);
    if (rawSrc) {
        const extraAttr = [
            member?.fixturePath ? ` data-fixture-path="${escapeHtml(member.fixturePath)}"` : '',
            member?.fallbackAvatar ? ` data-fallback-src="${escapeHtml(member.fallbackAvatar)}"` : '',
        ].join('');
        const altAttr = emptyAlt ? '' : escapeHtml(label);
        return `<span class="${cls}" data-member-id="${id}" data-initials="${initials}"><img class="team-avatar-img" src="${escapeHtml(rawSrc)}" alt="${altAttr}" data-alt="${escapeHtml(label)}"${extraAttr} /></span>`;
    }
    return `<span class="${cls}" data-member-id="${id}" data-initials="${initials}"><span class="team-avatar-initials">${hideInitialsText ? '' : initials}</span></span>`;
}

// Stable colour class per participant: named roles first, everyone else hashed.
export function whoClass(name, members = defaultMembers) {
    const key = String(name).toLowerCase();
    const configured = participant(members, name)?.colour;
    if (configured) return configured;
    let hash = 0;
    for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) % 4;
    return `who-p${hash}`;
}

const mentionRegex = members => {
    const names = [...new Set([
        ...members.flatMap(m => [displayName(m), m.name, m.id, m.memberId]),
    ].filter(Boolean))].sort((a, b) => String(b).length - String(a).length).map(name => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`@(${names.join('|')})(?![\\w-])`, 'gi');
};
const mentionsOf = members => html => html.replace(mentionRegex(members), (full, mentioned) => {
    const target = participant(members, mentioned);
    const id = target ? memberIdOf(target) : '';
    return `<b class="talk-mention"${id ? ` data-member-id="${escapeHtml(id)}"` : ''}>@${escapeHtml(target ? displayName(target) : mentioned)}</b>`;
});
// Inline markdown (code, bold, italic, http links) with @mentions; HTML is always escaped first.
export const textHtml = (text, members = defaultMembers) => inlineMarkdown(text, mentionsOf(members));

const CHECK_A = 'M0.8 5.9 4.1 9.2 10.6 1.5';
const CHECK_B = 'M4.4 5.9 7.7 9.2 14.2 1.5';
// WhatsApp-style ticks: one check = posted (grey), two overlapping checks = delivered (blue).
export function tickSvg(delivered) {
    return `<svg class="talk-tick-svg" viewBox="0 0 16 11" width="16" height="11" aria-hidden="true" focusable="false"><path d="${CHECK_A}"/>${delivered ? `<path d="${CHECK_B}"/>` : ''}</svg>`;
}

// Tick state from the receiving actor's tracker: sent (single), delivered (double grey), read (double blue).
export function ticksHtml(message) {
    const state = message.tick || message.delivery;
    if (!state) return '';
    const delivery = state === 'sent' ? 'posted' : state === 'handedOver' ? 'delivered' : state;
    const delivered = delivery !== 'posted';
    const title = delivered ? `${delivery === 'read' ? 'Read' : 'Delivered'} · ${message.tool || 'recipient event'}` : 'Posted · waiting for a tool response';
    return `<span class="talk-ticks ${delivery}" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">${tickSvg(delivered)}</span>`;
}

export function quoteHtml(quote, members = defaultMembers) {
    const qMember = participant(members || defaultMembers, quote.author) || { id: quote.author };
    const qId = memberIdOf(qMember);
    const qIdAttr = qId ? ` data-member-id="${escapeHtml(qId)}"` : '';
    return `<div class="talk-quote ${whoClass(quote.author, members)}"><b class="talk-quote-who aitalk-quote-who"${qIdAttr}>${escapeHtml(displayName(qMember))}</b><span class="talk-quote-text">${textHtml(quote.text, members)}</span></div>`;
}

export const reactionChoices = ['👍', '👎', '❤️', '😂', '🙏'];
export const moreReactions = ['🎉', '👀', '✅', '🤔'];

// Reactions come as {emoji, count, mine, delivery, tool} or legacy strings like '👍 2'.
export function normalizeReactions(list = []) {
    return list.map(r => {
        if (typeof r !== 'string') return { count: 1, ...r };
        const [emoji, count] = r.split(' ');
        return { emoji, count: Number(count) || 1, mine: false };
    });
}

// Who receives a reaction: Validator learns from it, everyone else gets it with its next tool call.
export function reactionNote(author, emoji) {
    if (emoji === '👎') return `Feedback for ${author} learning`;
    return `Delivered to ${author} with its next tool call`;
}

export function reactBarHtml(message) {
    const button = (emoji, extra = '') => `<button type="button" role="menuitem" tabindex="-1" class="talk-react-btn ${extra}" data-react="${emoji}" data-msg="${escapeHtml(message.id || '')}" aria-label="React ${emoji}" title="${emoji} · ${escapeHtml(reactionNote(message.author, emoji))}">${emoji}</button>`;
    return `<div class="talk-react-bar" role="menu" aria-label="React to ${escapeHtml(message.author)}"><button type="button" role="menuitem" tabindex="-1" class="talk-reply-action" data-reply="${escapeHtml(message.id)}">Reply</button>${reactionChoices.map(e => button(e)).join('')}<button type="button" role="menuitem" tabindex="-1" class="talk-react-btn more" data-react-more aria-label="More reactions" title="More reactions">+</button><span class="talk-react-extra" hidden>${moreReactions.map(e => button(e)).join('')}</span></div>`;
}

export function reactionsHtml(message) {
    const list = normalizeReactions(message.reactions);
    if (!list.length) return '';
    const pills = list.map(r => {
        const delivered = r.delivery === 'delivered';
        const by = (r.by || []).join(', ');
        const tip = r.mine
            ? `${reactionNote(message.author, r.emoji)} · ${delivered ? `double check, delivered · ${r.tool || 'tool call'}` : 'single check, posted'}`
            : (by ? `${by} reacted` : `${r.count} reacted`);
        const ticks = r.mine && r.delivery ? `<span class="talk-ticks ${r.delivery}">${tickSvg(r.delivery !== 'posted')}</span>` : '';
        return `<button type="button" class="talk-reaction-pill ${r.mine ? 'mine' : ''}" data-react="${r.emoji}" data-msg="${escapeHtml(message.id || '')}" aria-pressed="${!!r.mine}" title="${escapeHtml(tip)}">${r.emoji}${r.count > 1 ? ` <small>${r.count}</small>` : ''}${ticks}</button>`;
    }).join('');
    return `<span class="talk-reaction" aria-label="Reactions">${pills}</span>`;
}

export const COLLAPSE_CHARS = 240;
export const COLLAPSE_LINES = 4;
const SUMMARY_CHARS = 140;

// Short body for a long message: first line, cut at a word boundary.
function summaryOf(text) {
    const first = text.split('\n')[0];
    if (first.length <= SUMMARY_CHARS && first.length < text.length) return first;
    const cut = first.slice(0, SUMMARY_CHARS);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trimEnd()}…`;
}

// One rule for every participant: `details` hides behind Read more; so does any text over ~240 chars or 4 lines.
export function splitBody(message) {
    const text = message.text || '';
    if (message.details) return { short: text.length > SUMMARY_CHARS ? summaryOf(text) : text, full: text, details: message.details, collapsible: true };
    if (text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES) return { short: summaryOf(text), full: text, details: '', collapsible: true };
    return { short: text, full: text, details: '', collapsible: false };
}

// Details and long bodies use the same safe markdown renderer as every message.
export function detailsHtml(details, members = defaultMembers) {
    return markdownHtml(details, mentionsOf(members));
}

const textBlockHtml = (text, members) => hasBlockMarkdown(text)
    ? `<div class="talk-text talk-md">${markdownHtml(text, mentionsOf(members))}</div>`
    : `<span class="talk-text">${textHtml(text, members)}</span>`;

export function bodyHtml(message, members = defaultMembers) {
    if (!message.text && !message.details) return '';
    const { short, full, details, collapsible } = splitBody(message);
    const id = escapeHtml(message.id || '');
    const open = !!message.expanded;
    const text = textBlockHtml(open && !details ? full : short, members);
    if (!collapsible) return text;
    const body = open && details ? `<div class="talk-details" id="talk-details-${id}">${detailsHtml(details, members)}</div>` : '';
    return `${text}${body}<button type="button" class="talk-more" data-more="${id}" aria-expanded="${open}"${open && details ? ` aria-controls="talk-details-${id}"` : ''}>${open ? 'Show less' : 'Show more'}</button>`;
}

// The one approval card for any provider and action: target NAME, details (thread, quoted message), files and the full text, never
// collapsed; 👍 approves, 👎 rejects (the same reaction intents). Raw ids never appear: only names and quotes are stored for display.
const DRAFT_LABELS = { pending: 'Draft', sent: 'Sent', failed: 'Not confirmed', rejected: 'Rejected' };
const SENT_LABELS = { edit: 'Edited', delete: 'Deleted' };
export function draftCardHtml(message) {
    const draft = message.webexDraft || {};
    const state = DRAFT_LABELS[draft.state] ? draft.state : 'pending';
    const id = escapeHtml(message.id || '');
    const generic = Boolean(draft.provider);
    const provider = generic ? String(draft.provider).charAt(0).toUpperCase() + String(draft.provider).slice(1) : 'Webex';
    const to = generic
        ? [['To', draft.recipientLabel], ...Object.entries(draft.details || {}), ['Files', (draft.files || []).join(', ')]]
        : [['Space', draft.space || draft.recipientLabel], ['Person', draft.toPersonEmail], ['Thread', draft.parentId && 'reply in a thread']];
    const rows = to.filter(([, value]) => value);
    const approve = !generic || ['send', 'reply', 'upload'].includes(draft.action) ? '👍 Send' : '👍 Approve';
    const actions = state === 'pending' && message.draftId && !draft.unresolved
        ? `<div class="talk-draft-actions"><button type="button" class="talk-draft-approve" data-react="👍" data-msg="${id}" aria-label="Approve and send">${approve}</button><button type="button" class="talk-draft-reject" data-react="👎" data-msg="${id}" aria-label="Reject draft">👎 Reject</button></div>` : '';
    const unresolved = state === 'pending' && draft.unresolved ? '<div class="talk-draft-outcome">The name is not resolved yet, so this cannot be sent.</div>' : '';
    const sent = (SENT_LABELS[draft.action] || 'Sent') + (draft.sentId ? ` · id <code>${escapeHtml(draft.sentId)}</code>` : '');
    const outcome = state === 'sent' ? `<div class="talk-draft-outcome">${sent}</div>`
        : state === 'rejected' ? '<div class="talk-draft-outcome">Rejected · nothing was sent</div>'
            : state === 'failed' ? `<div class="talk-draft-outcome">${escapeHtml(provider)} did not confirm the ${generic ? escapeHtml(draft.action) : 'send'}</div>` : '';
    return `<div class="talk-draft ${state}" data-draft-state="${state}"><div class="talk-draft-head"><span class="talk-draft-badge">${DRAFT_LABELS[state]}</span> ${escapeHtml(provider)} ${generic ? escapeHtml(draft.action) : 'message'}${draft.edited && state === 'pending' ? ' · edited, approve again' : ''}</div><dl class="talk-draft-to">${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl><div class="talk-draft-text">${escapeHtml(draft.text || '')}</div>${unresolved}${actions}${outcome}</div>`;
}

export function bubbleHtml(message, { messages = [], members = defaultMembers, first = true, avatarFor } = {}) {
    const authorMember = participant(members, message.author) || { id: message.author, displayName: message.author };
    const mine = participant(members, message.author)?.id === owner(members)?.id;
    const parent = message.replyTo && messages.find(m => m.id === message.replyTo);
    const quote = message.quote || (parent && { author: parent.author, text: parent.text });
    const namedMessage = { ...message, author: displayName(authorMember), reactions: message.reactions?.map(r => typeof r === 'string' ? r : { ...r, by: r.by?.map(id => displayName(participant(members, id) || { id })) }) };
    const reactions = reactionsHtml(namedMessage);
    const memberId = memberIdOf(authorMember);
    const label = displayName(authorMember);
    message = { ...message, author: label };
    const showUserHeader = Boolean(authorMember.avatarSrc || authorMember.photo || memberId === 'machs');
    const name = (!mine || showUserHeader) && first ? `<span class="talk-sender ${whoClass(message.author, members)} aitalk-who" data-member="${escapeHtml(message.author)}" data-member-id="${escapeHtml(memberId)}">${escapeHtml(label)}</span>` : '';
    const faceHtml = avatarBadgeHtml(authorMember, { sizeClass: 'aitalk-bubble-face', avatarFor, emptyAlt: true });
    const avatar = (!mine || showUserHeader)
        ? (first ? `<span class="talk-avatar ${whoClass(message.author, members)} aitalk-avatar" data-member="${escapeHtml(message.author)}" data-member-id="${escapeHtml(memberId)}" aria-hidden="true">${faceHtml}</span>` : '<span class="talk-avatar-gap" aria-hidden="true"></span>')
        : '';
    const trace = (message.attachments ?? []).map(file => `<span class="talk-attachment">${escapeHtml(file.name)}</span>`).join('') + (message.trace ? `<a class="talk-trace-link" href="#trace" data-tab="Trace">View trace ↗</a>` : '');
    const msgId = escapeHtml(message.id || '');
    return `<div class="talk-row ${mine ? 'out' : 'in'} ${first ? 'first' : 'follow'} aitalk-msg" id="talk-${msgId}" data-id="${msgId}" data-actor="${escapeHtml(memberId)}" data-member-id="${escapeHtml(memberId)}">${avatar}<div class="talk-bubble ${first ? 'tail' : ''} ${normalizeReactions(message.reactions).length ? 'has-reaction' : ''}"${mine ? '' : ` tabindex="0" data-msg="${msgId}" aria-label="${escapeHtml(message.author)}: message. Right-click, long-press or press Enter to react."`}>${mine ? '' : reactBarHtml(message)}${name}${quote ? quoteHtml(quote, members) : ''}${message.webexDraft ? draftCardHtml(message) : bodyHtml(message, members)}${trace}<span class="talk-meta"><time>${escapeHtml(message.time || '')}</time>${mine ? ticksHtml(message) : ''}</span>${reactions}</div></div>`;
}

export function systemHtml(item, members = defaultMembers, options = {}) {
    if (item.kind !== 'day' && item.kind !== 'memory') {
        const trimmed = String(item.text || '').trim();
        const match = /^(.+?)\s+(joined|left)$/.exec(trimmed);
        if (match) {
            const actorName = match[1];
            const found = (item.memberId && participant(members, item.memberId)) || (item.author && participant(members, item.author)) || participant(members, actorName) || { id: actorName.toLowerCase(), displayName: actorName };
            const id = escapeHtml(item.memberId || memberIdOf(found));
            return `<div class="talk-pill-row aitalk-presence" data-actor="${id}" data-member-id="${id}"><span class="aitalk-presence-label" data-member-id="${id}">${escapeHtml(displayName(found))} ${match[2]}</span></div>`;
        }
    }
    const cls = item.kind === 'day' ? 'talk-pill day' : `talk-pill system ${item.kind === 'memory' ? 'memory' : ''}`;
    return `<div class="talk-pill-row"><span class="${cls}">${item.kind === 'memory' ? '🧠 ' : ''}${escapeHtml(item.text)}</span></div>`;
}

// A run = consecutive bubbles from the same author with no pill between them.
export function threadHtml(messages, members = defaultMembers, options = {}) {
    let previous;
    return messages.map(message => {
        if (message.kind === 'day' || message.kind === 'system' || message.kind === 'memory') { previous = undefined; return systemHtml(message, members, options); }
        const first = previous !== message.author;
        previous = message.author;
        const replies = message.replyTo ? messages.filter(m => m.replyTo === message.replyTo) : [];
        const html = bubbleHtml(message, { messages, members, first, avatarFor: options.avatarFor });
        return replies.length && primaryReply(replies, members)?.id === message.id ? html.replace('class="talk-row', 'data-primary="true" class="talk-row') : html;
    }).join('');
}

export function mentionsHtml(members = defaultMembers, { draft = '', activeIndex = 0, avatarFor, autocompleteCandidates } = {}) {
    const candidates = Array.isArray(autocompleteCandidates) && autocompleteCandidates.length ? autocompleteCandidates : mentionCandidates(members, draft);
    const nameCounts = new Map();
    for (const c of candidates) {
        const key = String(c.name || displayName(c) || '').toLowerCase();
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    const items = candidates.map((m, i) => {
        const id = escapeHtml(memberIdOf(m));
        const name = escapeHtml(m.name || displayName(m));
        const roster = resolveRosterMember(m, members);
        const role = escapeHtml(m.role || roster?.role || m.kind || 'online');
        const isDup = (nameCounts.get(String(m.name || displayName(m) || '').toLowerCase()) || 0) > 1;
        const face = avatarBadgeHtml(m, { sizeClass: 'aitalk-ac-face', avatarFor, emptyAlt: true });
        return `<button type="button" role="option" class="talk-mention-option aitalk-ac-item${i === activeIndex ? ' active' : ''}" data-member-id="${id}" data-mention="${name}" data-role="${role}" data-disambiguated="${isDup ? 'true' : 'false'}" aria-selected="${i === activeIndex ? 'true' : 'false'}"><span class="talk-avatar small ${whoClass(m.id, members)}" data-member-id="${id}" aria-hidden="true">${face}</span><span class="talk-mention-name"><b class="aitalk-ac-name">${name}</b><small class="aitalk-ac-role">${role}</small></span></button>`;
    }).join('');
    return `<div class="talk-mentions aitalk-ac" role="listbox" aria-label="Mention a participant">${items}</div>`;
}

export const mentioning = draft => /(?:^|\s)@[^\s@]*$/.test(draft);

// Who answers for the user, driven by availability only; Here needs no label because the user is in charge.
export const inChargeLabels = { here: '', away: 'You answer from your phone', awayValidator: 'Validator in charge', offline: 'Nobody answers; questions wait for you' };

// Registered actors' names on top: user first, then Priya, then present members, comma-separated, no images.
export function titleHtml({ name = 'AITalk', members = defaultMembers, typing = '', presence }) {
    typing = typing.replace(/^(.+?)(\s+(?:is|are)\s+typing.*)$/i, (_, names, suffix) => names.split(',').map(value => displayName(participant(members, value.trim()) || { id: value.trim() })).join(', ') + suffix);
    const present = members.filter(member => member.presence !== 'left' && member.present !== false).slice().sort((a, b) => {
        const aUser = a.kind === 'user' || memberIdOf(a) === 'machs';
        const bUser = b.kind === 'user' || memberIdOf(b) === 'machs';
        if (aUser !== bUser) return aUser ? -1 : 1;
        const aPinned = Boolean(a.pinnedFirst || a.kind === 'validator' || memberIdOf(a) === 'priya');
        const bPinned = Boolean(b.pinnedFirst || b.kind === 'validator' || memberIdOf(b) === 'priya');
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return 0;
    });
    const rosterInner = present.map(m => {
        const id = escapeHtml(memberIdOf(m));
        return `<span class="aitalk-roster-member" data-member-id="${id}"><span class="aitalk-roster-name" data-member-id="${id}">${escapeHtml(displayName(m).trim())}</span></span>`;
    }).join(', ');
    const typingSuffix = typing ? ` <span class="talk-typing-line talk-typing-inline">${escapeHtml(typing)}</span>` : '';
    const subtitle = `<span class="aitalk-roster" title="In this room">${rosterInner}</span>${typingSuffix}`;
    const validator = members.find(m => m.kind === 'validator');
    const label = presence?.mode === 'awayValidator' && validator ? `${displayName(validator)} in charge` : inChargeLabels[presence?.mode || 'here'] || '';
    return `<div class="talk-title"><h2>${escapeHtml(name)}</h2><div class="talk-subtitle">${subtitle}</div></div>${label ? `<span class="talk-in-charge">${escapeHtml(label)}</span>` : ''}`;
}

export function headerPresenceHtml({ members = defaultMembers, presence }) {
    const user = members.find(member => member.kind === 'user') || { id: '' };
    return presenceHtml({ mode: 'here', reset: 'never', open: false, focusIndex: 0, expiresAt: null, name: displayName(user), fixturePath: user.fixturePath || '', fallbackAvatar: user.fallbackAvatar || '', ...presence, embedded: true });
}

// Regions are patched independently, so a snapshot update never re-mounts an open menu, focus or scroll.
const region = (key, html) => `<div class="talk-region" data-talk-region="${key}">${html}</div>`;
const headerShell = (title, presence) => `<header class="talk-header"><span class="talk-group-avatar" aria-hidden="true">✦</span>${region('title', title)}<button type="button" class="talk-clear" data-clear-chat aria-label="Clear chat" title="Clear chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10 3h3v1h-1v9l-1 1H5l-1-1V4H3V3h3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1zM7 2v1h2V2zM5 4v9h6V4zm1 2h1v5H6zm3 0h1v5H9z"/></svg></button>${region('presence', presence)}</header>`;
export const headerHtml = options => headerShell(titleHtml(options), headerPresenceHtml(options));

export function composerHtml({ draft = '', reply, members = defaultMembers, popover = false, emoji = false, attachments = [], activeMentionIndex = 0, avatarFor, autocompleteCandidates } = {}) {
    const replyBar = reply ? `<div class="talk-reply-bar">${quoteHtml(reply, members)}<button type="button" data-cancel-reply aria-label="Cancel reply">✕</button></div>` : '';
    return `<div class="talk-composer">${emoji ? `<div class="talk-emoji-picker">${['👍','🙏','😊','😉','✅'].map(value => `<button type="button" data-insert-emoji="${value}">${value}</button>`).join('')}</div>` : ''}${attachments.map(file => `<span class="talk-attachment">${escapeHtml(file.name)}</span>`).join('')}${popover ? mentionsHtml(members, { draft, activeIndex: activeMentionIndex, avatarFor, autocompleteCandidates }) : ''}${replyBar}<div class="talk-composer-row"><div class="talk-input-wrap"><button type="button" class="talk-icon" data-emoji aria-label="Emoji">😊</button><textarea rows="1" aria-label="Message" placeholder="Message">${escapeHtml(draft)}</textarea><button type="button" class="talk-icon" data-attach aria-label="Attach">📎</button></div><button type="button" class="talk-send" data-send aria-label="Send">➤</button></div></div>`;
}

export function traceHtml(sessions, traceRowsHtml) {
    return `<section class="talk-trace" aria-label="Trace"><h2>Trace</h2><p class="talk-muted">Participant sessions</p>${sessions.map(session => `<details class="talk-trace-session" open><summary><strong>${escapeHtml(session.label)}</strong><span>${escapeHtml(session.time)} · ${escapeHtml(session.status)}</span></summary><div class="talk-trace-scroll"><table class="obs-timeline-table">${traceRowsHtml(session.events, { now: 1791716400000 })}</table></div></details>`).join('')}</section>`;
}

// The widget's data → HTML, one string per independently patched region.
export function talkParts(messages, options = {}) {
    const { members = defaultMembers, typing = '', unread = 0, draft = '', reply, popover = mentioning(draft), avatarFor, autocompleteCandidates } = options;
    const empty = '<div class="talk-empty"><span class="talk-empty-icon">✦</span><h3>No messages yet</h3><p>Say hi, or use @ to talk to a participant.</p></div>';
    const namedTyping = typing.replace(/^(.+?)(\s+(?:is|are)\s+typing.*)$/i, (_, names, suffix) => names.split(',').map(value => displayName(participant(members, value.trim()) || { id: value.trim() })).join(', ') + suffix);
    const typingActorName = namedTyping ? namedTyping.replace(/\s+(?:is|are)\s+typing.*$/i, '').split(',')[0].trim() : '';
    const typingMember = typingActorName ? (participant(members, typingActorName) || { id: typingActorName, displayName: typingActorName }) : undefined;
    const typingId = typingMember ? escapeHtml(memberIdOf(typingMember)) : '';
    const typingFace = typingMember ? avatarBadgeHtml(typingMember, { sizeClass: 'aitalk-bubble-face', avatarFor, emptyAlt: true }) : '';
    const typingRow = typing ? `<div class="talk-row in first"><span class="talk-avatar ${whoClass(typingMember?.id || typingActorName, members)} aitalk-avatar" data-member-id="${typingId}" aria-hidden="true">${typingFace}</span><div class="talk-bubble tail talk-typing" aria-label="${escapeHtml(namedTyping)}"><i></i><i></i><i></i></div></div>` : '';
    return {
        title: titleHtml({ ...options, members, typing }),
        presence: headerPresenceHtml({ ...options, members }),
        thread: `${messages.length ? threadHtml(messages, members, { avatarFor }) : empty}${typingRow}<div id="talk-bottom"></div>`,
        unread: unread ? `<button type="button" class="talk-unread" data-bottom>${unread} new messages ↓</button>` : '',
        composer: composerHtml({ ...options, draft, reply, members, popover, avatarFor, autocompleteCandidates }),
    };
}

export function talkHtml(messages, options = {}) {
    const { theme = 'dark', members = defaultMembers, moderator = owner(members) ? displayName(owner(members)) : '' } = options;
    const parts = talkParts(messages, { ...options, members });
    const tabs = ['AITalk', 'Specs', 'Trace', 'Team', 'Settings'].map((tab, i) => `<button type="button" data-tab="${i === 0 ? 'Talk' : tab}" aria-pressed="${i === 0}">${tab}</button>`).join('');
    const header = headerShell(parts.title, parts.presence);
    return `<div class="talk-prototype theme-${theme} moderator-${escapeHtml(moderator.toLowerCase())}">${options.embedded ? '' : `<nav class="talk-tabs" aria-label="Panel tabs">${tabs}</nav>`}<div class="talk-panel" data-panel="Talk">${header}<div class="talk-thread" role="log" aria-label="Group chat" data-talk-region="thread">${parts.thread}</div>${region('unread', parts.unread)}${region('composer', parts.composer)}</div><div data-panel="Trace" hidden>${options.trace || ''}</div></div>`;
}
