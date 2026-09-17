import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    // P6.4: installable PWA — app shell works offline, API needs the server
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'scio_logo.png'],
      manifest: {
        name: 'Scio - AI Learning Hub',
        short_name: 'Scio',
        description:
          'Your AI Learning Hub - Generate practice tests, create flashcards, and organize your learning journey',
        theme_color: '#080c16',
        background_color: '#080c16',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        // The API is dynamic (self-hosted via Tailscale) — never served
        // from cache, offline API calls simply fail and react-query
        // retries when the connection returns
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
