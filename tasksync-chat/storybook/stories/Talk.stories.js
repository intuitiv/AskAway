import { mountTalk } from '../prototypes/mount.js';
import { scenarios, liveStart, liveScript } from '../prototypes/talk.js';
import { defaultMembers } from '../prototypes/talkRules.js';

export default { title: 'AITalk/Talk', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };

export const FullConversation = { render: () => mountTalk(scenarios.Full) };
export const LiveSimulation = { render: () => mountTalk({ messages: liveStart, live: { script: liveScript } }) };
export const ValidatorWhileAgentAway = { render: () => mountTalk(scenarios.Away) };
export const LightTheme = { parameters: { backgrounds: { default: 'light' } }, render: () => mountTalk({ ...scenarios.Light, theme: 'light' }) };
export const ValidatorAsProxy = { render: () => mountTalk(scenarios.Proxy) };
export const EmptyState = { render: () => mountTalk(scenarios.Empty) };
export const ConfiguredNewAgent = { render: () => mountTalk({
    members: [...defaultMembers, { id: 'sage', kind: 'navigator', displayName: 'Sage', colour: 'who-p2', rank: 250,
        presencePolicy: 'joinsPerTurn', canProxyWhenAway: true, presence: 'left' }],
    messages: [{ id: 'sage-question', author: 'You', text: '@Sage check this route?' }], draft: '@',
    live: { script: [{ do: 'join', who: 'sage' }, { do: 'add', message: { id: 'sage-answer', author: 'sage', replyTo: 'sage-question', text: 'The route is clear.' } }, { do: 'leave', who: 'sage' }] },
}) };
// The one approval card for any provider and action, fed by simulated actors: 👍 approves it once and it settles; 👎 rejects it. Names only, never ids.
const approvalCard = (id, draftId, webexDraft) => ({ id, author: 'webex-worker', kind: 'webexDraft', draftId, text: `Draft · ${webexDraft.provider} ${webexDraft.action} · ${webexDraft.recipientLabel}\n\n${webexDraft.text}`, webexDraft: { state: 'pending', ...webexDraft } });
const approvalMembers = [...defaultMembers, { id: 'webex-worker', kind: 'worker', displayName: 'Webex worker', colour: 'who-p2', rank: 100, presencePolicy: 'leavesWhenAnswered', presence: 'left' }];
export const WebexDraftApproval = { render: () => mountTalk({
    members: approvalMembers,
    messages: [],
    live: { script: [{ do: 'join', who: 'webex-worker' }, { do: 'add', message: approvalCard('webex-draft', 'draft-1', { provider: 'webex', action: 'reply', recipientLabel: 'Build Team',
        details: { 'Replying to': 'Ana Smith: Can you deploy today?' }, text: 'Build is green; I will deploy at 3pm.\nPing me if that clashes.' }) }] },
}) };
export const OutlookApproval = { render: () => mountTalk({
    members: approvalMembers,
    messages: [],
    live: { script: [{ do: 'join', who: 'webex-worker' }, { do: 'add', message: approvalCard('outlook-draft', 'draft-2', { provider: 'outlook', action: 'create_event', recipientLabel: 'Ana Smith',
        details: { When: 'Friday 10:00' }, files: ['agenda.pdf'], text: 'Sync on the release.' }) }] },
}) };
