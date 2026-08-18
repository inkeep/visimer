// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCanvasView, type MermaidLike } from '../src'

// jsdom has no CSS.escape (browsers do)
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  }
}

const CODE = 'flowchart TD\n  A[Tests green?] --> B[Ship it]\n'

/**
 * Mermaid measures label text against the fonts the document can use at the
 * moment it renders, then bakes those measurements into fixed-width
 * `foreignObject` boxes. A webfont that arrives afterwards leaves every label
 * clipped, and nothing re-measures on its own. These tests pin the view's
 * response to that: re-render once the document's fonts have settled, and
 * only when there was something to wait for.
 */

function makeFakeMermaid() {
  const renders: string[] = []
  const fake: MermaidLike & { renders: string[] } = {
    renders,
    initialize() {},
    async render(_id: string, code: string) {
      renders.push(code)
      const nodes = [...code.matchAll(/(\w+)\[([^\]]*)\]/g)]
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
        '<g class="edgePaths"></g>',
        '<g class="edgeLabels"></g>',
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

/**
 * Stand-in for the slice of `FontFaceSet` the view reads. jsdom does not
 * implement one, and the real thing cannot be driven from a test.
 */
function installFontFaceSet(status: 'loading' | 'loaded') {
  let resolve!: () => void
  const ready = new Promise<void>((r) => {
    resolve = r
  })
  const fonts = {
    status,
    ready,
    /** the webfont finished loading (or failed) and metrics are now final */
    settle() {
      fonts.status = 'loaded'
      resolve()
    },
  }
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true, writable: true })
  return fonts
}

function removeFontFaceSet() {
  Object.defineProperty(document, 'fonts', { value: undefined, configurable: true, writable: true })
}

/** drain microtasks and the macrotask queue so renders in flight land */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('re-measures when the document fonts land after the first render', () => {
  let editor: MermaidWysiwygEditor
  let container: HTMLElement
  let view: MermaidCanvasView | null
  let mermaid: ReturnType<typeof makeFakeMermaid>

  beforeEach(() => {
    editor = new MermaidWysiwygEditor({ code: CODE })
    container = document.createElement('div')
    document.body.appendChild(container)
    mermaid = makeFakeMermaid()
    view = null
  })

  afterEach(() => {
    view?.destroy()
    container.remove()
    // drop the stub so the next test starts from whatever the environment has
    delete (document as unknown as { fonts?: unknown }).fonts
  })

  it('re-renders once the fonts finish loading', async () => {
    const fonts = installFontFaceSet('loading')
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await flush()
    expect(mermaid.renders).toEqual([CODE])

    fonts.settle()
    await flush()

    // same code, rendered again: the boxes from the first pass were measured
    // with the fallback font and have to be thrown away
    expect(mermaid.renders).toEqual([CODE, CODE])
  })

  it('does not keep re-rendering after the fonts have settled', async () => {
    const fonts = installFontFaceSet('loading')
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await flush()
    fonts.settle()
    await flush()
    await flush()

    expect(mermaid.renders.length).toBe(2)
  })

  it('arms only one re-measure when several renders land before the fonts do', async () => {
    const fonts = installFontFaceSet('loading')
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await flush()

    // a second render while the fonts are still loading: re-theming, say
    view.setMermaidConfig({})
    await flush()
    expect(mermaid.renders.length).toBe(2)

    fonts.settle()
    await flush()
    await flush()

    // one corrective render, not one per render that was waiting
    expect(mermaid.renders.length).toBe(3)
  })

  it('does not re-render when the fonts were already available', async () => {
    installFontFaceSet('loaded')
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await flush()
    await flush()

    expect(mermaid.renders).toEqual([CODE])
  })

  it('renders normally where the document exposes no font set', async () => {
    removeFontFaceSet()
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await flush()
    await flush()

    expect(mermaid.renders).toEqual([CODE])
  })

  it('does not re-render a destroyed view when the fonts land late', async () => {
    const fonts = installFontFaceSet('loading')
    view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    await flush()
    view.destroy()
    view = null

    fonts.settle()
    await flush()

    expect(mermaid.renders).toEqual([CODE])
  })
})
