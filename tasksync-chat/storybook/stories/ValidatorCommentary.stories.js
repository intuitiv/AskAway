import webviewSrc from '../../media/webview.js?raw';
import cssText from '../../media/main.css?raw';
import providerSrc from '../../src/webview/webviewProvider.ts?raw';
import { buildCommentaryKit, VSCODE_DARK_THEME } from '../kit.js';

const kit = buildCommentaryKit({ webviewSrc, providerSrc });
export default { title: 'AskAway/Validator commentary', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };
function mount(detail) {
    const root = document.createElement('div');
    root.className = 'aa-sidebar';
    root.innerHTML = `<style>${cssText}\n${VSCODE_DARK_THEME}</style>${kit.panelHtml}`;
    root.querySelector('#cm-feed').innerHTML = kit.renderCommentaryHtml({ items: [
        { id: 'update', ts: 1000, kind: 'update', text: 'Checking the current rule against the active spec before proceeding.' },
        { id: 'validator', ts: 1001, kind: 'validator', text: detail.error ? 'Validator could not check this.' : 'Validator: ' + (detail.answer || 'no source answers this question.'), detail },
    ] });
    return root;
}
export const OkEntry = { render: () => mount({ answer: 'Use the shared server.', sources: ['Rules.md'], observations: 'Rule applies.', summary: 'Covered.', impact: 'No extra server.', usage: { input: 100, output: 20, cacheRead: 80, cost: 0.01 } }) };
export const NoSourceEntry = { render: () => mount({ answer: null, sources: [], summary: 'No source covers this question.' }) };
export const FailedRunErrorEntry = { render: () => mount({ error: 'Validator server unavailable.' }) };
