import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      'workspace-build': {
        cache: false,
        command: "pnpm --recursive --filter './packages/*' --filter './apps/*' build",
      },
      'workspace-test': {
        cache: false,
        command: "pnpm --recursive --filter './packages/*' --filter './apps/*' test",
      },
    },
  },
})
