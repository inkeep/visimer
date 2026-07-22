import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, bindTextPane, type Span, type TextEdit } from '../src'

/** minimal in-memory adapter, the same shape a Monaco or textarea binding would implement */
function fakePane(initial: string) {
  const pane = {
    text: initial,
    highlights: [] as Span[],
    revealed: [] as number[],
    applied: [] as TextEdit[][],
    adapter: {
      getText: () => pane.text,
      applyEdits: (edits: TextEdit[]) => {
        pane.applied.push(edits)
        for (let i = edits.length - 1; i >= 0; i--) {
          const e = edits[i]
          pane.text = pane.text.slice(0, e.start) + e.text + pane.text.slice(e.end)
        }
      },
      setText: (text: string) => {
        pane.text = text
      },
      setHighlights: (spans: Span[]) => {
        pane.highlights = spans
      },
      revealPosition: (offset: number) => {
        pane.revealed.push(offset)
      },
    },
  }
  return pane
}

const CODE = 'flowchart TD\n  A[Start] --> B[End]\n'

describe('bindTextPane', () => {
  it('applies engine changes to the pane as minimal edits', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const pane = fakePane(editor.code)
    bindTextPane(editor, pane.adapter)

    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(pane.text).toBe(editor.code)
    expect(pane.text).toContain('A[Begin]')
    expect(pane.applied.length).toBe(1)
    expect(pane.applied[0].length).toBe(1)
  })

  it('flows pane edits into the engine without echoing back', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const pane = fakePane(editor.code)
    const binding = bindTextPane(editor, pane.adapter)

    pane.text = pane.text.replace('B[End]', 'B[Done]')
    binding.notifyTextChange()
    expect(editor.code).toBe(pane.text)
    expect(pane.applied.length).toBe(0)
  })

  it('selects the entity under the caret', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const pane = fakePane(editor.code)
    const binding = bindTextPane(editor, pane.adapter)

    binding.notifyCaretMove(editor.code.indexOf('A[Start]') + 1)
    expect(editor.selection).toEqual(['node:A'])
    expect(pane.highlights.length).toBeGreaterThan(0)
  })

  it('reveals canvas selections and routes undo to the engine', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const pane = fakePane(editor.code)
    const binding = bindTextPane(editor, pane.adapter)

    editor.setSelection(['node:B'], 'canvas')
    expect(pane.revealed.length).toBe(1)

    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    binding.undo()
    expect(editor.code).toBe(CODE)
    expect(pane.text).toBe(CODE)
    binding.redo()
    expect(pane.text).toContain('A[Begin]')
  })

  it('hard-resyncs when the pane drifts', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const pane = fakePane('totally out of sync')
    bindTextPane(editor, pane.adapter)

    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(pane.text).toBe(editor.code)
  })

  it('stops syncing after dispose', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const pane = fakePane(editor.code)
    const binding = bindTextPane(editor, pane.adapter)
    binding.dispose()

    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(pane.text).toBe(CODE)
  })
})
