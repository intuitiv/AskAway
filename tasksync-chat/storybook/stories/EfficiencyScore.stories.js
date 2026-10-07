import webviewSrc from '../../media/webview.js?raw';
import cssText from '../../media/main.css?raw';
import { VSCODE_DARK_THEME } from '../kit.js';

const block = webviewSrc.slice(webviewSrc.indexOf('// ── Usage banner'), webviewSrc.indexOf('// ── end Usage banner'));
const banner = new Function(block + '; return chatBannerHtml;')();
export default { title: 'AskAway/Usage banner', parameters: { layout: 'centered' } };
export const LiveEfficiencyScore = {
    args: { dollars: 0.65, cacheHit: 0.99, prompt: 143000, requests: 33 },
    render: ({ dollars, cacheHit, prompt, requests }) => {
        const root = document.createElement('div');
        root.className = 'aa-sidebar';
        root.innerHTML = `<style>${cssText}\n${VSCODE_DARK_THEME}</style>` + banner({
            lastRequest: { requestCount: requests, nanoAiu: dollars * 100e9, inputTokens: prompt * requests,
                cachedTokens: prompt * requests * cacheHit, outputTokens: 1000 },
            turnRequests: Array.from({ length: requests }, () => ({ inputTokens: prompt })),
        }, Date.now());
        return root;
    },
};
