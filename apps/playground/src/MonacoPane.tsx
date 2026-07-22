import { useEffect, useRef } from 'react'
import type { MermaidWysiwygEditor } from '@visimer/core'
import { bindMonaco, registerMermaidLanguage } from '@visimer/monaco'

/**
 * Monaco pane using @visimer/monaco. The app owns the Monaco setup
 * (lazy import, worker env, theme, create options); the package owns the sync.
 */
export function MonacoPane({ editor }: { editor: MermaidWysiwygEditor }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    let disposed = false
    let cleanup: (() => void) | null = null

    void (async () => {
      const monaco = await import('monaco-editor')
      const { default: EditorWorker } = await import('monaco-editor/esm/vs/editor/editor.worker?worker')
      ;(self as { MonacoEnvironment?: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() }
      if (disposed) return

      registerMermaidLanguage(monaco)
      monaco.editor.defineTheme('ink-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '666666', fontStyle: 'italic' },
          { token: 'string', foreground: 'f8b886' },
          { token: 'keyword', foreground: 'bf7af0' },
          { token: 'operator', foreground: '62dfa8' },
          { token: 'number', foreground: 'ff8fa3' },
        ],
        colors: {
          'editor.background': '#000000',
          'editor.foreground': '#ededed',
          'editorLineNumber.foreground': '#666666',
          'editorLineNumber.activeForeground': '#a1a1a1',
          'editorCursor.foreground': '#69a3ff',
          'editor.selectionBackground': '#ffffff22',
          'editor.lineHighlightBackground': '#ffffff08',
          'editorWidget.background': '#0a0a0a',
          'editorWidget.border': '#333333',
        },
      })

      const me = monaco.editor.create(host, {
        value: editor.code,
        language: 'mermaid',
        theme: 'ink-dark',
        fontSize: 13,
        fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        // the EditContext input path swallows keydown-based keybindings in some
        // browsers; the classic textarea input handles them reliably
        editContext: false,
        renderLineHighlightOnlyWhenFocus: true,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        folding: false,
        lineNumbersMinChars: 3,
        padding: { top: 8 },
      })
      const binding = bindMonaco(editor, me)

      cleanup = () => {
        binding.dispose()
        me.dispose()
      }
      if (disposed) {
        cleanup()
        cleanup = null
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
      cleanup = null
    }
  }, [editor])

  return <div className="codepane" ref={ref} />
}
