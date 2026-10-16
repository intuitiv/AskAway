import { mountTalk } from '../prototypes/mount.js';
export default { title: 'AITalk/Trace tab', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };
export const MainAgentOnly = { name: 'Main agent only', render: () => mountTalk({ traceOnly: true }) };
export const MainWorkersAndValidator = { name: 'Main agent only (Trace tab)', render: () => mountTalk({ traceOnly: true }) };
