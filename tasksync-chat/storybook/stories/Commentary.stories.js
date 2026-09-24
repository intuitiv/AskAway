import webviewSrc from '../../media/webview.js?raw';
import cssText from '../../media/main.css?raw';
import providerSrc from '../../src/webview/webviewProvider.ts?raw';
import realFeed from '../fixtures/orchestrator-demo-feed.json';
import plainFeed from '../fixtures/plain-language-sample.json';
import { buildCommentaryKit, VSCODE_DARK_THEME } from '../kit.js';

const kit = buildCommentaryKit({ webviewSrc, providerSrc });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mount({ goal = '', items = [], archivedCount = 0, filter = 'all' }) {
    const root = document.createElement('div');
    root.className = 'aa-sidebar';
    root.innerHTML = `<style>${cssText}\n${VSCODE_DARK_THEME}</style>${kit.panelHtml}`;
    root.querySelector('#cm-goal-input').value = goal;
    const state = { goal, items, archivedCount, filter, seen: {} };
    const paint = (animate) => {
        const feed = root.querySelector('#cm-feed');
        feed.innerHTML = kit.renderCommentaryHtml({ goal: state.goal, items: state.items, archivedCount: state.archivedCount }, state.filter);
        if (animate) { kit.commentaryAnimateNew(feed, state.seen, state.msPerChar ?? 18); } else { state.items.forEach((i) => { state.seen[i.id] = true; }); }
    };
    // Filters behave exactly as in the webview.
    root.querySelector('#cm-filters').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cm-filter]');
        if (!btn) { return; }
        state.filter = btn.getAttribute('data-cm-filter');
        root.querySelectorAll('[data-cm-filter]').forEach((b) => b.classList.toggle('active', b === btn));
        paint(false);
    });
    root.querySelectorAll('[data-cm-filter]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-cm-filter') === filter));
    root.__commentary = { state, paint };
    paint(false);
    return root;
}

export default {
    title: 'AskAway/Live commentary',
    parameters: { layout: 'centered', backgrounds: { default: 'dark' } },
    argTypes: {
        secondsBetweenLines: { control: { type: 'range', min: 0.5, max: 10, step: 0.5 } },
        msPerChar: { control: { type: 'range', min: 0, max: 60, step: 2 } },
    },
};

/** The real feed from an AA.Orchestrator run, replayed line by line with the typewriter the webview uses. */
export const LiveSimulation = {
    args: { secondsBetweenLines: 2.5, msPerChar: 18 },
    render: () => mount({ goal: realFeed.goal }),
    play: (context) => replay(context, realFeed.items),
};

/** The same run in the plain-language format (emoji, bold outcome, highlighted number). A style sample, not a recording. */
export const PlainLanguage = {
    args: { secondsBetweenLines: 2.5, msPerChar: 18 },
    render: () => mount({ goal: plainFeed.goal }),
    play: (context) => replay(context, plainFeed.items),
};

async function replay({ canvasElement, args }, items) {
    const { state, paint } = canvasElement.querySelector('.aa-sidebar').__commentary;
    state.msPerChar = args.msPerChar;
    for (const item of items) {
        state.items = [...state.items, item];
        paint(true);
        await sleep(args.secondsBetweenLines * 1000);
    }
}

export const FullFeed = { render: () => mount({ goal: realFeed.goal, items: realFeed.items, archivedCount: 1 }) };

export const DecisionsOnly = { render: () => mount({ goal: realFeed.goal, items: realFeed.items, filter: 'decision' }) };

export const WaitingForFirstBall = { render: () => mount({ goal: '' }) };
