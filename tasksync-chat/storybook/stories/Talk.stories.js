import { mountTalk } from '../prototypes/mount.js';
import { scenarios, liveStart, liveScript } from '../prototypes/talk.js';
import { defaultMembers } from '../prototypes/talkRules.js';

export default { title: 'AITalk/Talk', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };

export const FullConversation = { render: () => mountTalk(scenarios.Full) };
export const LiveSimulation = { render: () => mountTalk({ messages: liveStart, live: { script: liveScript } }) };
export const ValidatorWhileAgentAway = { render: () => mountTalk(scenarios.Away) };
export const LightTheme = { parameters: { backgrounds: { default: 'light' } }, render: () => mountTalk(scenarios.Light) };
export const ValidatorAsProxy = { render: () => mountTalk(scenarios.Proxy) };
export const EmptyState = { render: () => mountTalk(scenarios.Empty) };
export const ConfiguredNewAgent = { render: () => mountTalk({
    members: [...defaultMembers, { id: 'sage', kind: 'navigator', displayName: 'Sage', colour: 'who-p2', rank: 250,
        presencePolicy: 'joinsPerTurn', canProxyWhenAway: true, presence: 'left' }],
    messages: [{ id: 'sage-question', author: 'You', text: '@Sage check this route?' }], draft: '@',
    live: { script: [{ do: 'join', who: 'sage' }, { do: 'add', message: { id: 'sage-answer', author: 'sage', replyTo: 'sage-question', text: 'The route is clear.' } }, { do: 'leave', who: 'sage' }] },
}) };
