import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const deployConfig = path.resolve(__dirname, '../deploy/config.json')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'runtime-config',
      configureServer(server) {
        server.middlewares.use('/config.json', (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(fs.readFileSync(deployConfig, 'utf-8'))
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@pd/ui': path.resolve(__dirname, '../shared/ui'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_API ?? 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/ws': {
        target: process.env.VITE_PROXY_WS ?? 'ws://localhost:8001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
