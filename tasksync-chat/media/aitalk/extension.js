import { createTalkController } from './talkController.js';
import { unreadCount, tabCountLabel } from './talkRender.js';
document.addEventListener('error', event => {
    const image = event.target;
    if (image?.tagName !== 'IMG' || !image.dataset?.fallbackSrc) return;
    const fallback = image.dataset.fallbackSrc;
    delete image.dataset.fallbackSrc;
    if (image.getAttribute('src') !== fallback) image.setAttribute('src', fallback);
}, true);
const controller = createTalkController({ host: document.getElementById('aitalk-root'), events: document, post: message => {
    if (message.type === 'talkTab' && message.tab === 'Trace') { document.querySelector('.widget-tab[data-tab="observability"]')?.click(); return; }
    if (message.type === 'talkMember' && (message.memberId || message.member)) {
        const targetId = message.memberId || message.member;
        document.querySelector('.widget-tab[data-tab="team"]')?.click();
        if (typeof window.focusTeamMember === 'function') window.focusTeamMember(targetId);
        return;
    }
    window.askawayPostMessage(message);
} });
export function renderAITalk(state) { controller.render(state); }
// Unread count in the tab title, e.g. AITalk(3): messages that arrived while another tab was active or the view was hidden.
const seen = new Set();
let seeded = false;
function trackUnread(event) {
    if (event.data?.type !== 'aitalkState') return;
    const state = event.data.data || {};
    const messages = state.messages || [];
    const members = state.members && state.members.length ? state.members : undefined;
    const label = document.getElementById('tab-count-aitalk');
    const visible = !document.hidden && document.querySelector?.('.widget-tab[data-tab="aitalk"]')?.classList?.contains('active');
    if (!seeded) { messages.forEach(message => seen.add(message.id)); seeded = true; }
    if (visible) messages.forEach(message => seen.add(message.id));
    if (label) label.textContent = tabCountLabel(unreadCount(messages, seen, members));
}
window.addEventListener('message', event => { controller.receive(event.data); trackUnread(event); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) window.askawayPostMessage({ type: 'requestAITalk' }); });
window.askawayPostMessage({ type: 'requestAITalk' });
setInterval(() => { if (!document.hidden) window.askawayPostMessage({ type: 'requestAITalk' }); }, 2000);
