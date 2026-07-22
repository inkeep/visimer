import { defaultKeymap } from '@codemirror/commands'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { bindTextPane, type MermaidWysiwygEditor, type Span, type TextPaneBinding } from '@visimer/core'
import { mermaidLanguage } from './language'

export { mermaidLanguage } from './language'

const setHighlights = StateEffect.define<Span[]>()

const highlightMark = Decoration.mark({ class: 'mw-cm-entity' })

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        deco = Decoration.set(
          e.value.filter((s) => s.end <= tr.newDoc.length).map((s) => highlightMark.range(s.start, s.end)),
        )
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const baseTheme = EditorView.baseTheme({
  '.mw-cm-entity': {
    backgroundColor: 'color-mix(in srgb, var(--mw-accent, #6366f1) 28%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--mw-accent, #6366f1) 55%, transparent)',
    borderRadius: '3px',
  },
})

/**
 * CodeMirror 6 pane bound to a MermaidWysiwygEditor.
 *
 * A thin adapter over core's editor-agnostic `bindTextPane`; the same contract
 * works for Monaco or any other code editor.
 *
 * - typing flows into the engine (`origin: 'code'`), keeping the canvas live
 * - canvas/api/history changes are applied as the engine's exact minimal edits
 * - entity selection renders as decorations; the caret selects entities
 * - ⌘Z/⌘⇧Z route to the engine's unified history (the same stack the canvas uses)
 */
export class MermaidCodeMirror {
  readonly view: EditorView
  private binding: TextPaneBinding

  constructor(host: HTMLElement, editor: MermaidWysiwygEditor, extraExtensions: unknown[] = []) {
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) this.binding.notifyTextChange()
      else if (update.selectionSet) this.binding.notifyCaretMove(update.state.selection.main.head)
    })

    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: editor.code,
        extensions: [
          keymap.of([
            {
              key: 'Mod-z',
              run: () => {
                this.binding.undo()
                return true
              },
            },
            {
              key: 'Mod-Shift-z',
              run: () => {
                this.binding.redo()
                return true
              },
            },
          ]),
          keymap.of(defaultKeymap),
          lineNumbers(),
          mermaidLanguage(),
          highlightField,
          baseTheme,
          updateListener,
          ...(extraExtensions as []),
        ],
      }),
    })

    this.binding = bindTextPane(editor, {
      getText: () => this.view.state.doc.toString(),
      applyEdits: (edits) => {
        this.view.dispatch({ changes: edits.map((e) => ({ from: e.start, to: e.end, insert: e.text })) })
      },
      setText: (text) => {
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } })
      },
      setHighlights: (spans) => this.view.dispatch({ effects: setHighlights.of(spans) }),
      revealPosition: (offset) => {
        // Scroll only the editor's own scroller. CodeMirror's scrollIntoView
        // effect also scrolls every scrollable ancestor — including the page —
        // so a canvas click revealing a span would yank the host app's
        // viewport around.
        const block = this.view.lineBlockAt(offset)
        const scroller = this.view.scrollDOM
        const top = block.top - (scroller.clientHeight - block.height) / 2
        scroller.scrollTop = Math.max(0, top)
      },
    })
  }

  destroy() {
    this.binding.dispose()
    this.view.destroy()
  }
}
