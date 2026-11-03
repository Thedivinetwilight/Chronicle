import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Hosts that may proxy the dev/preview server (Arena sandbox live preview uses
 * `https://{port}-{sandboxId}.e2b.app`). Vite >= 6 rejects unknown Host headers
 * by default, so the preview domains are explicitly allowed.
 */
const allowedHosts = ['.e2b.app', 'localhost', '127.0.0.1'];

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    strategies: 'generateSW',
    includeAssets: ['favicon.svg', 'icons/*.png', 'icons/*.svg'],
    manifest: {
      name: 'Chronicle',
      short_name: 'Chronicle',
      description:
        'A quiet, offline-first record of your projects, journal, experiments, and discoveries.',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      display_override: ['window-controls-overlay', 'standalone'],
      orientation: 'any',
      background_color: '#fbfaf8',
      theme_color: '#fbfaf8',
      categories: ['productivity'],
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }
      ],
      screenshots: []
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      runtimeCaching: [
        {
          // The app never calls a remote API in v0.1; same-origin GETs are
          // cache-first so the shell and precached assets work offline.
          urlPattern: ({ sameOrigin }) => sameOrigin,
          handler: 'CacheFirst',
          options: {
            cacheName: 'chronicle-runtime',
            expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] }
          }
        }
      ]
    },
    devOptions: { enabled: false }
  })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Split the two dominant dependencies so the entry chunk stays small
        // and returning visitors only re-download what actually changed.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          if (/[\\/]node_modules[\\/](dexie|dexie-react-hooks)[\\/]/.test(id)) return 'storage';
          return undefined;
        }
      }
    }
  }
});
