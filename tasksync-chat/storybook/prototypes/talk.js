// AITalk prototype renderer: pure functions, messages array -> HTML string.
// Production can adopt these as-is; nothing here touches the DOM.

export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const defaultMembers = [
    { name: 'You', presence: 'online' },
    { name: 'Agent', presence: 'online' },
    { name: 'Validator', presence: 'online' },
    { name: 'build-1', presence: 'online' },
];

const memberRole = { You: 'Owner', Agent: 'Main agent', Validator: 'Sees everything', 'build-1': 'Worker' };
const initialsOf = name => (name.match(/[A-Za-z0-9]+/g) || ['?']).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Stable colour class per participant: named roles first, everyone else hashed.
export function whoClass(name) {
    const fixed = { you: 'who-you', agent: 'who-agent', validator: 'who-validator' };
    const key = String(name).toLowerCase();
    if (fixed[key]) return fixed[key];
    if (/^build-|^worker-/.test(key)) return 'who-worker';
    let hash = 0;
    for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) % 4;
    return `who-p${hash}`;
}

const mentionRegex = members => new RegExp(`@(${members.map(m => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'gi');
export const textHtml = (text, members = defaultMembers) => escapeHtml(text).replace(mentionRegex(members), '<b class="talk-mention">@$1</b>');

const CHECK_A = 'M0.8 5.9 4.1 9.2 10.6 1.5';
const CHECK_B = 'M4.4 5.9 7.7 9.2 14.2 1.5';
// WhatsApp-style ticks: one check = posted (grey), two overlapping checks = delivered (blue).
export function tickSvg(delivered) {
    return `<svg class="talk-tick-svg" viewBox="0 0 16 11" width="16" height="11" aria-hidden="true" focusable="false"><path d="${CHECK_A}"/>${delivered ? `<path d="${CHECK_B}"/>` : ''}</svg>`;
}

export function ticksHtml(message) {
    if (!message.delivery) return '';
    const delivered = message.delivery === 'delivered';
    const title = delivered ? `Delivered to Agent with its tool call · ${message.tool || 'tool call'}` : 'Posted · waiting for a tool response';
    return `<span class="talk-ticks ${delivered ? 'delivered' : 'posted'}" role="img" aria-label="${delivered ? 'Delivered' : 'Posted'}" title="${escapeHtml(title)}">${tickSvg(delivered)}</span>`;
}

export function quoteHtml(quote, members) {
    return `<div class="talk-quote ${whoClass(quote.author)}"><b class="talk-quote-who">${escapeHtml(quote.author)}</b><span class="talk-quote-text">${textHtml(quote.text, members)}</span></div>`;
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
    if (author === 'Validator') return emoji === '👎' ? 'Marks this for Validator learning' : 'Validator sees every reaction';
    return `Delivered to ${author} with its next tool call`;
}

export function reactBarHtml(message) {
    const button = (emoji, extra = '') => `<button type="button" role="menuitem" tabindex="-1" class="talk-react-btn ${extra}" data-react="${emoji}" data-msg="${escapeHtml(message.id || '')}" aria-label="React ${emoji}" title="${emoji} · ${escapeHtml(reactionNote(message.author, emoji))}">${emoji}</button>`;
    return `<div class="talk-react-bar" role="menu" aria-label="React to ${escapeHtml(message.author)}">${reactionChoices.map(e => button(e)).join('')}<button type="button" role="menuitem" tabindex="-1" class="talk-react-btn more" data-react-more aria-label="More reactions" title="More reactions">+</button><span class="talk-react-extra" hidden>${moreReactions.map(e => button(e)).join('')}</span></div>`;
}

export function reactionsHtml(message) {
    const list = normalizeReactions(message.reactions);
    if (!list.length) return '';
    const pills = list.map(r => {
        const delivered = r.delivery === 'delivered';
        const by = (r.by || []).join(', ');
        const tip = r.mine
            ? (message.author === 'Validator' ? reactionNote('Validator', r.emoji) : `${reactionNote(message.author, r.emoji)} · ${delivered ? `double check, delivered · ${r.tool || 'tool call'}` : 'single check, posted'}`)
            : (by ? `${by} reacted` : `${r.count} reacted`);
        const ticks = r.mine && message.author !== 'Validator' ? `<span class="talk-ticks ${delivered ? 'delivered' : 'posted'}">${tickSvg(delivered)}</span>` : '';
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
    if (message.details) return { short: text, full: text, details: message.details, collapsible: true };
    if (text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES) return { short: summaryOf(text), full: text, details: '', collapsible: true };
    return { short: text, full: text, details: '', collapsible: false };
}

// Details support short "- item" lists and `code`; everything else is plain paragraphs.
export function detailsHtml(details, members = defaultMembers) {
    const out = [];
    let list = [];
    const flush = () => { if (list.length) { out.push(`<ul>${list.map(i => `<li>${i}</li>`).join('')}</ul>`); list = []; } };
    const inline = line => textHtml(line, members).replace(/`([^`]+)`/g, '<code>$1</code>');
    for (const line of details.split('\n')) {
        if (/^\s*[-•] /.test(line)) list.push(inline(line.replace(/^\s*[-•] /, '')));
        else { flush(); if (line.trim()) out.push(`<p>${inline(line)}</p>`); }
    }
    flush();
    return out.join('');
}

export function bodyHtml(message, members = defaultMembers) {
    if (!message.text && !message.details) return '';
    const { short, full, details, collapsible } = splitBody(message);
    const id = escapeHtml(message.id || '');
    const open = !!message.expanded;
    const text = `<span class="talk-text">${textHtml(open && !details ? full : short, members)}</span>`;
    if (!collapsible) return text;
    const body = open && details ? `<div class="talk-details" id="talk-details-${id}">${detailsHtml(details, members)}</div>` : '';
    return `${text}${body}<button type="button" class="talk-more" data-more="${id}" aria-expanded="${open}"${open && details ? ` aria-controls="talk-details-${id}"` : ''}>${open ? 'Show less' : 'Read more'}</button>`;
}

export function bubbleHtml(message, { messages = [], members = defaultMembers, first = true } = {}) {
    const mine = message.author === 'You';
    const parent = message.replyTo && messages.find(m => m.id === message.replyTo);
    const quote = message.quote || (parent && { author: parent.author, text: parent.text });
    const reactions = reactionsHtml(message);
    const name = !mine && first ? `<span class="talk-sender ${whoClass(message.author)}">${escapeHtml(message.author)}</span>` : '';
    const avatar = mine ? '' : first ? `<span class="talk-avatar ${whoClass(message.author)}" aria-hidden="true">${escapeHtml(initialsOf(message.author))}</span>` : '<span class="talk-avatar-gap" aria-hidden="true"></span>';
    const trace = message.trace ? `<a class="talk-trace-link" href="#trace" data-tab="Trace">View trace ↗</a>` : '';
    return `<div class="talk-row ${mine ? 'out' : 'in'} ${first ? 'first' : 'follow'}" id="talk-${escapeHtml(message.id || '')}">${avatar}<div class="talk-bubble ${first ? 'tail' : ''} ${normalizeReactions(message.reactions).length ? 'has-reaction' : ''}"${mine ? '' : ` tabindex="0" data-msg="${escapeHtml(message.id || '')}" aria-label="${escapeHtml(message.author)}: message. Right-click, long-press or press Enter to react."`}>${mine ? '' : reactBarHtml(message)}${name}${quote ? quoteHtml(quote, members) : ''}${bodyHtml(message, members)}${trace}<span class="talk-meta"><time>${escapeHtml(message.time || '')}</time>${ticksHtml(message)}</span>${reactions}</div></div>`;
}

export function systemHtml(item) {
    const cls = item.kind === 'day' ? 'talk-pill day' : `talk-pill system ${item.kind === 'memory' ? 'memory' : ''}`;
    return `<div class="talk-pill-row"><span class="${cls}">${item.kind === 'memory' ? '🧠 ' : ''}${escapeHtml(item.text)}</span></div>`;
}

// A run = consecutive bubbles from the same author with no pill between them.
export function threadHtml(messages, members = defaultMembers) {
    let previous;
    return messages.map(message => {
        if (message.kind === 'day' || message.kind === 'system' || message.kind === 'memory') { previous = undefined; return systemHtml(message); }
        const first = previous !== message.author;
        previous = message.author;
        return bubbleHtml(message, { messages, members, first });
    }).join('');
}

export function mentionsHtml(members = defaultMembers) {
    return `<div class="talk-mentions" role="listbox" aria-label="Mention a participant">${members.filter(m => m.name !== 'You').map(m => `<button type="button" role="option" class="${m.presence === 'left' ? 'left' : ''}" data-mention="${escapeHtml(m.name)}"><span class="talk-avatar small ${whoClass(m.name)}" aria-hidden="true">${escapeHtml(initialsOf(m.name))}</span><span class="talk-mention-name"><b>${escapeHtml(m.name)}</b><small>${m.presence === 'left' ? 'left · mention to bring back' : escapeHtml(memberRole[m.name] || 'online')}</small></span><i class="talk-presence ${m.presence}" aria-hidden="true"></i></button>`).join('')}</div>`;
}

export function headerHtml({ name = 'AITalk', members = defaultMembers, typing = '', moderator = 'You' }) {
    const subtitle = typing
        ? `<span class="talk-typing-line">${escapeHtml(typing)}</span>`
        : members.map(m => `<span class="${m.presence === 'left' ? 'left' : ''}">${escapeHtml(m.name)}</span>`).join(', ');
    return `<header class="talk-header"><span class="talk-group-avatar" aria-hidden="true">✦</span><div class="talk-title"><h2>${escapeHtml(name)}</h2><div class="talk-subtitle">${subtitle}</div></div><span class="talk-moderator" title="${moderator === 'Validator' ? 'Validator is your proxy' : 'You moderate'}">${moderator === 'Validator' ? 'Validator proxy' : 'You moderate'}</span></header>`;
}

export function composerHtml({ draft = '', reply, members = defaultMembers, popover = false } = {}) {
    const replyBar = reply ? `<div class="talk-reply-bar">${quoteHtml(reply, members)}<button type="button" data-cancel-reply aria-label="Cancel reply">✕</button></div>` : '';
    return `<div class="talk-composer">${popover ? mentionsHtml(members) : ''}${replyBar}<div class="talk-composer-row"><div class="talk-input-wrap"><button type="button" class="talk-icon" aria-label="Emoji">😊</button><textarea rows="1" aria-label="Message" placeholder="Message">${escapeHtml(draft)}</textarea><button type="button" class="talk-icon" aria-label="Attach">📎</button></div><button type="button" class="talk-send" data-send aria-label="Send">➤</button></div></div>`;
}

export function traceHtml(sessions, traceRowsHtml) {
    return `<section class="talk-trace" aria-label="Trace"><h2>Trace</h2><p class="talk-muted">Main turns · workers · validator sessions</p>${sessions.map(session => `<details class="talk-trace-session" open><summary><strong>${escapeHtml(session.label)}</strong><span>${escapeHtml(session.time)} · ${escapeHtml(session.status)}</span></summary><div class="talk-trace-scroll"><table class="obs-timeline-table">${traceRowsHtml(session.events, { now: 1791716400000 })}</table></div></details>`).join('')}</section>`;
}

export function talkHtml(messages, options = {}) {
    const { moderator = 'You', theme = 'dark', members = defaultMembers, typing = '', unread = 0, draft = '', reply, popover = draft.endsWith('@') } = options;
    const empty = '<div class="talk-empty"><span class="talk-empty-icon">✦</span><h3>No messages yet</h3><p>Say hi, or use @ to talk to Agent or Validator.</p></div>';
    const tabs = ['AITalk', 'Specs', 'Trace', 'Workers', 'Settings'].map((tab, i) => `<button type="button" data-tab="${i === 0 ? 'Talk' : tab}" aria-pressed="${i === 0}">${tab}</button>`).join('');
    const typingRow = typing ? `<div class="talk-row in first"><span class="talk-avatar ${whoClass(typing.split(' ')[0])}" aria-hidden="true">${escapeHtml(initialsOf(typing.split(' ')[0]))}</span><div class="talk-bubble tail talk-typing" aria-label="${escapeHtml(typing)}"><i></i><i></i><i></i></div></div>` : '';
    return `<div class="talk-prototype theme-${theme} moderator-${moderator.toLowerCase()}"><nav class="talk-tabs" aria-label="Panel tabs">${tabs}</nav><div class="talk-panel" data-panel="Talk">${headerHtml({ ...options, members, typing, moderator })}<div class="talk-thread" role="log" aria-label="Group chat">${messages.length ? threadHtml(messages, members) : empty}${typingRow}<div id="talk-bottom"></div></div>${unread ? `<button type="button" class="talk-unread" data-bottom>${unread} new messages ↓</button>` : ''}${composerHtml({ draft, reply, members, popover })}</div><div data-panel="Trace" hidden>${options.trace || ''}</div></div>`;
}

export const traceSessions = ['Main turn · sidebar layout', 'Worker run · build-1', 'Validator session · gate'].map((label, i) => ({ label, time: `10:${40 + i}`, status: 'finished', events: [{ kind: 'request', id: String(i + 1), model: i === 2 ? 'Validator' : i === 1 ? 'build-1' : 'Agent', inputTokens: 1200, outputTokens: 160, cachedTokens: 1000, nanoAiu: 200000000 }] }));

// ---- Scenario data -------------------------------------------------------

const earlier = [
    { kind: 'day', text: 'Yesterday' },
    { id: 'e1', author: 'You', text: 'morning. can we start on the sidebar?', time: '09:02', delivery: 'delivered', tool: 'commentary' },
    { id: 'e2', author: 'Agent', text: 'Morning. Reading the current layout first.', time: '09:03' },
    { id: 'e3', author: 'Agent', text: 'Tab strip is in webview.js, the chat tab is separate.', time: '09:05', trace: true },
    { id: 'e4', author: 'Validator', text: 'Remove the chat tab, commentary becomes the first one.', time: '09:06' },
    { id: 'e5', author: 'You', text: 'yes, do that', time: '09:07', delivery: 'delivered', tool: 'read_file' },
    { id: 'e6', author: 'Agent', text: 'Done. Tabs are AITalk, Specs, Trace, Workers, Settings.', time: '09:20', reactions: [{ emoji: '👍', count: 1, mine: true, delivery: 'delivered', tool: 'read_file' }, { emoji: '🙏', count: 1 }] },
    { id: 'e7', author: 'You', text: 'good, thanks', time: '09:21', delivery: 'delivered', tool: 'commentary' },
    { id: 'e8', author: 'Agent', text: 'Tests pass. Stopping here for today.', time: '09:40' },
    { id: 'e9', author: 'Agent', text: 'Metrics tab renamed to Trace.', time: '09:41', trace: true },
    { id: 'e10', author: 'Validator', text: 'RTK and Gradle numbers are gone from it too.', time: '09:42' },
    { id: 'e11', author: 'You', text: 'perfect', time: '09:43', delivery: 'delivered', tool: 'read_file' },
    { id: 'e12', author: 'You', text: 'see you tomorrow', time: '09:43', delivery: 'delivered', tool: 'read_file' },
];

const today = [
    { kind: 'day', text: 'Today' },
    { id: 'a1', author: 'Agent', text: 'Starting on the chat layout.', time: '10:31' },
    { id: 'a2', author: 'Agent', text: 'Found the old tab strip. Replacing it now.', time: '10:32', trace: true },
    { id: 'y1', author: 'You', text: '@Agent keep it narrow, 420px', time: '10:33', delivery: 'delivered', tool: 'commentary' },
    { kind: 'system', text: 'build-1 joined' },
    { id: 'w1', author: 'build-1', text: '@Validator should the reply preview stay on one line?', time: '10:35' },
    { id: 'v1', author: 'Validator', text: 'Yes. Open the full quote on click.', replyTo: 'w1', time: '10:35', reactions: [{ emoji: '👍', count: 2 }, { emoji: '👎', count: 1, mine: true }] },
    { kind: 'system', text: 'build-1 left' },
    { id: 'a4', author: 'Agent', text: 'Keep the name AITalk?', time: '10:38' },
    { id: 'v2', author: 'Validator', replyTo: 'a4', text: 'Proposed: yes, AITalk for beta.', proposal: 'Yes, AITalk for beta.', time: '10:38', reactions: [{ emoji: '👍', count: 1, mine: true, delivery: 'delivered', tool: 'read_file' }] },
    { id: 'a5', author: 'Agent', text: 'Hide old progress lines?', time: '10:39' },
    { id: 'v3', author: 'Validator', replyTo: 'a5', text: 'Proposed: remove them after the run.', proposal: 'Remove them after the run.', time: '10:39', reactions: [{ emoji: '👎', count: 1, mine: true }] },
    { id: 'y2', author: 'You', quote: { author: 'Agent', text: 'Keep the name AITalk?' }, text: 'Yes, AITalk for beta.', time: '10:39', delivery: 'delivered', tool: 'read_file' },
    { id: 'y3', author: 'You', quote: { author: 'Agent', text: 'Hide old progress lines?' }, text: 'No, keep them collapsed, not deleted.', time: '10:40', delivery: 'posted' },
    { id: 'y4', author: 'You', text: 'ok', time: '10:42', delivery: 'delivered', tool: 'read_file', reactions: [{ emoji: '👍', count: 1, by: ['Agent'] }] },
    { id: 'y5', author: 'You', text: 'thanks both', time: '10:43', delivery: 'posted', reactions: [{ emoji: '🙏', count: 1, by: ['Validator'] }] },
    { id: 'a3', author: 'Agent', text: 'Kept them collapsed. 12 checks passed.', time: '10:44', trace: true, reactions: [{ emoji: '👍', count: 1, mine: true, delivery: 'posted' }] },
    { id: 'a6', author: 'Agent', text: 'Ship the score fix now or after the gate?', time: '10:46', details: 'Two ways to go:\n- A) Now: users get the fix today, but the gate has not seen it.\n- B) After the gate: about 20 minutes later, and it ships with a green run.\nI would pick `B` unless the score bug is blocking someone.' },
    { id: 'v4', author: 'Validator', replyTo: 'a6', text: 'After the gate. The last two score changes both broke the Trace tab on first run, and the gate catches exactly that. Twenty minutes is cheap next to a rollback, and nobody is blocked on the score today, so there is no reason to skip the check. If the gate fails, fix forward and rerun it before shipping anything.', time: '10:47' },
    { kind: 'system', text: 'Agent left — joins again when you message it' },
];

export const fullConversation = [...earlier, ...today];

export const liveStart = [
    { kind: 'day', text: 'Today' },
    { id: 'l1', author: 'You', text: '@Agent can you check the composer spacing?', time: '10:50', delivery: 'posted' },
];

// `after` = ms to wait before the step (default 1700). The first step turns l1 from one grey check to two blue ones after 1.5s.
export const liveScript = [
    { do: 'deliver', id: 'l1', tool: 'read_file', after: 1500 },
    { do: 'typing', who: 'Agent is typing…' },
    { do: 'add', message: { id: 'l2', author: 'Agent', text: 'On it.', time: '10:50' } },
    { do: 'add', message: { kind: 'system', text: 'build-1 joined' } },
    { do: 'add', message: { id: 'l3', author: 'build-1', text: '@Validator is 8px padding enough?', time: '10:51' } },
    { do: 'typing', who: 'Validator is typing…' },
    { do: 'add', message: { id: 'l4', author: 'Validator', text: 'Yes, 8px is fine.', replyTo: 'l3', time: '10:51' } },
    { do: 'add', message: { kind: 'system', text: 'build-1 left' } },
    { do: 'add', message: { id: 'l6', author: 'You', text: 'go ahead', time: '10:52', delivery: 'posted' } },
    { do: 'react', id: 'l6', emoji: '👍', by: 'Agent', after: 1200 },
    { do: 'deliver', id: 'l6', tool: 'read_file', after: 1500 },
    { do: 'typing', who: 'Agent is typing…' },
    { do: 'add', message: { id: 'l5', author: 'Agent', text: 'Spacing is fixed. 12 checks passed.', time: '10:53', trace: true } },
    { do: 'add', message: { id: 'l8', author: 'Agent', text: 'Ship the score fix now or after the gate?', time: '10:54', details: 'Two ways to go:\n- A) Now: users get the fix today, but the gate has not seen it.\n- B) After the gate: about 20 minutes later, and it ships with a green run.' } },
    { do: 'typing', who: 'Validator is typing…' },
    { do: 'add', message: { id: 'l9', author: 'Validator', replyTo: 'l8', text: 'After the gate. The last two score changes both broke the Trace tab on first run, and the gate catches exactly that. Twenty minutes is cheap next to a rollback, and nobody is blocked on the score today. If the gate fails, fix forward and rerun it before shipping.', time: '10:54' } },
    { do: 'add', message: { id: 'l7', author: 'You', text: 'thanks', time: '10:55', delivery: 'posted' } },
    { do: 'react', id: 'l7', emoji: '🙏', by: 'Validator', after: 1200 },
    { do: 'deliver', id: 'l7', tool: 'commentary', after: 1500 },
];

export const awayMembers = defaultMembers.map(m => m.name === 'Agent' || m.name === 'build-1' ? { ...m, presence: 'left' } : m);

export const awayMessages = [
    { kind: 'day', text: 'Today' },
    { kind: 'system', text: 'Agent left — joins again when you message it' },
    { id: 'q1', author: 'You', text: '@Validator quick quiz: what happens when a gate fails?', time: '18:02', delivery: 'posted' },
    { id: 'q2', author: 'Validator', text: 'Who sees a failed gate first? The Agent, it retries once.', time: '18:02' },
    { id: 'q2b', author: 'Validator', text: 'When does it stop? After two failures it asks you.', time: '18:02' },
    { id: 'q3', author: 'You', quote: { author: 'Validator', text: 'Who sees a failed gate first?' }, text: 'Wrong. You see it first, then the Agent.', time: '18:04', delivery: 'posted' },
    { id: 'q4', author: 'Validator', text: 'Got it, I had that backwards.', replyTo: 'q3', time: '18:04' },
    { kind: 'memory', text: 'Validator memory updated: failed gates go to you first' },
];

export const scenarios = {
    Full: { messages: fullConversation, unread: 3 },
    Away: { messages: awayMessages, members: awayMembers, draft: '@' },
    Light: { messages: today, theme: 'light' },
    Proxy: { messages: today, moderator: 'Validator' },
    Empty: { messages: [] },
};
