// Vitest harness configuration (S05).
// jsdom backs the window/DOM globals the popup and content scripts rely on;
// chrome + speechSynthesis doubles live in tests/helpers/chrome-mock.js.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    // S05 ships only the harness; S18/S19 add the actual test files.
    passWithNoTests: true,
  },
})
