import webviewSrc from '../../media/webview.js?raw';
import providerSrc from '../../src/webview/webviewProvider.ts?raw';
import cssText from '../../media/main.css?raw';
import prototypeCss from './talk.css?raw';
import { buildCommentaryKit, VSCODE_DARK_THEME } from '../kit.js';
import { talkHtml, traceHtml, traceSessions, defaultMembers } from './talk.js';
const { traceRowsHtml } = buildCommentaryKit({ webviewSrc, providerSrc });

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
        root.innerHTML = `<style>${cssText}\n${VSCODE_DARK_THEME}\n${prototypeCss}</style>${talkHtml(messages, { ...options, members, typing, draft, reply, popover: draft.endsWith('@'), trace: traceHtml(traceSessions, traceRowsHtml) })}`;
        const next = thread();
        if (!next) return;
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
        const id = `you-${sent++}`;
        messages.push({ id, author: 'You', time: clock(), delivery: 'posted', ...message });
        paint({ stick: true });
        later(() => { messages = messages.map(m => m.id === id ? { ...m, delivery: 'delivered', tool: 'read_file' } : m); paint(); }, delivered ?? 1600);
    };

    root.addEventListener('input', event => { if (event.target.matches('.talk-composer textarea')) { draft = event.target.value; const hasPopover = !!root.querySelector('.talk-mentions'); if (draft.endsWith('@') !== hasPopover) { paint(); const area = root.querySelector('.talk-composer textarea'); area.focus(); area.setSelectionRange(draft.length, draft.length); } } });

    root.addEventListener('click', event => {
        const button = event.target.closest('button, a');
        if (!button) return;
        if (button.dataset.tab) { event.preventDefault(); openTab(button.dataset.tab); }
        if (button.hasAttribute('data-bottom')) { scrollToBottom(); button.remove(); }
        if (button.hasAttribute('data-cancel-reply')) { reply = undefined; paint(); }
        if (button.dataset.mention) {
            const name = button.dataset.mention;
            if (members.find(m => m.name === name)?.presence === 'left') messages.push({ kind: 'system', text: `${name} joined` });
            members = members.map(m => m.name === name ? { ...m, presence: 'online' } : m);
            draft = `${draft.replace(/@$/, '')}@${name} `;
            paint({ stick: true });
            const area = root.querySelector('.talk-composer textarea'); area.focus(); area.setSelectionRange(draft.length, draft.length);
        }
        if (button.dataset.vote) {
            const message = messages.find(m => m.id === button.dataset.msg);
            const q = message?.questions?.[Number(button.dataset.q)];
            if (!q || q.vote === button.dataset.vote) return;
            q.vote = button.dataset.vote;
            if (button.dataset.vote === 'up') {
                post({ quote: { author: 'Agent', text: q.question }, text: q.answer });
            } else {
                // 👎 only marks the item for Validator learning; You answer by quoting.
                reply = { author: 'Agent', text: q.question };
                paint();
                root.querySelector('.talk-composer textarea').focus();
            }
        }
        if (button.hasAttribute('data-send')) {
            const text = root.querySelector('.talk-composer textarea').value.trim();
            if (!text) return;
            const quote = reply;
            reply = undefined; draft = '';
            post({ text, quote });
        }
    });

    paint();

    if (options.live) {
        const script = [...options.live.script];
        const tick = () => {
            if (!root.isConnected && root.dataset.mounted) return stop();
            const step = script.shift();
            if (!step) return stop();
            if (step.do === 'typing') typing = step.who;
            if (step.do === 'add') { typing = ''; messages.push(step.message); }
            if (step.do === 'deliver') messages = messages.map(m => m.id === step.id ? { ...m, delivery: 'delivered', tool: step.tool } : m);
            paint({ stick: true });
        };
        const interval = setInterval(tick, reducedMotion() ? 2600 : 1700);
        const stop = () => { clearInterval(interval); timers.forEach(clearTimeout); };
        later(() => { root.dataset.mounted = '1'; }, 500);
    }
    return root;
}
