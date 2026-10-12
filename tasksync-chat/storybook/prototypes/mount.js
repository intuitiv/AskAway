import webviewSrc from '../../media/webview.js?raw';
import providerSrc from '../../src/webview/webviewProvider.ts?raw';
import cssText from '../../media/main.css?raw';
import prototypeCss from '../../media/aitalk/talk.css?raw';
import { buildTraceKit, VSCODE_DARK_THEME } from '../kit.js';
import { talkHtml, traceHtml, traceSessions, defaultMembers } from './talk.js';
import { displayName, owner, postMessage, presenceChange, reactionRoute, reactMessage, selectReply, replyMessage, deliveryEvent, nextToolCall } from './talkRules.js';
const { traceRowsHtml } = buildTraceKit({ webviewSrc });

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clock = () => new Date().toTimeString().slice(0, 5);

export function mountTalk(options = {}) {
    const root = document.createElement('div');
    let messages = [...(options.messages || [])];
    let members = options.members || defaultMembers;
    let typing = options.typing || '';
    let draft = options.draft || '';
    let reply;
    let sent = 0;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    const thread = () => root.querySelector('.talk-thread');
    const scrollToBottom = () => { const t = thread(); if (t) t.scrollTo({ top: t.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' }); };

    const paint = ({ stick = false } = {}) => {
        const before = thread();
        const previousTop = before?.scrollTop;
        const wasAtBottom = before ? before.scrollHeight - before.scrollTop - before.clientHeight < 40 : true;
        const tab = root.querySelector('.talk-tabs [aria-pressed="true"]')?.dataset.tab;
        const lightTheme = '.talk-prototype { --vscode-editor-background: white; --vscode-editorWidget-background: whitesmoke; --vscode-sideBar-background: whitesmoke; --vscode-foreground: black; --vscode-descriptionForeground: dimgray; --vscode-input-background: white; --vscode-panel-border: silver; --vscode-button-background: teal; --vscode-button-foreground: white; --vscode-textLink-foreground: blue; --vscode-widget-shadow: transparent; }';
        root.innerHTML = `<style>${cssText}\n${options.theme === 'light' ? lightTheme : VSCODE_DARK_THEME}\n${prototypeCss}</style>${talkHtml(messages, { ...options, members, typing, draft, reply, popover: draft.endsWith('@'), trace: traceHtml(traceSessions, traceRowsHtml) })}`;
        const next = thread();
        if (!next) return;
        if (openId) root.querySelector(`.talk-bubble[data-msg="${CSS.escape(openId)}"]`)?.classList.add('reacting');
        if (previousTop === undefined) next.scrollTop = options.unread ? Math.max(0, next.scrollHeight - next.clientHeight - 260) : next.scrollHeight;
        else if (stick || wasAtBottom) next.scrollTop = next.scrollHeight;
        else next.scrollTop = previousTop;
        if (options.traceOnly) openTab('Trace');
        else if (tab && tab !== 'Talk') openTab(tab);
    };

    function openTab(tab) {
        if (!['Talk', 'Trace'].includes(tab)) return;
        root.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
        root.querySelectorAll('.talk-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
    }

    const post = (message, delivered) => {
        const id = `sent-${sent++}`;
        const posted = postMessage({ author: displayName(owner(members)), time: clock(), ...message, id }, messages, members);
        messages = posted.messages; members = posted.registry;
        paint({ stick: true });
        later(() => { messages = messages.map(m => m.id === id ? deliveryEvent(m, 'delivered', options.deliveryEvents) : m); paint(); }, delivered ?? 1600);
        later(() => { for (const recipient of messages.find(m => m.id === id)?.recipients || []) messages = nextToolCall(messages, recipient, options.deliveryEvents).messages; paint(); }, (delivered ?? 1600) + 800);
    };

    // Toggle your reaction; a count shows when several people reacted.
    const react = (message, emoji) => {
        const list = (message.reactions || []).map(r => typeof r === 'string' ? { emoji: r.split(' ')[0], count: Number(r.split(' ')[1]) || 1 } : { ...r });
        const found = list.find(r => r.emoji === emoji);
        if (found?.mine) {
            found.count -= 1; found.mine = false; delete found.delivery; delete found.tool;
            if (found.count <= 0) list.splice(list.indexOf(found), 1);
        } else if (found) { found.count += 1; found.mine = true; found.delivery = 'posted'; }
        else list.push({ emoji, count: 1, mine: true, delivery: 'posted' });
        message.reactions = list;
        openId = null;
        paint();
        focusBubble(message.id);
        const added = list.find(r => r.emoji === emoji)?.mine;
        if (added) {
            const route = reactionRoute(message, emoji, owner(members).id, messages, members);
            const reaction = list.find(r => r.emoji === emoji);
            Object.assign(reaction, route);
            const relayed = reactMessage(message, emoji, owner(members).id, messages, members, `reaction-${sent++}`);
            messages = relayed.messages; members = relayed.registry;
            paint();
        }
        later(() => {
            const route = reactionRoute(message, emoji, owner(members).id, messages, members);
            if (route.recipient) messages = nextToolCall(messages, route.recipient, options.deliveryEvents).messages;
            message.reactions = message.reactions.map(r => r.mine && r.emoji === emoji ? deliveryEvent(r, 'firstToolCall', options.deliveryEvents) : r); paint();
        }, 1600);
    };
    const focusBubble = id => root.querySelector(`.talk-bubble[data-msg="${CSS.escape(id)}"]`)?.focus();

    // The reaction bar never opens on hover (scrolling used to trigger it). It opens on right-click, long-press or keyboard.
    let openId = null;
    let pressTimer;
    const barButtons = bubble => [...bubble.querySelectorAll('.talk-react-bar [role="menuitem"]')].filter(b => !b.closest('[hidden]'));
    const applyOpen = () => root.querySelectorAll('.talk-bubble.reacting').forEach(b => { if (b.dataset.msg !== openId) b.classList.remove('reacting'); });
    const openBar = (bubble, { focus = false } = {}) => {
        openId = bubble.dataset.msg;
        applyOpen();
        bubble.classList.add('reacting');
        if (focus) barButtons(bubble)[0]?.focus();
    };
    const closeBar = () => { openId = null; applyOpen(); };

    root.addEventListener('contextmenu', event => {
        const bubble = event.target.closest?.('.talk-bubble[data-msg]');
        if (!bubble) return;
        event.preventDefault();
        openBar(bubble);
    });
    root.addEventListener('pointerdown', event => {
        const bubble = event.target.closest?.('.talk-bubble[data-msg]');
        if (!bubble || event.pointerType !== 'touch' || event.target.closest('.talk-react-bar')) return;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => openBar(bubble), 500);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointermove']) root.addEventListener(type, () => clearTimeout(pressTimer));
    root.addEventListener('scroll', () => { clearTimeout(pressTimer); if (openId) closeBar(); }, true);
    root.addEventListener('keydown', event => {
        const bubble = event.target.closest?.('.talk-bubble[data-msg]');
        if (!bubble) return;
        const buttons = barButtons(bubble);
        if (event.target === bubble && (event.key === 'Enter' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) { event.preventDefault(); openBar(bubble, { focus: true }); return; }
        const index = buttons.indexOf(event.target);
        if (index < 0) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); buttons[(index + 1) % buttons.length].focus(); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length].focus(); }
        if (event.key === 'Escape') { event.preventDefault(); closeBar(); bubble.focus(); }
    });
    root.addEventListener('click', event => { if (openId && !event.target.closest('.talk-react-bar')) closeBar(); }, true);

    root.addEventListener('input', event => { if (event.target.matches('.talk-composer textarea')) { draft = event.target.value; const hasPopover = !!root.querySelector('.talk-mentions'); if (draft.endsWith('@') !== hasPopover) { paint(); const area = root.querySelector('.talk-composer textarea'); area.focus(); area.setSelectionRange(draft.length, draft.length); } } });

    root.addEventListener('click', event => {
        const button = event.target.closest('button, a');
        if (!button) return;
        if (button.dataset.tab) { event.preventDefault(); openTab(button.dataset.tab); }
        if (button.hasAttribute('data-bottom')) { scrollToBottom(); button.remove(); }
        if (button.hasAttribute('data-cancel-reply')) { reply = undefined; paint(); }
        if (button.dataset.reply) { reply = selectReply(messages, button.dataset.reply); closeBar(); paint(); root.querySelector('.talk-composer textarea').focus(); }
        if (button.dataset.mention) {
            const name = button.dataset.mention;
            const changed = presenceChange(members, name, true);
            members = changed.registry; messages.push(...changed.notices);
            draft = `${draft.replace(/@$/, '')}@${name} `;
            paint({ stick: true });
            const area = root.querySelector('.talk-composer textarea'); area.focus(); area.setSelectionRange(draft.length, draft.length);
        }
        if (button.dataset.more) {
            const message = messages.find(m => m.id === button.dataset.more);
            if (message) { message.expanded = !message.expanded; paint(); root.querySelector(`.talk-more[data-more="${CSS.escape(message.id)}"]`)?.focus(); }
            return;
        }
        if (button.hasAttribute('data-react-more')) { const extra = button.parentElement.querySelector('.talk-react-extra'); extra.hidden = !extra.hidden; return; }
        if (button.dataset.react) {
            const message = messages.find(m => m.id === button.dataset.msg);
            if (message) react(message, button.dataset.react);
        }
        if (button.hasAttribute('data-send')) {
            const text = root.querySelector('.talk-composer textarea').value.trim();
            if (!text) return;
            const quote = reply;
            reply = undefined; draft = '';
            post(replyMessage(text, displayName(owner(members)), quote));
        }
    });

    paint();

    if (options.live) {
        const script = [...options.live.script];
        let connected = false;
        const run = step => {
            // Stop once the story was shown and then removed from the page.
            if (root.isConnected) connected = true;
            else if (connected) return;
            if (step.do === 'typing') typing = step.who;
            if (step.do === 'add') { typing = ''; messages.push(step.message); }
            if (step.do === 'deliver') messages = messages.map(m => m.id === step.id ? { ...m, delivery: 'delivered', tool: step.tool } : m);
            if (step.do === 'event') messages = messages.map(m => m.id === step.id ? deliveryEvent(m, step.event, options.deliveryEvents) : m);
            if (step.do === 'join' || step.do === 'leave') { const changed = presenceChange(members, step.who, step.do === 'join'); members = changed.registry; messages.push(...changed.notices); }
            if (step.do === 'react') messages = messages.map(m => m.id === step.id ? { ...m, reactions: [...(m.reactions || []), { emoji: step.emoji, count: 1, by: [step.by] }] } : m);
            paint({ stick: true });
            next();
        };
        const next = () => {
            const step = script.shift();
            if (!step) return;
            later(() => run(step), (step.after ?? 1700) * (reducedMotion() ? 1.5 : 1));
        };
        next();
    }
    return root;
}
