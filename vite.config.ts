import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  base: './',
  plugins: [
    vueDevTools({
      componentInspector: true,
    }),
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: '吉星派对回放匿名化',
        short_name: '回放匿名化',
        description: '在浏览器本地处理吉星派对回放文件。',
        theme_color: '#0f0a1d',
        background_color: '#0f0a1d',
        display: 'standalone',
        lang: 'zh-CN',
        scope: './',
        start_url: './',
        icons: [
          {
            src: 'pwa-icon-192.webp',
            sizes: '192x192',
            type: 'image/webp',
            purpose: 'any maskable',
          },
          {
            src: 'pwa-icon-512.webp',
            sizes: '512x512',
            type: 'image/webp',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
    }),
  ],
  build: {
    target: 'es2020',
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
