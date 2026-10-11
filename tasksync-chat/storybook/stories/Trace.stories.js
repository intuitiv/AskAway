import { mountTalk } from '../prototypes/mount.js';
export default { title: 'AITalk/Trace tab', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };
export const MainWorkersAndValidator = { render: () => mountTalk({ traceOnly: true }) };
