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
// A Webex worker's draft card fed by simulated actors: 👍 sends it once and it turns Sent; 👎 rejects it.
export const WebexDraftApproval = { render: () => mountTalk({
    members: [...defaultMembers, { id: 'webex-worker', kind: 'worker', displayName: 'Webex worker', colour: 'who-p2', rank: 100, presencePolicy: 'leavesWhenAnswered', presence: 'left' }],
    messages: [],
    live: { script: [{ do: 'join', who: 'webex-worker' }, { do: 'add', message: { id: 'webex-draft', author: 'webex-worker', kind: 'webexDraft', draftId: 'draft-1',
        text: 'Draft · Webex to Build Team (thread reply)\n\nBuild is green; I will deploy at 3pm.\nPing me if that clashes.',
        webexDraft: { state: 'pending', recipientLabel: 'Build Team', space: 'Build Team', roomId: 'room-1', parentId: 'thread-7', text: 'Build is green; I will deploy at 3pm.\nPing me if that clashes.' } } }] },
}) };
