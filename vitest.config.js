import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    silent: false,
  },
  server: {
    port: 5000,
    strictPort: true // если занят — сразу выдаст ошибку, а не будет бесконечно думать
  }
});
