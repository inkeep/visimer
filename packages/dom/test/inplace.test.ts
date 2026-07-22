// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCanvasView, type MermaidLike } from '../src'

// jsdom has no CSS.escape (browsers do)
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  }
}

const CODE = 'flowchart TD\n  A[Write a doc] --> B[End]\n'

/**
 * Fake mermaid that emits the structural skeleton correlateFlowchart matches
 * on (g.node ids, edge path ids, .edgeLabels) with foreignObject HTML labels,
 * so the in-place editing loop runs against the same DOM shape as production.
 * Set `gate` to hold the next render un-resolved — that models the async gap
 * between a live commit and the SVG swap landing.
 */
function makeFakeMermaid() {
  let release: (() => void) | null = null
  const fake: MermaidLike & { gate(): void; release(): void } = {
    initialize() {},
    async render(_id: string, code: string) {
      if (release === undefined) {
        // unreachable; keeps TS happy about the closure shape
      }
      if (gateNext) {
        gateNext = false
        await new Promise<void>((r) => {
          release = r
        })
      }
      const nodes = [...code.matchAll(/(\w+)\[([^\]]*)\]/g)]
      const edges = [...code.matchAll(/(\w+)\[[^\]]*\]\s*-->\s*(\w+)/g)]
      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '<g class="nodes">',
        ...nodes.map(
          ([, id, label], i) =>
            `<g class="node" id="flowchart-${id}-${i}"><g class="label"><foreignObject width="80" height="24">` +
            `<div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>${label}</p></span></div>` +
            `</foreignObject></g></g>`,
        ),
        '</g>',
        '<g class="edgePaths">',
        ...edges.map(([, s, t], i) => `<path id="L_${s}_${t}_${i}"></path>`),
        '</g>',
        '<g class="edgeLabels">',
        ...edges.map(() => '<g class="edgeLabel"></g>'),
        '</g>',
        '</svg>',
      ].join('')
      return { svg }
    },
    async parse() {
      return {}
    },
    gate() {
      gateNext = true
    },
    release() {
      release?.()
      release = null
    },
  }
  let gateNext = false
  return fake
}

function labelOf(container: HTMLElement, entity: string): HTMLElement {
  const p = container.querySelector<HTMLElement>(`[data-mw-entity="${entity}"] .nodeLabel p`)
  if (!p) throw new Error(`no label for ${entity}`)
  return p
}

/** simulate typing: replace the label text and fire the input event */
function typeInto(label: HTMLElement, text: string) {
  label.textContent = text
  label.dispatchEvent(new Event('input'))
}

