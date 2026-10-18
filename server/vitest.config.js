import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 15000,
    // Cada archivo levanta su propio servidor; en serie para que la medición de ticks sea estable.
    fileParallelism: false,
  },
});
