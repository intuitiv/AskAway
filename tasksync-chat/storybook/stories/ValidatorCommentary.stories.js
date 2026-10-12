import { mountTalk } from '../prototypes/mount.js';

export default { title: 'AITalk/Validator answers', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };
function mount(detail) {
    return mountTalk({ messages: [
        { id: 'update', author: 'Agent', time: '10:00', text: 'Checking the current rule against the active spec before proceeding.' },
        { id: 'validator', author: 'Validator', time: '10:00', text: detail.error ? 'Validator could not check this: ' + detail.error : 'Validator: ' + (detail.answer || 'no source answers this question.'), details: JSON.stringify(detail) },
    ] });
}
export const OkEntry = { render: () => mount({ answer: 'Use the shared server.', sources: ['Rules.md'], observations: 'Rule applies.', summary: 'Covered.', impact: 'No extra server.', usage: { input: 100, output: 20, cacheRead: 80, cost: 0.01 } }) };
export const NoSourceEntry = { render: () => mount({ answer: null, sources: [], summary: 'No source covers this question.' }) };
export const FailedRunErrorEntry = { render: () => mount({ error: 'Validator server unavailable.' }) };
