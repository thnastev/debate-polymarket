import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tradeQueue persists to localStorage, so its tests need a DOM.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
