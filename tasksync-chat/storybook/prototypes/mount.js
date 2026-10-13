import webviewSrc from '../../media/webview.js?raw';
import cssText from '../../media/main.css?raw';
import prototypeCss from '../../media/aitalk/talk.css?raw';
import { buildTraceKit, VSCODE_DARK_THEME } from '../kit.js';
import { traceHtml, traceSessions, defaultMembers } from './talk.js';
import { createSimulatedRoom } from './simulatedActors.js';
import { createTalkController } from '../../media/aitalk/talkController.js';
const { traceRowsHtml } = buildTraceKit({ webviewSrc });

// The production widget, fed by simulated actors instead of the extension.
export function mountTalk(options = {}) {
    const root = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = cssText + VSCODE_DARK_THEME + prototypeCss;
    const panel = document.createElement('div');
    root.append(style, panel);
    let room;
    const controller = createTalkController({ host: panel, options: { ...options, embedded: false, trace: traceHtml(traceSessions, traceRowsHtml) }, post(action) {
        if (action.type === 'aitalkAttach') controller.receive({ type: 'aitalkAttachments', files: [{ name: 'notes.txt' }] });
        else if (action.type === 'setAvailability') controller.receive({ type: 'availabilityState', data: { mode: action.mode } });
        else room.intent(action);
    } });
    room = createSimulatedRoom({ messages: options.messages || [], members: options.members || defaultMembers, typing: options.typing, unread: options.unread, render: state => controller.render(state), schedule: setTimeout });
    room.start();
    let delay = 0;
    for (const step of options.live?.script || []) { delay += step.after ?? 1700; setTimeout(() => { if (root.isConnected) room.act(step); }, delay); }
    return root;
}
