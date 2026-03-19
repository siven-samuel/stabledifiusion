import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  base: '/stabledifiusion/',
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(new Date().toISOString()),
  },
})
