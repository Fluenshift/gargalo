/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // The libraries change less often than the game: in their own file they stay cached across deploys.
      output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      // Logic lives in .ts; React screens (.tsx) are checked with the verify-ui skill, not unit tests.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/sim/worker.ts', 'src/oficina/oficinaWorker.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
