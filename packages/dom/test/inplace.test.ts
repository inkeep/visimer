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

/**
 * Fresh, unlabeled edges land in `openOverlayEditor` with the edge `<path>`
 * as the anchor — its bounding box is the whole arrow and it has no text
 * descendants. The pre-fix `findTextTarget` would widen to the parent
 * `.edgeLabels` group and pick the FIRST text leaf there, which happens to
 * be a sibling edge's label. The overlay then parked over an unrelated
 * label (and hid that sibling's visibility for the duration of editing).
 * These tests pin the new behavior: overlay opens on the arrow itself and
 * no sibling label is disturbed.
 */
function makeFakeMermaidWithMixedEdges() {
  const fake: MermaidLike = {
    initialize() {},
    async render(_id: string, code: string) {
      const nodes = [...code.matchAll(/(\w+)\[([^\]]*)\]/g)]
      // Match `A[…]? --> |label|? B[…]?` — mermaid lets the source/target
      // brackets appear once anywhere in the source and be omitted on later
      // references. Captures: 1 source id, 2 optional label, 3 target id.
      const edges = [
        ...code.matchAll(
          /(\w+)(?:\[[^\]]*\])?\s*-->\s*(?:\|([^|]+)\|\s*)?(\w+)(?:\[[^\]]*\])?/g,
        ),
      ]
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
        ...edges.map(
          ([, s, , t], i) => `<path id="L_${s}_${t}_${i}" d="M0,0 L100,0"></path>`,
        ),
        '</g>',
        '<g class="edgeLabels">',
        ...edges.map(([, , label]) =>
          // Only labeled edges get inner text — matches production Mermaid,
          // which omits the label span entirely for bare arrows.
          label
            ? `<g class="edgeLabel"><foreignObject width="30" height="14"><div xmlns="http://www.w3.org/1999/xhtml"><span class="edgeLabel">${label}</span></div></foreignObject></g>`
            : '<g class="edgeLabel"></g>',
        ),
        '</g>',
        '</svg>',
      ].join('')
      return { svg }
    },
    async parse() {
      return {}
    },
  }
  return fake
}

describe('overlay editor on a fresh edge with no label', () => {
  let editor: MermaidWysiwygEditor
  let container: HTMLElement
  let view: MermaidCanvasView

  beforeEach(async () => {
    vi.useFakeTimers()
    // Two edges: A→B carries no label yet (the freshly-created arrow), while
    // B→C carries "Yes". The pre-fix defect used the "Yes" label's rect for
    // the A→B overlay because findTextTarget widened to the shared parent.
    editor = new MermaidWysiwygEditor({
      code: 'flowchart LR\n  A[Write a doc] --> B[Needs a diagram?]\n  B -->|Yes| C[Click a node to edit]\n',
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    view = new MermaidCanvasView({
      editor,
      container,
      mermaid: makeFakeMermaidWithMixedEdges(),
      debounceMs: 0,
    })
    await view.render()
  })

  afterEach(() => {
    view.destroy()
    container.remove()
    vi.useRealTimers()
  })

  it('Enter on a fresh-edge overlay dispatches setEdgeLabel with the typed value', () => {
    view.editEntityLabel('edge:A->B#0')
    const overlay = document.querySelector<HTMLDivElement>('.mw-inplace-editor')
    expect(overlay).not.toBeNull()
    // Typing lands in the contentEditable div, which the overlay's Enter
    // handler reads on commit. The commit flow was previously exercised only
    // by node-editing tests, where the anchor is a rendered label element
    // and `inlineHidden` gets set. The fresh-edge path leaves
    // `inlineHidden === null`; pin that the commit branch still fires and
    // updates the source with the new label.
    if (overlay) overlay.textContent = 'wired'
    overlay?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.code).toContain('|wired|')
    expect(editor.code).toMatch(/A\[Write a doc\]\s*-->\|wired\|/)
  })

  it('Escape on a fresh-edge overlay closes without touching a nonexistent hidden element', () => {
    view.editEntityLabel('edge:A->B#0')
    const overlay = document.querySelector<HTMLDivElement>('.mw-inplace-editor')
    expect(overlay).not.toBeNull()
    // `closeInlineEditor` earlier restored `inlineHidden.el.style.visibility`
    // unconditionally — but the fresh-edge path never populated `inlineHidden`,
    // so a naive access would throw. Assert Escape teardown is clean.
    expect(() => {
      overlay?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }).not.toThrow()
    expect(document.querySelector('.mw-inplace-editor')).toBeNull()
    // Source is unchanged — no commit dispatched on Escape. Check that the
    // A→B edge specifically stayed unlabeled (the seed's `B -->|Yes| C`
    // stays as-is).
    expect(editor.code).toMatch(/A\[Write a doc\]\s*-->\s*B/)
    expect(editor.code).not.toMatch(/A\[Write a doc\]\s*-->\|/)
  })

  it('does not hide the sibling edge`s label when opening the overlay', () => {
    // sanity: entity ids present in the rendered DOM (used to pick the
    // fresh-edge entityId below without hardcoding the correlation's
    // internal shape).
    const entities = [...container.querySelectorAll('[data-mw-entity]')].map(
      (el) => `${el.getAttribute('data-mw-entity')} (${el.tagName})`,
    )
    // Two edges: the labeled one (B->C) has its label rendered as text; the
    // fresh one (A->B) has an empty label. The pre-fix `findTextTarget`
    // widened to the parent `.edgeLabels` group and returned the FIRST text
    // leaf — the labeled sibling — and the overlay hid THAT label for the
    // duration of editing. Post-fix, the empty path is detected and the
    // overlay uses the arrow's midpoint — no sibling label is touched.
    const siblingLabel = container.querySelector<HTMLElement>(
      '[data-mw-entity="edge:B->C#0"] .edgeLabel',
    )
    expect(siblingLabel, `entities: ${entities.join(', ')}`).not.toBeNull()
    const before = siblingLabel?.style.visibility ?? ''

    view.editEntityLabel('edge:A->B#0')

    // Overlay editor was created.
    const overlay = document.querySelector<HTMLDivElement>('.mw-inplace-editor')
    expect(overlay).not.toBeNull()

    // Sibling label's visibility is unchanged — this is the assertion the
    // pre-fix code would fail on: the sibling would carry `visibility: hidden`.
    expect(siblingLabel?.style.visibility ?? '').toBe(before)
  })

})
