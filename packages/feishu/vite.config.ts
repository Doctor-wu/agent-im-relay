import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    dts: true,
    deps: {
      alwaysBundle: [/^@agent-im-relay\//],
    },
  },
});
