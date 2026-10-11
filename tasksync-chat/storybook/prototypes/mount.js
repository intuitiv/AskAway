import webviewSrc from '../../media/webview.js?raw';
import providerSrc from '../../src/webview/webviewProvider.ts?raw';
import cssText from '../../media/main.css?raw';
import prototypeCss from './talk.css?raw';
import { buildCommentaryKit, VSCODE_DARK_THEME } from '../kit.js';
import { talkHtml, traceHtml, traceSessions } from './talk.js';
const { traceRowsHtml } = buildCommentaryKit({ webviewSrc, providerSrc });
export function mountTalk(options = {}) {
    const root = document.createElement('div');
    let messages = [...(options.messages || [])];
    let replyTo;
    const paint = () => {
        root.innerHTML = `<style>${cssText}\n${VSCODE_DARK_THEME}\n${prototypeCss}</style>${talkHtml(messages, { ...options, trace: traceHtml(traceSessions, traceRowsHtml) })}`;
        if (options.traceOnly) openTab('Trace');
    };
    const openTab = tab => {
        if (!['Talk', 'Trace'].includes(tab)) return;
        root.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
        root.querySelectorAll('.talk-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
    };
    root.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.tab) openTab(button.dataset.tab);
        if (button.hasAttribute('data-bottom')) { root.querySelector('#talk-bottom').scrollIntoView({ block: 'nearest' }); button.remove(); }
        if (button.dataset.mention) { root.querySelector('.talk-composer textarea').value = `@${button.dataset.mention} `; root.querySelector('.talk-mentions').remove(); root.querySelector('.talk-composer textarea').focus(); }
        if (button.dataset.reply) { replyTo = button.dataset.reply; const draft = root.querySelector('.talk-composer textarea'); draft.placeholder = `Reply to ${messages.find(m => m.id === replyTo)?.author}${button.dataset.question ? ` · question ${button.dataset.question}` : ''}`; draft.focus(); }
        if (button.dataset.vote) { const group = button.closest('.talk-actions'); group.querySelectorAll('[data-vote]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); }
        if (button.hasAttribute('data-reaction')) button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
        if (button.hasAttribute('data-send')) {
            const text = root.querySelector('.talk-composer textarea').value.trim();
            if (!text) return;
            messages.push({ id: `draft-${messages.length}`, author: 'You', text, replyTo, delivery: 'posted', time: '10:45' });
            replyTo = undefined; paint(); root.querySelector('#talk-bottom').scrollIntoView({ block: 'nearest' });
        }
        if (button.hasAttribute('data-deliver')) { messages = messages.map(m => m.id === 'gate' ? { ...m, delivery: 'delivered', tool: 'read_file', text: 'Gate finished ✓ — delivered to Agent' } : m); paint(); }
    });
    paint();
    if (options.async) { const button = document.createElement('button'); button.textContent = 'Simulate Agent’s next tool call: read_file'; button.dataset.deliver = ''; root.append(button); }
    return root;
}
