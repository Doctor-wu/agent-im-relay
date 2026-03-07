import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@agent-im-relay/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@agent-im-relay/discord': fileURLToPath(new URL('../../packages/discord/src/index.ts', import.meta.url)),
      '@agent-im-relay/feishu': fileURLToPath(new URL('../../packages/feishu/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
