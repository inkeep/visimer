// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor } from '@visimer/core'
import { peleAdapter } from '../src/renderer'
import { MermaidCanvasView, type MermaidLike, type PopoverAction } from '../src'

// jsdom has no CSS.escape (browsers do)
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  }
}

// jsdom has no canvas: pele probes for one to measure text, and jsdom's
// getContext raises a noisy "not implemented" error. Return null so pele falls
// back to its built-in metrics table (the assertions here are structural, not
// pixel-precise).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const CODE = 'flowchart TD\n  A[Start] --> B\n'
const UNLABELED = 'flowchart TD\n  A --> B\n'

/**
 * Fake mermaid for the mermaid side of the renderer comparisons: emits a
 * minimal svg skeleton (the shape correlateFlowchart matches) so the view
 * runs its real mermaid code path under jsdom.
 */
function makeFakeMermaid(): MermaidLike {
  return {
    initialize() {},
    async render(_id: string, code: string) {
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
}

/** drain microtasks and the macrotask queue so renders in flight land */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

/** the payload shape the view emits on its 'render' event */
type RenderOutcome = { ok: boolean; error?: string }

/** arm a listener for the view's next 'render' event, then trigger it */
async function renderAfter(view: MermaidCanvasView, act: () => void): Promise<RenderOutcome> {
  let settle!: (p: RenderOutcome) => void
  const outcome = new Promise<RenderOutcome>((r) => (settle = r))
  view.on('render', (p) => settle(p))
  act()
  return outcome
}

/** every title an edge popover can surface: action titles plus panel cell titles */
function popoverTitles(actions: PopoverAction[]): string[] {
  const titles = actions.map((a) => a.title)
  for (const a of actions) {
    if (a.panel?.items) titles.push(...a.panel.items.map((i) => i.title))
    for (const s of a.panel?.sections ?? []) titles.push(...s.items.map((i) => i.title))
  }
  return titles
}

describe('pele view behaviors', () => {
  let container: HTMLElement
  let views: MermaidCanvasView[]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    views = []
  })

  afterEach(() => {
    for (const view of views) view.destroy()
    container.remove()
  })

  describe('keep-last-good on mid-keystroke syntax errors', () => {
    it('keeps the previous svg and reports a pele diagnostic until the code recovers', async () => {
      const editor = new MermaidWysiwygEditor({ code: CODE })
      const view = new MermaidCanvasView({
        editor,
        container,
        renderer: peleAdapter({ render: (src) => peleRender(src) }),
        debounceMs: 0,
      })
      views.push(view)
      await flush()
      expect(container.querySelector('.mw-svg-host svg [data-mw-entity="node:A"]')).toBeTruthy()

      // a half-typed label breaks the parse mid-keystroke
      const broken = await renderAfter(view, () => editor.setCode('flowchart TD\n  A[unclosed', 'external'))
      expect(broken.ok).toBe(false)
      // the canvas still shows the last good render — nothing was swapped out
      expect(container.querySelector('.mw-svg-host svg [data-mw-entity="node:A"]')).toBeTruthy()
      expect(view.renderError).toBeTruthy()
      expect(editor.diagnostics.some((d) => d.source === 'pele')).toBe(true)

      // typing the label closed again restores a clean canvas
      const good = await renderAfter(view, () => editor.setCode(CODE, 'external'))
      expect(good.ok).toBe(true)
      expect(view.renderError).toBeNull()
      expect(editor.diagnostics).toHaveLength(0)
    })
  })

  describe('overlay-editor fallback for label editing', () => {
    it('edits pele labels through the overlay editor, not contenteditable SVG', async () => {
      const editor = new MermaidWysiwygEditor({ code: CODE })
      const view = new MermaidCanvasView({
        editor,
        container,
        renderer: peleAdapter({ render: (src) => peleRender(src) }),
        debounceMs: 0,
      })
      views.push(view)
      await flush()

      view.editEntityLabel('node:A')

      // pele labels are SVG <text> — no HTML label inside the svg ever turns
      // contenteditable (in-node editing is mermaid's foreignObject shape)
      const svg = container.querySelector('svg')!
      expect(svg.querySelector('[contenteditable]')).toBeNull()
      // the overlay editor takes over instead, seeded with the current label
      const overlay = container.querySelector<HTMLElement>('.mw-inplace-editor')
      expect(overlay).not.toBeNull()
      expect(overlay?.textContent).toBe('Start')

      // commit follows the overlay's own contract: Enter
      overlay!.textContent = 'Done'
      overlay!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(editor.code).toContain('A[Done]')
      await flush()
      expect(container.querySelector('.mw-inplace-editor')).toBeNull()
    })
  })

  describe('edge animation picker', () => {
    it('is omitted under pele (pele silently drops animation-* styles)', async () => {
      const editor = new MermaidWysiwygEditor({ code: UNLABELED })
      const view = new MermaidCanvasView({
        editor,
        container,
        renderer: peleAdapter({ render: (src) => peleRender(src) }),
        debounceMs: 0,
      })
      views.push(view)
      await flush()

      const actions = (view as unknown as { actionsFor(id: string): PopoverAction[] }).actionsFor('edge:A->B#0')
      const titles = popoverTitles(actions)
      expect(titles).not.toContain('Animate edge')
      expect(titles.some((t) => t.includes('Slow flow'))).toBe(false)
    })

    it('stays available under mermaid on the same code', async () => {
      const editor = new MermaidWysiwygEditor({ code: UNLABELED })
      const view = new MermaidCanvasView({ editor, container, mermaid: makeFakeMermaid(), debounceMs: 0 })
      views.push(view)
      await flush()

      const actions = (view as unknown as { actionsFor(id: string): PopoverAction[] }).actionsFor('edge:A->B#0')
      const titles = popoverTitles(actions)
      expect(titles).toContain('Animate edge')
      expect(titles).toContain('Slow flow')
    })
  })

  describe('animation keyframes', () => {
    it('are not injected under pele', async () => {
      const editor = new MermaidWysiwygEditor({ code: CODE })
      const view = new MermaidCanvasView({
        editor,
        container,
        renderer: peleAdapter({ render: (src) => peleRender(src) }),
        debounceMs: 0,
      })
      views.push(view)
      await flush()

      const styles = [...container.querySelector('svg')!.querySelectorAll('style')]
      expect(styles.some((s) => s.hasAttribute('data-vsmr-flow'))).toBe(false)
      expect(styles.some((s) => (s.textContent ?? '').includes('vsmr-flow'))).toBe(false)
    })

    it('are injected under mermaid on the same code', async () => {
      const editor = new MermaidWysiwygEditor({ code: CODE })
      const view = new MermaidCanvasView({ editor, container, mermaid: makeFakeMermaid(), debounceMs: 0 })
      views.push(view)
      await flush()

      const styles = [...container.querySelector('svg')!.querySelectorAll('style')]
      expect(styles.some((s) => s.hasAttribute('data-vsmr-flow'))).toBe(true)
      expect(styles.some((s) => (s.textContent ?? '').includes('vsmr-flow'))).toBe(true)
    })
  })
})
