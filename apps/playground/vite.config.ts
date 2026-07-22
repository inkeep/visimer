import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@visimer/core', '@visimer/dom', '@visimer/codemirror', '@visimer/react'],
    include: ['mermaid', '@mermaid-js/mermaid-zenuml', 'react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
