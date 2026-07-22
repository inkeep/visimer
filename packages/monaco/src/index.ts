/**
 * Monaco binding for visimer, built on core's editor-agnostic
 * `bindTextPane` contract.
 *
 * The types below are structural on purpose: this package has no dependency
 * on `monaco-editor`, not even for types, so it never pins your Monaco
 * version or pulls a second copy into your bundle. Any real
 * `IStandaloneCodeEditor` satisfies `MonacoEditorLike` (there is a
 * compile-time conformance check against the real types in this package's
 * test suite).
 */

import { bindTextPane, type MermaidWysiwygEditor, type TextPaneBinding } from '@visimer/core'

export { mermaidMonarchTokens, registerMermaidLanguage, type MonacoNamespaceLike } from './language'

export interface MonacoRangeLike {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface MonacoPositionLike {
  lineNumber: number
  column: number
}

export interface MonacoDisposableLike {
  dispose(): void
}

export interface MonacoModelLike {
  getValue(): string
  setValue(text: string): void
  applyEdits(edits: Array<{ range: MonacoRangeLike; text: string }>): unknown
  getPositionAt(offset: number): MonacoPositionLike
  getOffsetAt(position: MonacoPositionLike): number
  onDidChangeContent(listener: (event: unknown) => void): MonacoDisposableLike
}

export interface MonacoDecorationsCollectionLike {
  set(decorations: Array<{ range: MonacoRangeLike; options: { inlineClassName: string } }>): unknown
  clear(): void
}

export interface MonacoEditorLike {
  getModel(): MonacoModelLike | null
  createDecorationsCollection(): MonacoDecorationsCollectionLike
  onDidChangeCursorPosition(listener: (event: { position: MonacoPositionLike; reason: number }) => void): MonacoDisposableLike
  onKeyDown(listener: (event: {
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    browserEvent: { key: string }
    preventDefault(): void
    stopPropagation(): void
  }) => void): MonacoDisposableLike
  revealPositionInCenter(position: MonacoPositionLike): void
}

export interface BindMonacoOptions {
  /** class applied to entity-highlight decorations; style it in your CSS (default 'mw-monaco-entity') */
  highlightClassName?: string
  /** route Mod+Z / Mod+Shift+Z to the engine's unified history (default true) */
  bindUndoKeys?: boolean
}

/** monaco.editor.CursorChangeReason.Explicit — mouse/keyboard caret moves, not edits */
const CURSOR_EXPLICIT = 3

/**
 * Bind an existing Monaco editor to a MermaidWysiwygEditor.
 *
 * You create and own the Monaco editor (workers, theme, options); this only
 * wires the two-way sync: typing flows into the engine, engine changes come
 * back as minimal edits, entity selection renders as inline decorations and
 * follows the caret, and undo/redo share the canvas history stack.
 *
 * Returns the binding; call `dispose()` to unhook everything.
 */
export function bindMonaco(
  editor: MermaidWysiwygEditor,
  monacoEditor: MonacoEditorLike,
  options: BindMonacoOptions = {},
): TextPaneBinding {
  const model = monacoEditor.getModel()
  if (!model) throw new Error('bindMonaco: the Monaco editor has no model')
  const highlightClassName = options.highlightClassName ?? 'mw-monaco-entity'
  const decorations = monacoEditor.createDecorationsCollection()

  const range = (start: number, end: number): MonacoRangeLike => {
    const s = model.getPositionAt(start)
    const e = model.getPositionAt(end)
    return { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column }
  }

  const binding = bindTextPane(editor, {
    getText: () => model.getValue(),
    applyEdits: (edits) => {
      model.applyEdits(edits.map((e) => ({ range: range(e.start, e.end), text: e.text })))
    },
    setText: (text) => model.setValue(text),
    setHighlights: (spans) =>
      decorations.set(spans.map((s) => ({ range: range(s.start, s.end), options: { inlineClassName: highlightClassName } }))),
    revealPosition: (offset) => monacoEditor.revealPositionInCenter(model.getPositionAt(offset)),
  })

  const subs: MonacoDisposableLike[] = [
    model.onDidChangeContent(() => binding.notifyTextChange()),
    monacoEditor.onDidChangeCursorPosition((ev) => {
      if (ev.reason === CURSOR_EXPLICIT) binding.notifyCaretMove(model.getOffsetAt(ev.position))
    }),
  ]
  if (options.bindUndoKeys !== false) {
    subs.push(
      // matched on the browser event's key: monaco's own keyCode enum maps
      // synthesized events to Unknown, and the key string is stable anyway
      monacoEditor.onKeyDown((e) => {
        if ((e.metaKey || e.ctrlKey) && e.browserEvent.key.toLowerCase() === 'z') {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) binding.redo()
          else binding.undo()
        }
      }),
    )
  }

  return {
    get applying() {
      return binding.applying
    },
    notifyTextChange: () => binding.notifyTextChange(),
    notifyCaretMove: (offset) => binding.notifyCaretMove(offset),
    undo: () => binding.undo(),
    redo: () => binding.redo(),
    dispose() {
      subs.forEach((d) => d.dispose())
      decorations.clear()
      binding.dispose()
    },
  }
}
