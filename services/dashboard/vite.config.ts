import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Local gateway by default; GATEWAY_URL=http://app.127.0.0.1.nip.io runs the dev UI against a cluster.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const gateway = env.GATEWAY_URL ?? 'http://localhost:8080'
const changeOrigin = gateway !== 'http://localhost:8080' // the Ingress routes by Host header

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: gateway, changeOrigin },
      '/mcp': { target: gateway, changeOrigin },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
