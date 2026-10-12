import { headerHtml, threadHtml, composerHtml, mentionsHtml } from './talkRender.js';
import { selectReply } from './talkRules.js';
let state = { messages: [], members: [] }, reply, draft = '', emoji = false, attachments = [], caret = [0, 0];
const root = () => document.getElementById('aitalk-root');
let composing = false, deferredState;
export function renderAITalk(next = state) {
    if (composing) { deferredState = next; return; }
    const refresh = next !== state;
    const expanded = new Set(state.messages.filter(message => message.expanded).map(message => message.id));
    state = { ...next, messages: next.messages.map(message => expanded.has(message.id) ? { ...message, expanded: true } : message) };
    const host = root();
    if (!host || !state.members.length) return;
    const oldComposer = host.querySelector('textarea');
    const focused = oldComposer && document.activeElement === oldComposer;
    const selection = focused ? [oldComposer.selectionStart, oldComposer.selectionEnd, oldComposer.selectionDirection] : undefined;
    if (oldComposer && refresh) draft = oldComposer.value;
    host.innerHTML = headerHtml({ members: state.members }) + '<div class="talk-thread" role="log" aria-label="Group chat">' + threadHtml(state.messages, state.members) + '</div><div id="aitalk-composer">' + composerHtml({ members: state.members, reply, draft, emoji, attachments }) + '</div>';
    if (focused) {
        const composer = host.querySelector('textarea');
        composer.focus();
        composer.setSelectionRange(...selection);
    }
}
window.addEventListener('message', event => {
    if (event.data.type === 'aitalkState') renderAITalk(event.data.data);
    if (event.data.type === 'aitalkAttachments') { attachments.push(...event.data.files); draft = root().querySelector('textarea').value; renderAITalk(); }
});
function sendMessage() {
    const text = root().querySelector('textarea').value;
    if (!text.trim()) return;
    window.askawayPostMessage({ type: reply ? 'aitalkReply' : 'aitalkPost', text, replyTo: reply?.id, attachments });
    reply = undefined; draft = ''; attachments = []; emoji = false; renderAITalk();
}
document.addEventListener('click', event => {
    if (!event.target.closest('#aitalk-root')) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-send')) {
        sendMessage();
    } else if (button.dataset.reply) { reply = selectReply(state.messages, button.dataset.reply); renderAITalk(); }
    else if (button.hasAttribute('data-cancel-reply')) { reply = undefined; renderAITalk(); }
    else if (button.dataset.react) window.askawayPostMessage({ type: 'aitalkReact', replyTo: button.dataset.msg, emoji: button.dataset.react });
    else if (button.dataset.mention) { draft = draft.replace(/@$/, '@' + button.dataset.mention + ' '); renderAITalk(); root().querySelector('textarea').focus(); }
    else if (button.hasAttribute('data-emoji')) { const input = root().querySelector('textarea'); draft = input.value; caret = [input.selectionStart ?? draft.length, input.selectionEnd ?? draft.length]; emoji = !emoji; renderAITalk(); }
    else if (button.dataset.insertEmoji) { draft = draft.slice(0, caret[0]) + button.dataset.insertEmoji + draft.slice(caret[1]); emoji = false; renderAITalk(); const input = root().querySelector('textarea'); input.focus(); input.setSelectionRange(caret[0] + button.dataset.insertEmoji.length, caret[0] + button.dataset.insertEmoji.length); }
    else if (button.hasAttribute('data-attach')) window.askawayPostMessage({ type: 'aitalkAttach' });
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
    if (event.target.matches?.('#aitalk-root textarea') && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage(); return; }
    const bubble = event.target.closest('#aitalk-root .talk-bubble[data-msg]');
    if (bubble && event.key === 'Enter') { bubble.classList.toggle('reacting'); event.preventDefault(); }
    if (event.key === 'Escape') root()?.querySelectorAll('.reacting').forEach(el => el.classList.remove('reacting'));
});
document.addEventListener('compositionstart', event => { if (event.target.matches?.('#aitalk-root textarea')) composing = true; });
document.addEventListener('compositionend', event => {
    if (!event.target.matches?.('#aitalk-root textarea')) return;
    composing = false; draft = event.target.value;
    if (deferredState) { const next = deferredState; deferredState = undefined; renderAITalk(next); }
});
document.addEventListener('click', event => {
    const link = event.target.closest('#aitalk-root [data-tab="Trace"]');
    if (link) { event.preventDefault(); document.querySelector('.widget-tab[data-tab="observability"]')?.click(); }
});
window.askawayPostMessage({ type: 'requestAITalk' });
setInterval(() => {
    if (!document.hidden && root()) window.askawayPostMessage({ type: 'requestAITalk' });
}, 2000);
