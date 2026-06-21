import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard talks only to the orchestrator (Python uAgents, :8000).
// We proxy /api -> :8000 so the browser needs no CORS and no API keys —
// the orchestrator is the single trusted reader/writer (Deadbolt invariant).
const ORCHESTRATOR = process.env.ORCHESTRATOR_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: ORCHESTRATOR,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
