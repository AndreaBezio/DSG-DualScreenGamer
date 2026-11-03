import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts', 'apps/worker/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    fileParallelism: false,
  },
});
