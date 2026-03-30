import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    // En desarrollo local, el proxy reenvía /api al backend Express
    // para evitar CORS y hacer funcionar las cookies HttpOnly (mismo origen)
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/tiles': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
