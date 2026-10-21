import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Test configuration is deliberately separate from the app build config: the PWA
 * plugin has no business running during unit tests.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    restoreMocks: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
});
