import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: {
    __BUILD_TIME__: JSON.stringify(
      (() => {
        const d = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      })()
    ),
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    // vite-plugin-singlefile requires all assets to be inlined
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
  },
})
