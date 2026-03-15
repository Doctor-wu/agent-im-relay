import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: true,
    deps: {
      alwaysBundle: [/.*/],
    },
    outputOptions: {
      inlineDynamicImports: true,
    },
  },
});
