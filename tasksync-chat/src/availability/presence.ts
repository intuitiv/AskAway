export const presenceStates = [
    { id: 'here', label: 'Available', meaning: 'You are here and in charge.', icon: '✓', colour: '#22c55e' },
    { id: 'away', label: 'Away (notify on phone)', meaning: 'Keep working; notify you on your phone.', icon: '◷', colour: '#f59e0b' },
    { id: 'awayValidator', label: 'Away, Validator in charge', meaning: 'Validator answers for you when live is enabled.', icon: '⛨', colour: '#8b5cf6' },
    { id: 'offline', label: 'Offline', meaning: 'You are not reachable; hold questions for later.', icon: '×', colour: '#9ca3af' },
] as const;
