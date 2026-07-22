import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@visimer/core', '@visimer/dom', '@visimer/react', '@visimer/codemirror'],
    include: ['mermaid', 'react', 'react-dom', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@lezer/highlight'],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
