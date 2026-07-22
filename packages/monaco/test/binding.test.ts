import { describe, expect, it } from 'vitest'
import type * as monaco from 'monaco-editor'
import { MermaidWysiwygEditor } from '@visimer/core'
import {
  bindMonaco,
  registerMermaidLanguage,
  type MonacoDecorationsCollectionLike,
  type MonacoEditorLike,
  type MonacoModelLike,
  type MonacoNamespaceLike,
  type MonacoPositionLike,
  type MonacoRangeLike,
} from '../src'

// Type-level drift canary: a real Monaco editor must satisfy the structural
// interface this package binds against. If a monaco-editor upgrade changes
// the shapes we consume, this stops compiling.
const _conformance: (e: monaco.editor.IStandaloneCodeEditor) => MonacoEditorLike = (e) => e
void _conformance

const CODE = 'flowchart TD\n  A[Start] --> B[End]\n'

/** minimal in-memory Monaco editor implementing exactly the bound surface */
function fakeMonaco(initial: string) {
  let text = initial
  const contentListeners: Array<(e: unknown) => void> = []
  const cursorListeners: Array<(e: { position: MonacoPositionLike; reason: number }) => void> = []
  const keyListeners: Array<(e: {
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    browserEvent: { key: string }
    preventDefault(): void
    stopPropagation(): void
  }) => void> = []

  const offsetOf = (p: MonacoPositionLike) => {
    const lines = text.split('\n')
    let off = 0
    for (let i = 0; i < p.lineNumber - 1; i++) off += lines[i].length + 1
    return off + p.column - 1
  }
  const positionOf = (offset: number): MonacoPositionLike => {
    const before = text.slice(0, offset)
    const lines = before.split('\n')
    return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 }
  }

  const model: MonacoModelLike = {
    getValue: () => text,
    setValue: (t) => {
      text = t
      contentListeners.forEach((l) => l({}))
    },
    applyEdits: (edits) => {
      const resolved = edits
        .map((e) => ({ start: offsetOf({ lineNumber: e.range.startLineNumber, column: e.range.startColumn }), end: offsetOf({ lineNumber: e.range.endLineNumber, column: e.range.endColumn }), text: e.text }))
        .sort((a, b) => b.start - a.start)
      for (const e of resolved) text = text.slice(0, e.start) + e.text + text.slice(e.end)
      contentListeners.forEach((l) => l({}))
    },
    getPositionAt: positionOf,
    getOffsetAt: offsetOf,
    onDidChangeContent: (l) => {
      contentListeners.push(l)
      return { dispose: () => contentListeners.splice(contentListeners.indexOf(l), 1) }
    },
  }

  const state = {
    highlights: [] as MonacoRangeLike[],
    revealed: [] as MonacoPositionLike[],
  }
  const decorations: MonacoDecorationsCollectionLike = {
    set: (decos) => {
      state.highlights = decos.map((d) => d.range)
    },
    clear: () => {
      state.highlights = []
    },
  }

  const editor: MonacoEditorLike = {
    getModel: () => model,
    createDecorationsCollection: () => decorations,
    onDidChangeCursorPosition: (l) => {
      cursorListeners.push(l)
      return { dispose: () => cursorListeners.splice(cursorListeners.indexOf(l), 1) }
    },
    onKeyDown: (l) => {
      keyListeners.push(l)
      return { dispose: () => keyListeners.splice(keyListeners.indexOf(l), 1) }
    },
    revealPositionInCenter: (p) => {
      state.revealed.push(p)
    },
  }

  return {
    editor,
    model,
    state,
    get text() {
      return text
    },
    moveCursor(offset: number, reason = 3) {
      cursorListeners.forEach((l) => l({ position: positionOf(offset), reason }))
    },
    pressUndo(shift = false) {
      keyListeners.forEach((l) =>
        l({ metaKey: true, ctrlKey: false, shiftKey: shift, browserEvent: { key: 'z' }, preventDefault() {}, stopPropagation() {} }),
      )
    },
  }
}

describe('bindMonaco', () => {
  it('applies engine ops to the model as minimal edits', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const fake = fakeMonaco(editor.code)
    bindMonaco(editor, fake.editor)
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(fake.text).toBe(editor.code)
    expect(fake.text).toContain('A[Begin]')
  })

  it('flows model edits into the engine without echoing back', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const fake = fakeMonaco(editor.code)
    bindMonaco(editor, fake.editor)
    const pos = fake.text.indexOf('B[End]')
    fake.model.applyEdits([
      {
        range: {
          startLineNumber: fake.model.getPositionAt(pos).lineNumber,
          startColumn: fake.model.getPositionAt(pos).column,
          endLineNumber: fake.model.getPositionAt(pos + 6).lineNumber,
          endColumn: fake.model.getPositionAt(pos + 6).column,
        },
        text: 'B[Done]',
      },
    ])
    expect(editor.code).toBe(fake.text)
    expect(editor.code).toContain('B[Done]')
  })

  it('renders selection as decorations and reveals canvas selections', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const fake = fakeMonaco(editor.code)
    bindMonaco(editor, fake.editor)
    editor.setSelection(['node:B'], 'canvas')
    expect(fake.state.highlights.length).toBeGreaterThan(0)
    expect(fake.state.revealed.length).toBe(1)
  })

  it('explicit caret moves select the entity; edit-driven moves do not', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const fake = fakeMonaco(editor.code)
    bindMonaco(editor, fake.editor)
    fake.moveCursor(CODE.indexOf('A[Start]') + 1)
    expect(editor.selection).toEqual(['node:A'])
    fake.moveCursor(CODE.indexOf('B[End]') + 1, 0 /* NotSet: cursor moved by an edit */)
    expect(editor.selection).toEqual(['node:A'])
  })

  it('routes undo keys to the engine history', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const fake = fakeMonaco(editor.code)
    bindMonaco(editor, fake.editor)
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    fake.pressUndo()
    expect(fake.text).toBe(CODE)
    fake.pressUndo(true)
    expect(fake.text).toContain('A[Begin]')
  })

  it('dispose unhooks listeners and clears decorations', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const fake = fakeMonaco(editor.code)
    const binding = bindMonaco(editor, fake.editor)
    editor.setSelection(['node:A'], 'canvas')
    expect(fake.state.highlights.length).toBeGreaterThan(0)
    binding.dispose()
    expect(fake.state.highlights.length).toBe(0)
    editor.dispatch({ type: 'renameNode', id: 'A', label: 'Begin' })
    expect(fake.text).toBe(CODE)
  })

  it('registerMermaidLanguage is idempotent', () => {
    const registered: string[] = []
    const ns: MonacoNamespaceLike = {
      languages: {
        getLanguages: () => registered.map((id) => ({ id })),
        register: ({ id }) => registered.push(id),
        setMonarchTokensProvider: () => {},
      },
    }
    registerMermaidLanguage(ns)
    registerMermaidLanguage(ns)
    expect(registered).toEqual(['mermaid'])
  })
})
