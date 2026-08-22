import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '游伴 Youban',
        short_name: '游伴',
        description: 'AI 旅行规划与陪伴',
        lang: 'zh-CN',
        theme_color: '#f7f1e8',
        background_color: '#f7f1e8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Optional code highlighting/diagram engines are loaded on demand, not precached.
        globIgnores: ['assets/shiki-*.js', 'assets/mermaid-*.js'],
        // three.js splash chunk 较大,放宽单文件上限保证离线完整
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/redoc/],
        runtimeCaching: [
          {
            urlPattern: /\/api\/trip\/status\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'trip-status',
              expiration: { maxEntries: 20 },
              networkTimeoutSeconds: 4,
            },
          },
          {
            urlPattern: /\/api\/trip\/history.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'trip-history',
              expiration: { maxEntries: 4 },
              networkTimeoutSeconds: 4,
            },
          },
          {
            urlPattern: /\/api\/settings$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'runtime-settings', expiration: { maxEntries: 2 } },
          },
          {
            urlPattern: /\/api\/images\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'poi-images',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@shikijs/core', replacement: resolve(__dirname, 'src/vendor/shiki-core-disabled.ts') },
      { find: '@', replacement: resolve(__dirname, 'src') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
        ws: true
      },
      '/health': {
        target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('three')) return 'three'
          if (id.includes('mermaid')) return 'mermaid'
          if (id.includes('shiki') || id.includes('@shikijs')) return 'shiki'
          if (id.includes('x-markdown-vue')) return 'markdown'
          if (id.includes('vue-element-plus-x') || id.includes('element-plus')) return 'chat-ui'
          if (id.includes('ant-design-vue') || id.includes('@ant-design')) return 'ant-design'
          if (id.includes('vue')) return 'vue'
          return 'vendor'
        },
      },
    },
  },
})
