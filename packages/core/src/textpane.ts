/**
 * Editor-agnostic text pane binding.
 *
 * Any code editor (CodeMirror, Monaco, a plain textarea) can sync with the
 * engine by implementing TextPaneAdapter and calling the notify* methods on
 * the returned binding from its own events. @visimer/codemirror is
 * the reference implementation.
 */

import type { MermaidWysiwygEditor } from './editor'
import type { Span, TextEdit } from './types'

export interface TextPaneAdapter {
  /** current full document text of the pane */
  getText(): string
  /**
   * Apply the engine's minimal edits to the pane, all at once, against the
   * current text (offsets are pre-clamped and sorted ascending).
   */
  applyEdits(edits: TextEdit[]): void
  /** replace the whole document; used as a resync safety net */
  setText(text: string): void
  /** highlight the selected entities' source ranges (empty array clears) */
  setHighlights(spans: Span[]): void
  /** scroll a document offset into view (canvas selections jump the pane) */
  revealPosition?(offset: number): void
}

export interface TextPaneBinding {
  /**
   * true while the binding itself is mutating the pane; the notify* methods
   * already no-op during this, so most adapters never need to check it
   */
  readonly applying: boolean
  /** call when the user edited the pane */
  notifyTextChange(): void
  /** call when the caret moved without a document change */
  notifyCaretMove(offset: number): void
  /** route the pane's undo/redo keys here; it is the same stack the canvas uses */
  undo(): void
  redo(): void
  dispose(): void
}

/** Two-way sync between an engine and any text editor behind a TextPaneAdapter. */
export function bindTextPane(editor: MermaidWysiwygEditor, adapter: TextPaneAdapter): TextPaneBinding {
  let applying = false

  const validSpans = (spans: Span[]) => {
    const len = adapter.getText().length
    return spans.filter((s) => s.end > s.start && s.end <= len).sort((a, b) => a.start - b.start)
  }

  const disposers = [
    editor.on('change', ({ origin, edits, code }) => {
      if (origin !== 'code') {
        applying = true
        try {
          const len = adapter.getText().length
          adapter.applyEdits(
            edits.map((e) => ({
              start: Math.min(e.start, len),
              end: Math.min(e.end, len),
              text: e.text,
            })),
          )
          if (adapter.getText() !== code) adapter.setText(code)
        } finally {
          applying = false
        }
      }
      adapter.setHighlights(validSpans(editor.selectionSpans()))
    }),
    editor.on('selectionChange', ({ spans, origin }) => {
      adapter.setHighlights(validSpans(spans))
      if (origin === 'canvas' && spans[0]) adapter.revealPosition?.(spans[0].start)
    }),
  ]

  return {
    get applying() {
      return applying
    },
    notifyTextChange() {
      if (applying) return
      editor.setCode(adapter.getText(), 'code')
    },
    notifyCaretMove(offset: number) {
      if (applying) return
      const entity = editor.entityAt(offset)
      editor.setSelection(entity ? [entity] : [], 'code')
    },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    dispose: () => disposers.forEach((d) => d()),
  }
}