describe('in-place label editing survives the live-commit re-render', () => {
  let editor: MermaidWysiwygEditor
  let container: HTMLElement
  let view: MermaidCanvasView
  let mermaid: ReturnType<typeof makeFakeMermaid>

  beforeEach(async () => {
    vi.useFakeTimers()
    editor = new MermaidWysiwygEditor({ code: CODE })
    container = document.createElement('div')
    document.body.appendChild(container)
    mermaid = makeFakeMermaid()
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await view.render()
  })

  afterEach(() => {
    view.destroy()
    container.remove()
    vi.useRealTimers()
  })

  it('live-commits typing after the debounce', async () => {
    view.editEntityLabel('node:A')
    const label = labelOf(container, 'node:A')
    expect(label.getAttribute('contenteditable')).toBe('true')

    typeInto(label, 'Write a docX')
    await vi.advanceTimersByTimeAsync(450)
    expect(editor.code).toContain('A[Write a docX]')
  })

  it('never swaps the label out from under an active session', async () => {
    view.editEntityLabel('node:A')
    const label = labelOf(container, 'node:A')
    typeInto(label, 'Write a docX')
    // the live commit fires and schedules a re-render, but the canvas must
    // hold it while the session is typing — like any textbox, the element
    // under the caret never changes
    await vi.advanceTimersByTimeAsync(2000)
    expect(editor.code).toContain('A[Write a docX]')
    const sameLabel = labelOf(container, 'node:A')
    expect(sameLabel).toBe(label)
    expect(sameLabel.getAttribute('contenteditable')).toBe('true')

    // finishing the session applies the held render
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.advanceTimersByTimeAsync(500)
    const newLabel = labelOf(container, 'node:A')
    expect(newLabel).not.toBe(label)
    expect(newLabel.textContent).toBe('Write a docX')
    expect(newLabel.getAttribute('contenteditable')).toBeNull()
  })

  it('carries typed text and caret across a swap that was already in flight', async () => {
    // a render is mid-flight (started before the session opened) …
    mermaid.gate()
    editor.dispatch({ type: 'renameNode', id: 'B', label: 'Finish' })
    await vi.advanceTimersByTimeAsync(1)

    // … when the user starts editing and types
    view.editEntityLabel('node:A')
    const label = labelOf(container, 'node:A')
    typeInto(label, 'Write a docXY')
    // caret mid-text (offset 5, after "Write")
    const sel = window.getSelection()!
    const range = document.createRange()
    range.setStart(label.firstChild!, 5)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)

    // the in-flight swap lands mid-session
    mermaid.release()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    const newLabel = labelOf(container, 'node:A')
    expect(newLabel).not.toBe(label)
    // typed text carried over, session re-attached
    expect(newLabel.textContent).toBe('Write a docXY')
    expect(newLabel.getAttribute('contenteditable')).toBe('true')
    // caret back at its absolute offset
    const after = window.getSelection()!
    expect(newLabel.contains(after.anchorNode)).toBe(true)
    const measure = document.createRange()
    measure.selectNodeContents(newLabel)
    measure.setEnd(after.anchorNode!, after.anchorOffset)
    expect(measure.toString().length).toBe(5)

    // and the carried delta commits through the normal debounce
    await vi.advanceTimersByTimeAsync(450)
    expect(editor.code).toContain('A[Write a docXY]')
  })

  it('editing another entity first commits the open session', async () => {
    view.editEntityLabel('node:A')
    const labelA = labelOf(container, 'node:A')
    typeInto(labelA, 'Write a docZ')

    // switch to node B before the live commit debounce fires
    view.editEntityLabel('node:B')
    expect(editor.code).toContain('A[Write a docZ]')
    expect(labelA.getAttribute('contenteditable')).toBeNull()
    expect(labelOf(container, 'node:B').getAttribute('contenteditable')).toBe('true')
    await vi.advanceTimersByTimeAsync(1000)
    expect(editor.code).toContain('A[Write a docZ]')
  })

  it('a second double-click on the same node does not restart the session', async () => {
    view.editEntityLabel('node:A')
    const label = labelOf(container, 'node:A')
    typeInto(label, 'Write a docQ')

    // same entity again (e.g. double-click while already editing)
    view.editEntityLabel('node:A')
    expect(labelOf(container, 'node:A')).toBe(label)
    // the pending live edit still commits exactly once
    await vi.advanceTimersByTimeAsync(450)
    expect(editor.code).toContain('A[Write a docQ]')
    await vi.advanceTimersByTimeAsync(1000)
    expect(editor.code.match(/Write a docQ/g)?.length).toBe(1)
  })

  it('Escape mid-session reverts live-committed intermediate states', async () => {
    view.editEntityLabel('node:A')
    const label = labelOf(container, 'node:A')
    typeInto(label, 'Half typed')
    await vi.advanceTimersByTimeAsync(500)
    expect(editor.code).toContain('A[Half typed]')

    const current = labelOf(container, 'node:A')
    expect(current.getAttribute('contenteditable')).toBe('true')
    current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(editor.code).toContain('A[Write a doc]')
    expect(editor.code).not.toContain('Half typed')
    // the canvas label must revert too — the reverted code can equal the last
    // rendered code, in which case no re-render will repaint it
    expect(labelOf(container, 'node:A').textContent).toBe('Write a doc')
  })
})
