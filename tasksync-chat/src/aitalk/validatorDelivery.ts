import { AITalkStore, onAITalkMessage } from './store';
import { needsObserving } from '../validator/observer';

export function registerAITalkValidator(root: string, invoke: (text: string, id: string) => Promise<unknown>) {
    const store = new AITalkStore(root);
    let pending = Promise.resolve();
    const dispose = onAITalkMessage(root, message => {
        const members = store.snapshot().members;
        const validator = members.find(member => member.kind === 'validator');
        const author = members.find(member => member.id === message.author);
        if (!validator || author?.id === validator.id) return;
        if (!message.recipients?.includes(validator.id) && !needsObserving(message.text)) return;
        pending = pending.then(async () => {
            store.takeForTool(validator.id);
            await invoke(message.text, message.id);
        }).catch(error => { console.warn('[AskAway] AITalk Validator failed:', error); });
    });
    return { dispose, flush: () => pending };
}
