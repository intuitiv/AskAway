import webviewSrc from '../../media/webview.js?raw';
import cssText from '../../media/main.css?raw';
import providerSrc from '../../src/webview/webviewProvider.ts?raw';
import sample from '../fixtures/sample-conversation.json';
import { buildCommentaryKit, buildWorkersKit, VSCODE_DARK_THEME } from '../kit.js';

// Frames are recorded through the real runtime, worker tool and commentary store: node storybook/fixtures/build-sample-conversation.cjs
const commentaryKit = buildCommentaryKit({ webviewSrc, providerSrc });
const workersKit = buildWorkersKit({ webviewSrc, providerSrc });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LAYOUT = `.aa-demo{display:flex;gap:12px;align-items:flex-start;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}
.aa-demo .aa-sidebar{min-height:620px}
.aa-col-title{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.6;margin:0 0 6px}
.aa-chat{width:300px;min-height:620px;padding:10px;box-sizing:border-box;background:#1f1f1f;border:1px solid #2b2b2b;font-size:13px}
.aa-msg{margin:0 0 10px;padding:8px 10px;border-radius:6px;line-height:1.4}
.aa-msg.user{background:#264f78;margin-left:24px}
.aa-msg.assistant{background:#2b2b2b;margin-right:24px}
.aa-caption{margin:0 0 10px;padding:6px 10px;border-left:3px solid var(--vscode-charts-blue);background:#1f1f1f;font-size:12px}`;

function mount(frameIndex) {
    const root = document.createElement('div');
    root.innerHTML = `<style>${cssText}\n${VSCODE_DARK_THEME}\n${LAYOUT}</style>
<div class="aa-caption" id="aa-caption"></div>
<div class="aa-demo">
  <div><div class="aa-col-title">Chat</div><div class="aa-chat" id="aa-chat"></div></div>
  <div><div class="aa-col-title">Commentary tab</div><div class="aa-sidebar">${commentaryKit.panelHtml}</div></div>
  <div><div class="aa-col-title">Workers tab</div><div class="aa-sidebar">${workersKit.panelHtml}</div></div>
</div>`;
    const seen = {};
    const show = (frame, animate) => {
        root.querySelector('#aa-caption').textContent = `Step ${sample.frames.indexOf(frame) + 1}/${sample.frames.length} · ${frame.caption}`;
        root.querySelector('#aa-chat').innerHTML = frame.chat.map((m) => `<div class="aa-msg ${m.role}">${esc(m.text)}</div>`).join('');
        root.querySelector('#cm-goal-input').value = frame.commentary.goal || 'Show how commentary and workers work together.';
        const feed = root.querySelector('#cm-feed');
        feed.innerHTML = commentaryKit.renderCommentaryHtml(frame.commentary);
        if (animate) { commentaryKit.commentaryAnimateNew(feed, seen, 14); } else { frame.commentary.items.forEach((i) => { seen[i.id] = true; }); }
        root.querySelector('#workers-list').innerHTML = workersKit.renderWorkersHtml(frame.workers, '', {}, false, {}, {});
    };
    root.__demo = { show };
    show(sample.frames[frameIndex], false);
    return root;
}

export default {
    title: 'AskAway/Sample conversation',
    parameters: { layout: 'padded', backgrounds: { default: 'dark' } },
    argTypes: { secondsPerStep: { control: { type: 'range', min: 1, max: 10, step: 0.5 } } },
};

/** Two turns replayed step by step: plan, parallel tracks, independent checks, then warm reuse and a heads-up. */
export const Replay = {
    args: { secondsPerStep: 3.5 },
    render: () => mount(0),
    play: async ({ canvasElement, args }) => {
        const { show } = canvasElement.querySelector('.aa-demo').parentElement.__demo;
        for (const frame of sample.frames) {
            show(frame, true);
            await sleep(args.secondsPerStep * 1000);
        }
    },
};

export const TurnOneDone = { render: () => mount(sample.frames.findIndex((f) => f.caption.startsWith('Turn 1 done'))) };

export const SecondTurnCollapsesFirst = { render: () => mount(sample.frames.length - 1) };
