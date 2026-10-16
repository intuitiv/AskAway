import { defaultMembers, displayName } from '../../media/aitalk/talkRules.js';
export const traceSessions = defaultMembers.filter(member => member.kind === 'agent').map((member, i) => ({ label: `${displayName(member)} session`, time: `10:${40 + i}`, status: 'finished', events: [{ kind: 'request', id: String(i + 1), model: displayName(member), inputTokens: 1200, outputTokens: 160, cachedTokens: 1000, nanoAiu: 200000000 }] }));
const earlier = [
    { kind: 'day', text: 'Yesterday' },
    { id: 'e1', author: 'You', text: 'morning. can we start on the sidebar?', time: '09:02', delivery: 'delivered', tool: 'commentary' },
    { id: 'e2', author: 'Agent', text: 'Morning. Reading the current layout first.', time: '09:03' },
    { id: 'e3', author: 'Agent', text: 'Tab strip is in webview.js, the chat tab is separate.', time: '09:05', trace: true },
    { id: 'e4', author: 'Validator', text: 'Remove the chat tab, commentary becomes the first one.', time: '09:06' },
    { id: 'e5', author: 'You', text: 'yes, do that', time: '09:07', delivery: 'delivered', tool: 'read_file' },
    { id: 'e6', author: 'Agent', text: 'Done. Tabs are AITalk, Specs, Trace, Workers, Settings.', time: '09:20', reactions: [{ emoji: '👍', count: 1, mine: true, delivery: 'delivered', tool: 'read_file' }, { emoji: '🙏', count: 1 }] },
    { id: 'e7', author: 'You', text: 'good, thanks', time: '09:21', delivery: 'delivered', tool: 'commentary' },
    { id: 'e8', author: 'Agent', text: 'Tests pass. Stopping here for today.', time: '09:40' },
    { id: 'e9', author: 'Agent', text: 'Metrics tab renamed to Trace.', time: '09:41', trace: true },
    { id: 'e10', author: 'Validator', text: 'RTK and Gradle numbers are gone from it too.', time: '09:42' },
    { id: 'e11', author: 'You', text: 'perfect', time: '09:43', delivery: 'delivered', tool: 'read_file' },
    { id: 'e12', author: 'You', text: 'see you tomorrow', time: '09:43', delivery: 'delivered', tool: 'read_file' },
];
const today = [
    { kind: 'day', text: 'Today' },
    { id: 'a1', author: 'Agent', text: 'Starting on the chat layout.', time: '10:31' },
    { id: 'a2', author: 'Agent', text: 'Found the old tab strip. Replacing it now.', time: '10:32', trace: true },
    { id: 'y1', author: 'You', text: '@Agent keep it narrow, 420px', time: '10:33', delivery: 'delivered', tool: 'commentary' },
    { kind: 'system', text: 'build-1 joined' },
    { id: 'w1', author: 'build-1', text: '@Validator should the reply preview stay on one line?', time: '10:35' },
    { id: 'v1', author: 'Validator', text: 'Yes. Open the full quote on click.', replyTo: 'w1', time: '10:35', reactions: [{ emoji: '👍', count: 2 }, { emoji: '👎', count: 1, mine: true }] },
    { kind: 'system', text: 'build-1 left' },
    { id: 'a4', author: 'Agent', text: 'Keep the name AITalk?', time: '10:38' },
    { id: 'v2', author: 'Validator', replyTo: 'a4', text: 'Proposed: yes, AITalk for beta.', proposal: 'Yes, AITalk for beta.', time: '10:38', reactions: [{ emoji: '👍', count: 1, mine: true, delivery: 'delivered', tool: 'read_file' }] },
    { id: 'a5', author: 'Agent', text: 'Hide old progress lines?', time: '10:39' },
    { id: 'v3', author: 'Validator', replyTo: 'a5', text: 'Proposed: remove them after the run.', proposal: 'Remove them after the run.', time: '10:39', reactions: [{ emoji: '👎', count: 1, mine: true }] },
    { id: 'y2', author: 'You', quote: { author: 'Agent', text: 'Keep the name AITalk?' }, text: 'Yes, AITalk for beta.', time: '10:39', delivery: 'delivered', tool: 'read_file' },
    { id: 'y3', author: 'You', quote: { author: 'Agent', text: 'Hide old progress lines?' }, text: 'No, keep them collapsed, not deleted.', time: '10:40', delivery: 'posted' },
    { id: 'y4', author: 'You', text: 'ok', time: '10:42', delivery: 'delivered', tool: 'read_file', reactions: [{ emoji: '👍', count: 1, by: ['Agent'] }] },
    { id: 'y5', author: 'You', text: 'thanks both', time: '10:43', delivery: 'posted', reactions: [{ emoji: '🙏', count: 1, by: ['Validator'] }] },
    { id: 'a3', author: 'Agent', text: 'Kept them collapsed. 12 checks passed.', time: '10:44', trace: true, reactions: [{ emoji: '👍', count: 1, mine: true, delivery: 'posted' }] },
    { id: 'a6', author: 'Agent', text: 'Ship the score fix now or after the gate?', time: '10:46', details: 'Two ways to go:\n- A) Now: users get the fix today, but the gate has not seen it.\n- B) After the gate: about 20 minutes later, and it ships with a green run.\nI would pick `B` unless the score bug is blocking someone.' },
    { id: 'v4', author: 'Validator', replyTo: 'a6', text: 'After the gate. The last two score changes both broke the Trace tab on first run, and the gate catches exactly that. Twenty minutes is cheap next to a rollback, and nobody is blocked on the score today, so there is no reason to skip the check. If the gate fails, fix forward and rerun it before shipping anything.', time: '10:47' },
    { kind: 'system', text: 'Agent left — joins again when you message it' },
];
export const fullConversation = [...earlier, ...today];
export const liveStart = [{ kind: 'day', text: 'Today' }, { id: 'l1', author: 'You', text: '@Agent can you check the composer spacing?', time: '10:50', delivery: 'posted' }];
export const liveScript = [
    { do: 'deliver', id: 'l1', tool: 'read_file', after: 1500 },
    { do: 'typing', who: 'Agent is typing…' },
    { do: 'add', message: { id: 'l2', author: 'Agent', text: 'On it.', time: '10:50' } },
    { do: 'add', message: { kind: 'system', text: 'build-1 joined' } },
    { do: 'add', message: { id: 'l3', author: 'build-1', text: '@Validator is 8px padding enough?', time: '10:51' } },
    { do: 'typing', who: 'Validator is typing…' },
    { do: 'add', message: { id: 'l4', author: 'Validator', text: 'Yes, 8px is fine.', replyTo: 'l3', time: '10:51' } },
    { do: 'add', message: { kind: 'system', text: 'build-1 left' } },
    { do: 'add', message: { id: 'l6', author: 'You', text: 'go ahead', time: '10:52', delivery: 'posted' } },
    { do: 'react', id: 'l6', emoji: '👍', by: 'Agent', after: 1200 },
    { do: 'deliver', id: 'l6', tool: 'read_file', after: 1500 },
    { do: 'typing', who: 'Agent is typing…' },
    { do: 'add', message: { id: 'l5', author: 'Agent', text: 'Spacing is fixed. 12 checks passed.', time: '10:53', trace: true } },
    { do: 'add', message: { id: 'l8', author: 'Agent', text: 'Ship the score fix now or after the gate?', time: '10:54', details: 'Two ways to go:\n- A) Now: users get the fix today, but the gate has not seen it.\n- B) After the gate: about 20 minutes later, and it ships with a green run.' } },
    { do: 'typing', who: 'Validator is typing…' },
    { do: 'add', message: { id: 'l9', author: 'Validator', replyTo: 'l8', text: 'After the gate. The last two score changes both broke the Trace tab on first run, and the gate catches exactly that. Twenty minutes is cheap next to a rollback, and nobody is blocked on the score today. If the gate fails, fix forward and rerun it before shipping.', time: '10:54' } },
    { do: 'add', message: { id: 'l7', author: 'You', text: 'thanks', time: '10:55', delivery: 'posted' } },
    { do: 'react', id: 'l7', emoji: '🙏', by: 'Validator', after: 1200 },
    { do: 'deliver', id: 'l7', tool: 'commentary', after: 1500 },
];
export const awayMembers = defaultMembers.map(m => m.kind === 'agent' ? { ...m, presence: 'left' } : m);
export const awayMessages = [
    { kind: 'day', text: 'Today' }, { kind: 'system', text: 'Agent left — joins again when you message it' },
    { id: 'q1', author: 'You', text: '@Validator quick quiz: what happens when a gate fails?', time: '18:02', delivery: 'posted' },
    { id: 'q2', author: 'Validator', text: 'Who sees a failed gate first? The Agent, it retries once.', time: '18:02' },
    { id: 'q2b', author: 'Validator', text: 'When does it stop? After two failures it asks you.', time: '18:02' },
    { id: 'q3', author: 'You', quote: { author: 'Validator', text: 'Who sees a failed gate first?' }, text: 'Wrong. You see it first, then the Agent.', time: '18:04', delivery: 'posted' },
    { id: 'q4', author: 'Validator', text: 'Got it, I had that backwards.', replyTo: 'q3', time: '18:04' },
    { kind: 'memory', text: 'Validator memory updated: failed gates go to you first' },
];
export const scenarios = { Full: { messages: fullConversation, unread: 3 }, Away: { messages: awayMessages, members: awayMembers, draft: '@' }, Light: { messages: today, theme: 'light' }, Proxy: { messages: today, moderator: 'Validator' }, Empty: { messages: [] } };
