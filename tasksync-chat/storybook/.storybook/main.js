/** @type { import('@storybook/html-vite').StorybookConfig } */
export default {
    framework: '@storybook/html-vite',
    stories: ['../stories/**/*.stories.js'],
    // Stories import the real webview sources from the extension package one level up.
    viteFinal: async (config) => ({ ...config, server: { ...config.server, fs: { allow: ['..'] } } }),
};
