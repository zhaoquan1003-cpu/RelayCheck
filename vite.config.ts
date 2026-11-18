import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode, command, isPreview }) => ({
  // Keep local development on / so its API proxy continues to match /api.
  base: command === 'build' || isPreview ? loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH || '/' : '/',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
}))
