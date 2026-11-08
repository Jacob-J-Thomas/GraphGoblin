import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { API_PREFIXES } from './src/api/prefixes.js';
import { fontBootScript } from './src/lib/font.js';
import { themeBootScript } from './src/lib/theme.js';
import { appChromeColors } from './src/styles/palette.js';

export const GOBLIN_BASE = '/goblin/';
const directory = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const tokens = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
const dark = appChromeColors(tokens, 'dark');
const light = appChromeColors(tokens, 'light');

function appearanceHead(): Plugin {
  return {
    name: 'goblin-appearance-head',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n` +
          `<meta name="theme-color" content="${dark.themeColor}" data-dark="${dark.themeColor}" data-light="${light.themeColor}" />\n` +
          `<script>${themeBootScript()}</script>\n<script>${fontBootScript(GOBLIN_BASE)}</script>`,
      ),
  };
}

export default defineConfig({
  root: directory('./goblin'),
  publicDir: directory('./public'),
  base: GOBLIN_BASE,
  resolve: {
    alias: [
      { find: /^\/src\/goblin\/main\.tsx$/, replacement: directory('./src/goblin/main.tsx') },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    appearanceHead(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'generateSW',
      scope: GOBLIN_BASE,
      base: GOBLIN_BASE,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: GOBLIN_BASE,
        name: 'Goblin',
        short_name: 'Goblin',
        description: 'Chat with your GraphGoblin gateway.',
        start_url: GOBLIN_BASE,
        scope: GOBLIN_BASE,
        display: 'standalone',
        background_color: dark.backgroundColor,
        theme_color: dark.themeColor,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cacheId: 'graphgoblin-goblin',
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: `${GOBLIN_BASE}index.html`,
        navigateFallbackAllowlist: [/^\/goblin\/[^.]*$/],
        // No runtime caches or Background Sync: no credentials, transcript, upload, or API request
        // enters Cache Storage, and reconnect never replays a mutation.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5174,
    fs: { allow: [directory('../..')] },
    proxy: Object.fromEntries(
      API_PREFIXES.map((prefix) => [prefix, process.env['GG_API_URL'] ?? 'http://127.0.0.1:4747']),
    ),
  },
  build: {
    outDir: directory('./dist-goblin'),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
});
