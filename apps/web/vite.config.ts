import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { appChromeColors } from './src/styles/palette.js';

/**
 * The app is served by the API process under `/app/` (GG_WEB_DIST), so its routes never collide
 * with API paths such as `/loops` or `/runs`. In development Vite serves it and proxies the API.
 */
export const APP_BASE = '/app/';

const API_TARGET = process.env['GG_API_URL'] ?? 'http://127.0.0.1:4747';
const API_PREFIXES = [
  '/loops',
  '/runs',
  '/settings',
  '/secrets',
  '/api-keys',
  '/model-catalog',
  '/events',
  '/harness',
  '/healthz',
  '/version',
  '/openapi.json',
];

/**
 * The colours that cannot be CSS variables (the `theme-color` meta tag and the web manifest) are
 * read from the design tokens at build time, so they follow the palette: the dark theme's header
 * (`--surface-inverse`) and page (`--surface-app`), dark being the default theme (#7, #11).
 */
const CHROME = appChromeColors(
  readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8'),
);

/** Adds `<meta name="theme-color">` with the palette's header colour to index.html. */
function themeColorMeta(): Plugin {
  return {
    name: 'graphgoblin-theme-color',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'theme-color', content: CHROME.themeColor }, injectTo: 'head' },
    ],
  };
}

export default defineConfig({
  base: APP_BASE,
  plugins: [
    react(),
    tailwindcss(),
    themeColorMeta(),
    VitePWA({
      registerType: 'prompt',
      // The app registers the worker itself through workbox-window (src/pwa/register.ts) so the
      // update flow is explicit and testable.
      injectRegister: false,
      strategies: 'generateSW',
      scope: APP_BASE,
      base: APP_BASE,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        id: APP_BASE,
        name: 'GraphGoblin',
        short_name: 'GraphGoblin',
        description: 'Design, run, and observe agent loops.',
        start_url: APP_BASE,
        scope: APP_BASE,
        display: 'standalone',
        background_color: CHROME.backgroundColor,
        theme_color: CHROME.themeColor,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell only. API responses are never cached: there is no runtime
        // caching, and navigations outside /app/ are never answered from the cache.
        // The fonts are part of the shell, so the offline app keeps its typeface.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: `${APP_BASE}index.html`,
        navigateFallbackAllowlist: [/^\/app\//],
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
    port: 5173,
    proxy: Object.fromEntries(API_PREFIXES.map((prefix) => [prefix, API_TARGET])),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
});
