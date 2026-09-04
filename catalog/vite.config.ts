import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // The purpose log lives in the local mcpproxy (`npm run ui` there, port 3848). When it is
      // running the Changes tab shows live history; when it is not, the request fails and the
      // committed snapshot in src/data/context-log.ts stands in.
      '/mcpproxy': {
        target: 'http://127.0.0.1:3848',
        rewrite: (route) => route.replace(/^\/mcpproxy/, ''),
      },
    },
  },
})
