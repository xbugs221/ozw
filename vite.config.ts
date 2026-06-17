/**
 * PURPOSE: Configure the Vite dev server and production build for CCUI.
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const host = process.env.HOST || env.HOST || '0.0.0.0'
  // When binding to all interfaces (0.0.0.0), proxy should connect to localhost
  // Otherwise, proxy to the specific host the backend is bound to
  const proxyHost = host === '0.0.0.0' ? 'localhost' : host
  const port = process.env.PORT || env.PORT || 3001

  return {
    plugins: [react()],
    server: {
      host,
      port: parseInt(process.env.VITE_PORT || env.VITE_PORT) || 5173,
      watch: {
        ignored: [
          '**/.pnpm-store/**',
          '**/.tmp/**',
          '**/.playwright-cli/**',
          '**/dist/**',
          '**/dist-node/**',
          '**/tests/test-results/**',
          '**/node_modules/**',
        ],
      },
      proxy: {
        '/api': `http://${proxyHost}:${port}`,
        '/ws': {
          target: `ws://${proxyHost}:${port}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${port}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      // The current production entry bundle is intentionally large because the app
      // ships multiple rich editors and terminal integrations in one screen.
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
