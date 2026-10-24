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
// Unread count in the tab title, e.g. AITalk(3): messages not yet seen. It clears when the reviewer opens the AITalk tab or clicks
// in the panel (or a state arrives while AITalk is active, visible and the window focused). Every new message from others plays the
// notification once (reviewer, 2026-10-24); old history never does.
const seen = new Set();
const heard = new Set();
let seeded = false, latest = [], latestMembers, lastSound = 0;
const tabIsActive = () => Boolean(document.querySelector?.('.widget-tab[data-tab="aitalk"]')?.classList?.contains('active'));
const windowFocused = () => typeof document.hasFocus === 'function' ? document.hasFocus() : true;
const watching = () => !document.hidden && tabIsActive() && windowFocused();
function paintCount() {
    const label = document.getElementById('tab-count-aitalk');
    if (label) label.textContent = tabCountLabel(unreadCount(latest, seen, latestMembers));
}
function markSeen() { latest.forEach(message => seen.add(message.id)); paintCount(); }
function trackUnread(event) {
    if (event.data?.type !== 'aitalkState') return;
    const state = event.data.data || {};
    latest = state.messages || [];
    latestMembers = state.members && state.members.length ? state.members : undefined;
    if (!seeded) { latest.forEach(message => { seen.add(message.id); heard.add(message.id); }); seeded = true; }
    const fresh = latest.filter(message => unreadCount([message], heard, latestMembers) === 1);
    fresh.forEach(message => heard.add(message.id));
    // One sound per snapshot, and never more often than every 1.5 s, however many messages arrived (the first snapshot stays silent).
    if (fresh.length && typeof window.askawayPlayNotification === 'function' && Date.now() - lastSound >= 1500) { lastSound = Date.now(); window.askawayPlayNotification(); }
    if (watching()) latest.forEach(message => seen.add(message.id));
    paintCount();
}
document.addEventListener('click', event => {
    const target = event.target;
    if (target?.closest?.('.widget-tab[data-tab="aitalk"]')) { markSeen(); return; }
    if (target?.closest?.('#panel-aitalk') && !document.hidden) markSeen();
});
window.addEventListener('message', event => { controller.receive(event.data); trackUnread(event); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) window.askawayPostMessage({ type: 'requestAITalk' }); });
window.askawayPostMessage({ type: 'requestAITalk' });
setInterval(() => { if (!document.hidden) window.askawayPostMessage({ type: 'requestAITalk' }); }, 2000);
