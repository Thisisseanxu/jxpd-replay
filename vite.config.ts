import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [
    vueDevTools({
      componentInspector: true,
    }),
    vue(),
  ],
  build: {
    target: 'es2020',
  },
})
