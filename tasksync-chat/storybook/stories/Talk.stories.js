import { mountTalk } from '../prototypes/mount.js';
import { scenarios, liveStart, liveScript } from '../prototypes/talk.js';

export default { title: 'AITalk/Talk', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };

export const FullConversation = { render: () => mountTalk(scenarios.Full) };
export const LiveSimulation = { render: () => mountTalk({ messages: liveStart, live: { script: liveScript } }) };
export const ValidatorWhileAgentAway = { render: () => mountTalk(scenarios.Away) };
export const LightTheme = { parameters: { backgrounds: { default: 'light' } }, render: () => mountTalk(scenarios.Light) };
export const ValidatorAsProxy = { render: () => mountTalk(scenarios.Proxy) };
export const EmptyState = { render: () => mountTalk(scenarios.Empty) };
