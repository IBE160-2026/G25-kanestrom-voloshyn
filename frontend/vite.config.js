import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev only: the SPA calls /api on its own origin; Vite forwards it to uvicorn (AD-17).
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  // Frontend tests (spine › Tests): Vitest + Testing Library in jsdom, no backend or network.
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.js'],
  },
})
