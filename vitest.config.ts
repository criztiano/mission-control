import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(async () => {
  // `vite-tsconfig-paths` is ESM-only; loading it via dynamic import avoids
  // Vite's config bundler trying to `require()` it.
  const { default: tsconfigPaths } = await import('vite-tsconfig-paths')

  return {
    plugins: [react(), tsconfigPaths()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }
})
