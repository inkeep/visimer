import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { heroBootHtml } from './src/hero-diagram'

const BOOT_MARKER = '<!--hero-boot-->'

/**
 * Inlines the first-paint hero into index.html so the served document already
 * contains a headline. Generating it from the same module the app renders from
 * is the point: a hand-maintained copy in index.html drifts from the hero it is
 * standing in for, and the drift only shows up in the first second of a cold
 * load, which is exactly where nobody looks.
 */
function heroBoot(): Plugin {
  return {
    name: 'visimer-hero-boot',
    transformIndexHtml(html) {
      if (!html.includes(BOOT_MARKER)) {
        throw new Error(`index.html is missing the ${BOOT_MARKER} placeholder`)
      }
      // Replacer function, not a string: a string replacement would give `$&`,
      // `$'` and friends their special meaning, so the day a hero string gains a
      // `$` the served document would be silently corrupted — and only in the
      // pre-React copy, which is the one nobody looks at in normal dev.
      return html.replace(BOOT_MARKER, () => heroBootHtml())
    },
  }
}

export default defineConfig({
  plugins: [react(), heroBoot()],
  optimizeDeps: {
    exclude: ['@visimer/core', '@visimer/dom', '@visimer/react', '@visimer/codemirror'],
    include: ['mermaid', 'react', 'react-dom', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@lezer/highlight'],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
})
