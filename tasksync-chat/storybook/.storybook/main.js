import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const USER_PROFILE_DIR = path.join(os.homedir(), '.askaway', 'profile');
export const USER_PROFILE_STATIC_MOUNT = '/user-profile';

const hasUserProfileDir = fs.existsSync(USER_PROFILE_DIR);

/** @type { import('@storybook/html-vite').StorybookConfig } */
export default {
    framework: '@storybook/html-vite',
    stories: ['../stories/**/*.stories.js'],
    staticDirs: hasUserProfileDir
        ? [{ from: USER_PROFILE_DIR, to: USER_PROFILE_STATIC_MOUNT }]
        : [],
    // Stories import the real webview sources from the extension package one level up.
    viteFinal: async (config) => ({
        ...config,
        server: {
            ...config.server,
            fs: {
                allow: ['..', ...(hasUserProfileDir ? [USER_PROFILE_DIR] : [])],
            },
        },
    }),
};
