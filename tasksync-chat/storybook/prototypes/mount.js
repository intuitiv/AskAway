import webviewSrc from '../../media/webview.js?raw';
import cssText from '../../media/main.css?raw';
import prototypeCss from '../../media/aitalk/talk.css?raw';
import { buildTraceKit, VSCODE_DARK_THEME } from '../kit.js';
import { traceHtml, traceSessions, defaultMembers } from './talk.js';
import { owner, postMessage, reactMessage, deliveryEvent } from './talkRules.js';
import { createTalkController } from '../../media/aitalk/talkController.js';
const { traceRowsHtml } = buildTraceKit({ webviewSrc });

export function mountTalk(options = {}) {
    const root = document.createElement('div');
    let sent = 0;
    const style = document.createElement('style');
    style.textContent = cssText + VSCODE_DARK_THEME + prototypeCss;
    const panel = document.createElement('div');
    root.append(style, panel);
    const controller = createTalkController({ host: panel, options: { ...options, embedded: false, trace: traceHtml(traceSessions, traceRowsHtml) }, post(action) {
        const state = controller.snapshot();
        if (action.type === 'aitalkPost' || action.type === 'aitalkReply') {
            const result = postMessage({ id: `sent-${sent++}`, author: owner(state.members).id, text: action.text, replyTo: action.replyTo, attachments: action.attachments }, state.messages, state.members);
            controller.render({ ...state, messages: result.messages, members: result.registry });
            const id = result.messages.at(-1).id;
            setTimeout(() => controller.step({ do: 'event', id, event: 'delivered' }), 1600);
            setTimeout(() => controller.step({ do: 'event', id, event: 'read' }), 2400);
        }
        if (action.type === 'aitalkReact') { const result = reactMessage(state.messages.find(message => message.id === action.replyTo), action.emoji, owner(state.members).id, state.messages, state.members, `reaction-${sent++}`); controller.render({ ...state, messages: result.messages, members: result.registry }); }
        if (action.type === 'aitalkAttach') controller.receive({ type: 'aitalkAttachments', files: [{ name: 'notes.txt' }] });
        if (action.type === 'setAvailability') controller.receive({ type: 'availabilityState', data: { mode: action.mode } });
        if (action.type === 'aitalkApproveDraft') controller.step({ do: 'add', message: { id: `approval-${sent++}`, author: owner(state.members).id, text: '👍', delivery: 'posted' } });
    } });
    controller.render({ messages: [...(options.messages || [])], members: options.members || defaultMembers, typing: options.typing, unread: options.unread });
    let delay = 0;
    for (const step of options.live?.script || []) { delay += step.after ?? 1700; setTimeout(() => { if (root.isConnected) controller.step(step); }, delay); }
    return root;
}
