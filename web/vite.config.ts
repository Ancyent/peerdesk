import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const deployConfig = path.resolve(__dirname, '../deploy/config.json')
const require = createRequire(import.meta.url)

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
    alias: [
      { find: '@pd/ui', replacement: path.resolve(__dirname, '../shared/ui') },
      // shared/ui has no node_modules of its own; its bare `react`/`react-dom`
      // imports (including the auto-injected jsx-runtime subpaths) must
      // resolve against the host app's copy rather than walking up past
      // web/. Resolved to exact files (via require.resolve) so in-tree
      // imports of the same specifiers keep working unchanged.
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
      { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
      { find: /^react-dom$/, replacement: require.resolve('react-dom') },
      { find: /^react$/, replacement: require.resolve('react') },
    ],
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
