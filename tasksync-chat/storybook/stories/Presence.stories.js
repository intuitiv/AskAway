import { mountPresence } from '../prototypes/presence.js';
import '../prototypes/presence.css';

export default { title: 'AITalk/Availability', parameters: { layout: 'centered', backgrounds: { default: 'dark' } } };
export const Available = { render: () => mountPresence({ mode: 'here' }) };
export const Away = { render: () => mountPresence({ mode: 'away' }) };
export const ValidatorInCharge = { render: () => mountPresence({ mode: 'awayValidator' }) };
export const Offline = { render: () => mountPresence({ mode: 'offline' }) };
export const FlyoutOpen = { render: () => mountPresence({ open: true, mode: 'here' }) };
export const LightTheme = { parameters: { backgrounds: { default: 'light' } }, render: () => mountPresence({ theme: 'light', open: true, mode: 'away' }) };
