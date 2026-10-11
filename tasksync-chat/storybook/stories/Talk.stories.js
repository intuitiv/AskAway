import { mountTalk } from '../prototypes/mount.js';
import { scenarios, betaMessages } from '../prototypes/talk.js';
export default { title: 'Prototype/Talk', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };
const story = key => ({ render: () => mountTalk(scenarios[key]) });
export const ShellUser = story('ShellUser');
export const ShellValidator = story('ShellValidator');
export const GroupChatBasics = story('GroupChatBasics');
export const Ticks = story('Ticks');
export const ValidatorAnswers = story('ValidatorAnswers');
export const AgentProgress = story('AgentProgress');
export const AsyncCompletion = story('AsyncCompletion');
export const WorkersJoin = story('WorkersJoin');
export const EmptyState = story('EmptyState');
export const LongBusyThread = story('LongBusyThread');
export const BetaVsAfterBeta = { render: () => {
    const root = document.createElement('div'); root.className = 'talk-comparison';
    for (const after of [false, true]) { const column = document.createElement('section'); const heading = document.createElement('h3'); heading.textContent = after ? 'After beta · reply delivered to Agent' : 'Beta · Validator replies in chat only'; column.append(heading, mountTalk({ messages: betaMessages(after) })); root.append(column); } return root;
} };
export const Naming = { render: () => {
    const root = document.createElement('div'); root.className = 'talk-comparison';
    for (const name of ['Talk', 'AITalk', 'Agently', 'Huddle']) root.append(mountTalk({ name, messages: scenarios.GroupChatBasics.messages })); return root;
} };
export const AvailabilityColours = { render: () => {
    const root = document.createElement('div'); root.innerHTML = '<div class="talk-availability"><span class="here">Here</span><span class="away">Away</span><span class="awayValidator">Away + Validator</span><span class="offline">Offline</span></div>'; root.append(mountTalk(scenarios.ShellValidator)); return root;
} };
