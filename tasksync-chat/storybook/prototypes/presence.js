import { escapeHtml } from './talk.js';

export const presenceStates = [
    { id: 'here', label: 'Available', meaning: 'You are here and in charge.', icon: '✓', colour: '#22c55e', accent: '#14b8a6' },
    { id: 'away', label: 'Away (notify on phone)', meaning: 'Keep working; notify you on your phone.', icon: '◷', colour: '#f59e0b', accent: '#14b8a6' },
    { id: 'awayValidator', label: 'Away, Validator in charge', meaning: 'Validator answers for you when live is enabled.', icon: '⛨', colour: '#8b5cf6', accent: '#c4b5fd' },
    { id: 'offline', label: 'Offline', meaning: 'You are not reachable; hold questions for later.', icon: '×', colour: '#9ca3af', accent: '#64748b' },
];
export const resetOptions = [
    { id: '30m', label: '30 min', minutes: 30 }, { id: '1h', label: '1 h', minutes: 60 },
    { id: '2h', label: '2 h', minutes: 120 }, { id: 'today', label: 'Today' }, { id: 'never', label: 'Never' },
];
const titleIcons = [
    { label: 'Settings', icon: '⚙' }, { label: 'View History', icon: '↶' }, { label: 'New session', icon: '+' },
];

export function badgeHtml(state) {
    return `<span class="presence-badge" style="--badge:${escapeHtml(state.colour)}" role="img" aria-label="${escapeHtml(state.label)}">${escapeHtml(state.icon)}</span>`;
}

export function createPresence({ states = presenceStates, mode = states[0].id, reset = 'never', now = Date.now, name = 'Alex Morgan', open = false, theme = 'dark' } = {}) {
    if (!states.some(state => state.id === mode)) throw new Error('Unknown presence state');
    let value = { mode, reset, expiresAt: null, open, focusIndex: states.findIndex(state => state.id === mode), name, theme };
    const expiry = id => {
        const option = resetOptions.find(item => item.id === id);
        if (!option) throw new Error('Unknown reset option');
        if (option.minutes) return now() + option.minutes * 60000;
        if (id === 'today') { const end = new Date(now()); end.setHours(24, 0, 0, 0); return end.getTime(); }
        return null;
    };
    const close = () => { value = { ...value, open: false }; };
    const choose = id => {
        const index = states.findIndex(state => state.id === id);
        if (index < 0) throw new Error('Unknown presence state');
        value = { ...value, mode: id, focusIndex: index, open: false, expiresAt: expiry(value.reset) };
    };
    const setReset = id => { value = { ...value, reset: id, expiresAt: expiry(id) }; };
    setReset(reset);
    return {
        snapshot: () => ({ ...value }),
        html: () => presenceHtml(value, states),
        toggle() { value = { ...value, open: !value.open, focusIndex: states.findIndex(state => state.id === value.mode) }; },
        close, choose, setReset,
        key(key) {
            if (key === 'Escape') { close(); return true; }
            if (!value.open && (key === 'Enter' || key === ' ')) { value = { ...value, open: true }; return true; }
            if (!value.open) return false;
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                value = { ...value, focusIndex: (value.focusIndex + (key === 'ArrowDown' ? 1 : -1) + states.length) % states.length }; return true;
            }
            if (key === 'Home' || key === 'End') { value = { ...value, focusIndex: key === 'Home' ? 0 : states.length - 1 }; return true; }
            if (key === 'Enter' || key === ' ') { choose(states[value.focusIndex].id); return true; }
            return false;
        },
        expire() { if (value.expiresAt !== null && now() >= value.expiresAt) { value = { ...value, mode: states[0].id, expiresAt: null, reset: 'never', focusIndex: 0 }; } },
    };
}

export function presenceHtml(value, states = presenceStates) {
    const current = states.find(state => state.id === value.mode);
    const initials = value.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('');
    const avatar = `<span class="presence-avatar" aria-hidden="true">${escapeHtml(initials)}</span>`;
    const flyout = value.open ? `<section class="presence-flyout" aria-label="Your availability">
        <div class="presence-profile">${avatar}<div><strong>${escapeHtml(value.name)}</strong><span>Personal availability</span></div></div>
        <div class="presence-current">${badgeHtml(current)}<strong>${escapeHtml(current.label)}</strong></div>
        <div class="presence-menu" role="menu" aria-label="Choose availability">${states.map((state, index) => `<button type="button" role="menuitemradio" aria-checked="${state.id === value.mode}" tabindex="${index === value.focusIndex ? 0 : -1}" data-presence="${escapeHtml(state.id)}">${badgeHtml(state)}<span><strong>${escapeHtml(state.label)}</strong><small>${escapeHtml(state.meaning)}</small></span><span class="presence-selected" aria-hidden="true">${state.id === value.mode ? '✓' : ''}</span></button>`).join('')}</div>
        <label class="presence-reset">Reset status after<select aria-label="Reset status after">${resetOptions.map(option => `<option value="${option.id}"${option.id === value.reset ? ' selected' : ''}>${option.label}</option>`).join('')}</select></label>
        <p class="presence-expiry">${value.expiresAt === null ? 'Until you change it' : `Resets at ${escapeHtml(new Date(value.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}`}</p>
    </section>` : '';
    return `<div class="presence-widget theme-${escapeHtml(value.theme)} avail-${escapeHtml(value.mode)}" style="--presence:${escapeHtml(current.colour)};--presence-accent:${escapeHtml(current.accent || current.colour)}">
        <header class="presence-titlebar"><strong>ASKAWAY</strong><div class="presence-actions">${titleIcons.map(item => `<button type="button" class="presence-icon" aria-label="${item.label}" title="${item.label}">${item.icon}</button>`).join('')}<div class="presence-anchor"><button type="button" class="presence-trigger" aria-haspopup="menu" aria-expanded="${value.open}" aria-label="${escapeHtml(value.name)}: ${escapeHtml(current.label)}" title="Change availability">${avatar}${badgeHtml(current)}</button>${flyout}</div></div></header>
        <div class="presence-preview"><span class="presence-eyebrow">YOUR WORKSPACE</span><h2>Room to focus.</h2><p>Your availability stays with you.<br>Choose who takes charge, without leaving the conversation.</p><div class="presence-status">${badgeHtml(current)}<span>${escapeHtml(current.label)}</span></div><div class="presence-placeholder"><span>AITalk</span><p>The team is ready when you are.</p></div></div>
    </div>`;
}

export function mountPresence(options = {}) {
    const root = document.createElement('div');
    const control = createPresence(options);
    const paint = focus => {
        root.innerHTML = control.html();
        if (focus) {
            const value = control.snapshot();
            (value.open ? root.querySelectorAll('[data-presence]')[value.focusIndex] : root.querySelector('.presence-trigger'))?.focus();
        }
    };
    root.addEventListener('click', event => {
        if (event.target.closest('.presence-trigger')) { control.toggle(); paint(control.snapshot().open); }
        const button = event.target.closest('[data-presence]');
        if (button) { control.choose(button.dataset.presence); paint(true); }
    });
    root.addEventListener('change', event => { if (event.target.matches('select')) { control.setReset(event.target.value); paint(); root.querySelector('select')?.focus(); } });
    root.addEventListener('keydown', event => {
        if (!event.target.closest('.presence-trigger, [data-presence]') && event.key !== 'Escape') return;
        if (control.key(event.key)) { event.preventDefault(); paint(true); }
    });
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) { control.close(); paint(); } });
    paint();
    return root;
}
