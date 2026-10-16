// Single portrait fixture lookup for Storybook Team & AITalk views.
// Swapping in generated images is a one-file change in AVATAR_FIXTURES below.

function portraitSvg({ id, bgStart, bgEnd, skin, hair, shirt, accent, glasses = false, hairStyle = 'short' }) {
    const hairPath = hairStyle === 'long'
        ? `<path d="M28 40c0-15 9-24 20-24s20 9 20 24c0 8-2 16-5 20-1-8-3-14-15-14s-14 6-15 14c-3-4-5-12-5-20z" fill="${hair}"/>`
        : hairStyle === 'bun'
            ? `<circle cx="48" cy="14" r="7" fill="${hair}"/><path d="M31 35c0-11 8-18 17-18s17 7 17 18c-4-5-10-7-17-7s-13 2-17 7z" fill="${hair}"/>`
            : `<path d="M31 34c0-11 8-18 17-18s17 7 17 18c-3-4-9-6-17-6s-14 2-17 6z" fill="${hair}"/>`;
    const glassesMarkup = glasses
        ? `<g stroke="${accent}" stroke-width="1.8" fill="none"><rect x="36" y="33" width="9" height="6" rx="2"/><rect x="51" y="33" width="9" height="6" rx="2"/><line x1="45" y1="36" x2="51" y2="36"/></g>`
        : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" data-avatar-fixture="${id}">` +
        `<defs><linearGradient id="bg-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bgStart}"/><stop offset="100%" stop-color="${bgEnd}"/></linearGradient></defs>` +
        `<rect width="96" height="96" rx="18" fill="url(#bg-${id})"/>` +
        `<path d="M20 88c4-17 15-25 28-25s24 8 28 25" fill="${shirt}"/>` +
        `<circle cx="48" cy="38" r="16" fill="${skin}"/>` +
        hairPath +
        `<circle cx="42" cy="36" r="2" fill="#0f172a"/><circle cx="54" cy="36" r="2" fill="#0f172a"/>` +
        glassesMarkup +
        `<path d="M43 44c3 2.5 7 2.5 10 0" stroke="#0f172a" stroke-width="2" fill="none" stroke-linecap="round"/>` +
        `<circle cx="78" cy="18" r="6" fill="${accent}" opacity="0.85"/>` +
        `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const USER_PROFILE_RUNTIME_SRC = '/user-profile/avatar.png';
export const USER_PROFILE_FALLBACK_AVATAR = portraitSvg({ id: 'user', bgStart: '#1d4ed8', bgEnd: '#0f172a', skin: '#f1c27d', hair: '#1e293b', shirt: '#38bdf8', accent: '#60a5fa', hairStyle: 'short' });

export const AVATAR_FIXTURES = {
    user: USER_PROFILE_FALLBACK_AVATAR,
    machs: USER_PROFILE_RUNTIME_SRC,
    mahesh: portraitSvg({ id: 'mahesh', bgStart: '#4338ca', bgEnd: '#1e1b4b', skin: '#d99b66', hair: '#111827', shirt: '#818cf8', accent: '#a5b4fc', glasses: true, hairStyle: 'short' }),
    bhaskar: portraitSvg({ id: 'bhaskar', bgStart: '#0369a1', bgEnd: '#0c4a6e', skin: '#e0ac69', hair: '#1f2937', shirt: '#38bdf8', accent: '#7dd3fc', hairStyle: 'short' }),
    priya: portraitSvg({ id: 'priya', bgStart: '#7e22ce', bgEnd: '#3b0764', skin: '#e0ac69', hair: '#1e1b4b', shirt: '#c084fc', accent: '#e9d5ff', hairStyle: 'bun' }),
    anika: portraitSvg({ id: 'anika', bgStart: '#0f766e', bgEnd: '#042f2e', skin: '#f1c27d', hair: '#27272a', shirt: '#2dd4bf', accent: '#99f6e4', glasses: true, hairStyle: 'long' }),
    diego: portraitSvg({ id: 'diego', bgStart: '#b45309', bgEnd: '#451a03', skin: '#e5b887', hair: '#1c1917', shirt: '#fbbf24', accent: '#fde68a', hairStyle: 'short' }),
    tara: portraitSvg({ id: 'tara', bgStart: '#15803d', bgEnd: '#052e16', skin: '#f3cfb3', hair: '#3f2314', shirt: '#4ade80', accent: '#bbf7d0', hairStyle: 'long' }),
    pavel: portraitSvg({ id: 'pavel', bgStart: '#b91c1c', bgEnd: '#450a0a', skin: '#f5d0b5', hair: '#44403c', shirt: '#f87171', accent: '#fecaca', glasses: true, hairStyle: 'short' }),
    rhea: portraitSvg({ id: 'rhea', bgStart: '#6d28d9', bgEnd: '#2e1065', skin: '#e0ac69', hair: '#18181b', shirt: '#a78bfa', accent: '#ddd6fe', hairStyle: 'long' }),
    paolo: portraitSvg({ id: 'paolo', bgStart: '#0e7490', bgEnd: '#164e63', skin: '#eab676', hair: '#292524', shirt: '#22d3ee', accent: '#a5f3fc', hairStyle: 'short' }),
    sana: portraitSvg({ id: 'sana', bgStart: '#be185d', bgEnd: '#500724', skin: '#e0ac69', hair: '#1f2937', shirt: '#f472b6', accent: '#fbcfe8', hairStyle: 'bun' }),
    shreya: portraitSvg({ id: 'shreya', bgStart: '#c2410c', bgEnd: '#431407', skin: '#d99b66', hair: '#171717', shirt: '#fb923c', accent: '#fed7aa', glasses: true, hairStyle: 'long' }),
    cathy: portraitSvg({ id: 'cathy', bgStart: '#1d4ed8', bgEnd: '#172554', skin: '#f3cfb3', hair: '#451a03', shirt: '#60a5fa', accent: '#bfdbfe', hairStyle: 'long' }),
};

export const USER_PROFILE_FIXTURE = {
    id: 'machs',
    name: 'Machs',
    sourcePath: '~/.askaway/profile/avatar.png',
    runtimeSrc: USER_PROFILE_RUNTIME_SRC,
    fixturePath: 'storybook/fixtures/avatars/user.svg',
    fallbackAvatar: USER_PROFILE_FALLBACK_AVATAR,
    avatar: AVATAR_FIXTURES.machs,
};

export function avatarFallbackFor(memberId) {
    const key = String(memberId || '').trim().toLowerCase();
    if (key === 'machs' || key === 'user' || key === 'you') {
        return USER_PROFILE_FALLBACK_AVATAR;
    }
    return AVATAR_FIXTURES[key] || null;
}

/**
 * Single lookup for any member/actor portrait fixture.
 * Returns the portrait URI if present in storybook/fixtures/avatars/, otherwise null (caller renders initials).
 */
export function avatarFor(memberId, overrides = null) {
    const rawKey = String(memberId || '').trim().toLowerCase();
    if (!rawKey) return null;
    const key = (rawKey === 'user' || rawKey === 'you') ? 'machs' : rawKey;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
        return overrides[key] || null;
    }
    return AVATAR_FIXTURES[key] || null;
}
