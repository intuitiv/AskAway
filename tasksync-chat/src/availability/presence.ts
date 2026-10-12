export const presenceStates = [
    { id: 'here', label: 'Available', meaning: 'You are here and in charge.', icon: '✓', colour: '#22c55e', accent: '#14b8a6' },
    { id: 'away', label: 'Away (notify on phone)', meaning: 'Keep working; notify you on your phone.', icon: '◷', colour: '#f59e0b', accent: '#14b8a6' },
    { id: 'awayValidator', label: 'Away, Validator in charge', meaning: 'Validator answers for you when live is enabled.', icon: '⛨', colour: '#8b5cf6', accent: '#c4b5fd' },
    { id: 'offline', label: 'Offline', meaning: 'You are not reachable; hold questions for later.', icon: '×', colour: '#9ca3af', accent: '#64748b' },
] as const;
