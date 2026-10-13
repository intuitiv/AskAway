import { createTalkController } from './talkController.js';
const controller = createTalkController({ host: document.getElementById('aitalk-root'), events: document, post: message => {
    if (message.type === 'talkTab' && message.tab === 'Trace') { document.querySelector('.widget-tab[data-tab="observability"]')?.click(); return; }
    window.askawayPostMessage(message);
} });
export function renderAITalk(state) { controller.render(state); }
window.addEventListener('message', event => controller.receive(event.data));
window.askawayPostMessage({ type: 'requestAITalk' });
setInterval(() => { if (!document.hidden) window.askawayPostMessage({ type: 'requestAITalk' }); }, 2000);
