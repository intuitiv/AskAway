import { headerHtml, threadHtml, composerHtml, mentionsHtml } from './talkRender.js';
import { selectReply } from './talkRules.js';
let state = { messages: [], members: [] }, reply, draft = '';
const root = () => document.getElementById('aitalk-root');
export function renderAITalk(next = state) {
    state = next;
    const host = root();
    if (!host || !state.members.length) return;
    host.innerHTML = headerHtml({ members: state.members }) + '<div class="talk-thread" role="log" aria-label="Group chat">' + threadHtml(state.messages, state.members) + '</div><div id="aitalk-composer">' + composerHtml({ members: state.members, reply, draft }) + '</div>';
}
window.addEventListener('message', event => { if (event.data.type === 'aitalkState') renderAITalk(event.data.data); });
document.addEventListener('click', event => {
    if (!event.target.closest('#aitalk-root')) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-send')) {
        const text = root().querySelector('textarea').value;
        if (!text.trim()) return;
        window.askawayPostMessage({ type: reply ? 'aitalkReply' : 'aitalkPost', text, replyTo: reply?.id });
        reply = undefined; draft = ''; renderAITalk();
    } else if (button.dataset.reply) { reply = selectReply(state.messages, button.dataset.reply); renderAITalk(); }
    else if (button.hasAttribute('data-cancel-reply')) { reply = undefined; renderAITalk(); }
    else if (button.dataset.react) window.askawayPostMessage({ type: 'aitalkReact', replyTo: button.dataset.msg, emoji: button.dataset.react });
    else if (button.dataset.mention) { draft = draft.replace(/@$/, '@' + button.dataset.mention + ' '); renderAITalk(); root().querySelector('textarea').focus(); }
    else if (button.dataset.more) { state.messages = state.messages.map(message => message.id === button.dataset.more ? { ...message, expanded: !message.expanded } : message); renderAITalk(); }
});
document.addEventListener('input', event => {
    if (!event.target.matches('#aitalk-root textarea')) return;
    draft = event.target.value;
    root().querySelector('.talk-mentions')?.remove();
    if (draft.endsWith('@')) root().querySelector('.talk-composer').insertAdjacentHTML('afterbegin', mentionsHtml(state.members));
});
document.addEventListener('contextmenu', event => {
    const bubble = event.target.closest('#aitalk-root .talk-bubble[data-msg]');
    if (bubble) { event.preventDefault(); bubble.classList.toggle('reacting'); }
});
document.addEventListener('keydown', event => {
    const bubble = event.target.closest('#aitalk-root .talk-bubble[data-msg]');
    if (bubble && event.key === 'Enter') { bubble.classList.toggle('reacting'); event.preventDefault(); }
    if (event.key === 'Escape') root()?.querySelectorAll('.reacting').forEach(el => el.classList.remove('reacting'));
});
document.addEventListener('click', event => {
    const link = event.target.closest('#aitalk-root [data-tab="Trace"]');
    if (link) { event.preventDefault(); document.querySelector('.widget-tab[data-tab="observability"]')?.click(); }
});
window.askawayPostMessage({ type: 'requestAITalk' });
