import { createTalkController } from './talkController.js';
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
window.addEventListener('message', event => controller.receive(event.data));
window.askawayPostMessage({ type: 'requestAITalk' });
setInterval(() => { if (!document.hidden) window.askawayPostMessage({ type: 'requestAITalk' }); }, 2000);
