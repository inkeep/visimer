import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCanvasView, type MermaidLike, type Tool, type ViewHooks } from '@visimer/dom'

export { MermaidWysiwygEditor } from '@visimer/core'
export { MermaidCanvasView } from '@visimer/dom'

/**
 * Own an editor instance in React. Re-renders on document and selection
 * changes; dispatch ops or bind the code string to your own state.
 */
export function useMermaidEditor(initialCode: string) {
  const [editor] = useState(() => new MermaidWysiwygEditor({ code: initialCode }))
  const code = useSyncExternalStore(
    (cb) => editor.on('change', cb),
    () => editor.code,
  )
  const selection = useSyncExternalStore(
    (cb) => editor.on('selectionChange', cb),
    () => editor.selection,
  )
  return { editor, code, selection }
}

export interface MermaidWysiwygProps {
  /** mermaid source (controlled when `onCodeChange` is provided) */
  code: string
  onCodeChange?: (code: string) => void
  /** your mermaid instance (`import mermaid from 'mermaid'`) */
  mermaid: MermaidLike
  /** passed to `mermaid.initialize` (theme, curves, securityLevel, …) */
  mermaidConfig?: Record<string, unknown>
  accentColor?: string
  readOnly?: boolean
  /** fit-to-canvas + drag-pan + pinch/ctrl-wheel zoom with corner controls */
  panZoom?: boolean
  tool?: Tool
  hooks?: ViewHooks
  onSelectionChange?: (entityIds: string[]) => void
  /** access the underlying editor and canvas view */
  onReady?: (editor: MermaidWysiwygEditor, view: MermaidCanvasView) => void
  className?: string
  style?: CSSProperties
}

/**
 * Drop-in visual Mermaid editor: full WYSIWYG canvas bound to a `code` prop.
 *
 * ```tsx
 * const [code, setCode] = useState('flowchart TD\n  A --> B')
 * <MermaidWysiwyg code={code} onCodeChange={setCode} mermaid={mermaid} />
 * ```
 */
export function MermaidWysiwyg(props: MermaidWysiwygProps) {
  const { code, onCodeChange, mermaid, mermaidConfig, accentColor, readOnly, panZoom, tool, hooks, onSelectionChange, onReady, className, style } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MermaidWysiwygEditor | null>(null)
  const viewRef = useRef<MermaidCanvasView | null>(null)
  const onCodeChangeRef = useRef(onCodeChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  onCodeChangeRef.current = onCodeChange
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    if (!hostRef.current) return
    const editor = new MermaidWysiwygEditor({ code })
    const view = new MermaidCanvasView({
      editor,
      container: hostRef.current,
      mermaid,
      mermaidConfig,
      accentColor,
      readOnly,
      panZoom,
      hooks,
    })
    editorRef.current = editor
    viewRef.current = view
    const offChange = editor.on('change', ({ code: next, origin }) => {
      if (origin !== 'external') onCodeChangeRef.current?.(next)
    })
    const offSelection = editor.on('selectionChange', ({ entityIds }) => {
      onSelectionChangeRef.current?.(entityIds)
    })
    onReady?.(editor, view)
    return () => {
      offChange()
      offSelection()
      view.destroy()
      editorRef.current = null
      viewRef.current = null
    }
    // the view is created once; prop updates are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mermaid])

  useEffect(() => {
    const editor = editorRef.current
    if (editor && code !== editor.code) editor.setCode(code, 'external')
  }, [code])

  useEffect(() => {
    if (tool) viewRef.current?.setTool(tool)
  }, [tool])

  useEffect(() => {
    viewRef.current?.setReadOnly(readOnly ?? false)
  }, [readOnly])

  useEffect(() => {
    if (accentColor) viewRef.current?.setAccentColor(accentColor)
  }, [accentColor])

  useEffect(() => {
    if (mermaidConfig) viewRef.current?.setMermaidConfig(mermaidConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(mermaidConfig)])

  useEffect(() => {
    viewRef.current?.setHooks(hooks ?? {})
  }, [hooks])

  return <div ref={hostRef} className={className} style={{ minHeight: 240, ...style }} />
}

export interface MermaidCanvasProps {
  /** an editor you own (e.g. from `useMermaidEditor`) */
  editor: MermaidWysiwygEditor
  mermaid: MermaidLike
  mermaidConfig?: Record<string, unknown>
  accentColor?: string
  readOnly?: boolean
  /** fit-to-canvas + drag-pan + pinch/ctrl-wheel zoom with corner controls */
  panZoom?: boolean
  hooks?: ViewHooks
  onReady?: (view: MermaidCanvasView) => void
  className?: string
  style?: CSSProperties
}

/** Canvas-only binding for an editor instance you manage yourself. */
export function MermaidCanvas(props: MermaidCanvasProps) {
  const { editor, mermaid, mermaidConfig, accentColor, readOnly, panZoom, hooks, onReady, className, style } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MermaidCanvasView | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const view = new MermaidCanvasView({
      editor,
      container: hostRef.current,
      mermaid,
      mermaidConfig,
      accentColor,
      readOnly,
      panZoom,
      hooks,
    })
    onReady?.(view)
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, mermaid])

  useEffect(() => {
    viewRef.current?.setHooks(hooks ?? {})
  }, [hooks])

  useEffect(() => {
    viewRef.current?.setReadOnly(readOnly ?? false)
  }, [readOnly])

  useEffect(() => {
    if (accentColor) viewRef.current?.setAccentColor(accentColor)
  }, [accentColor])

  useEffect(() => {
    if (mermaidConfig) viewRef.current?.setMermaidConfig(mermaidConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(mermaidConfig)])

  return <div ref={hostRef} className={className} style={{ minHeight: 240, ...style }} />
}
