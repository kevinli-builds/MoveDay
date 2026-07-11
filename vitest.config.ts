import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['app/lib/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
