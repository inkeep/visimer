// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type PieGraph } from '@visimer/core'
import { correlatePelePie } from '../src/correlate.pele.pie'
import { MermaidCanvasView, peleAdapter } from '../src'

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

const hosts: HTMLElement[] = []

const SAMPLE = `pie title Pets
  "cat": 40
  "dog": 45
  "fish": 15
`

/** render a code string with real pele, correlate it against core's pie graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.pie
  if (!graph) throw new Error('code did not parse as a pie chart')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePelePie(svg, graph) }
}

/** mount code through the full view with a pele adapter */
async function mountWithView(container: HTMLElement, code: string, options?: Record<string, unknown>) {
  const editor = new MermaidWysiwygEditor({ code })
  const view = new MermaidCanvasView({
    editor,
    container,
    renderer: peleAdapter({ render: (src, opts) => peleRender(src, opts) }, options),
    debounceMs: 0,
  })
  // drain microtasks and the macrotask queue so the render lands
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  return { editor, view }
}

/** minimal PieGraph for synthetic-DOM tests */
function fakeGraph(slices: Array<{ label: string; value?: number }>): PieGraph {
  return {
    headerLine: 0,
    showData: false,
    slices: slices.map((s, i) => ({
      entityId: `slice:${i + 1}`,
      label: s.label,
      value: s.value ?? 10,
      lineIndex: i + 1,
      labelSpan: { start: 0, end: s.label.length },
      valueSpan: { start: 0, end: 2 },
    })),
    lastContentLine: slices.length,
  } as unknown as PieGraph
}

function syntheticSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = `<svg>${markup}</svg>`
  return host.querySelector('svg')!
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePelePie', () => {
  it('correlates every slice and its legend row by data-id', () => {
    const { result, svg, graph } = correlate(SAMPLE)

    expect(graph.slices).toHaveLength(3)
    // every slice lands on its pele-slice path — pele keys data-id by the
    // slice's label (not core's `slice:` id), tagged with its entity id
    for (const slice of graph.slices) {
      const el = result.nodes.get(slice.entityId)!
      expect(el).toBeTruthy()
      expect(el.tagName.toLowerCase()).toBe('path')
      expect(el.classList.contains('pele-slice')).toBe(true)
      expect(el.getAttribute('data-id')).toBe(slice.label)
      expect(el.getAttribute('data-mw-entity')).toBe(slice.entityId)
      // the legend row carries the same entity id
      const legend = svg.querySelector(`g.pele-legend-item[data-id="${slice.label}"]`)
      expect(legend).toBeTruthy()
      expect(legend!.getAttribute('data-mw-entity')).toBe(slice.entityId)
    }
    expect(result.failed).toEqual([])
    expect(result.edges.size).toBe(0)
    expect(result.edgeLabels.size).toBe(0)
  })

  it('matches entity-encoded labels through pele encoding', () => {
    // pele entity-encodes data-id values; the graph label arrives encoded
    // (`a&amp;b`), the DOM attribute decodes it (`a&b`) — compare decoded
    const { result, svg } = correlate('pie title Enc\n  "a&amp;b": 40\n  "dog": 45\n')
    const slice = result.nodes.get('slice:1')!
    expect(slice).toBeTruthy()
    // the DOM attribute decodes pele's `a&amp;b` to `a&b`
    expect(slice.getAttribute('data-id')).toBe('a&b')
    expect(slice.getAttribute('data-mw-entity')).toBe('slice:1')
    const legend = [...svg.querySelectorAll('g.pele-legend-item')].find(
      (el) => el.getAttribute('data-id') === 'a&b',
    )!
    expect(legend.getAttribute('data-mw-entity')).toBe('slice:1')
    expect(result.failed).toEqual([])
  })

  it('degrades duplicate slice labels and their legend rows instead of mis-pairing', () => {
    // two core slices share the display label "cat" — label-keyed matching is
    // inherently ambiguous (pele keeps one slice per label), so BOTH degrade
    // to view-only and neither slice nor its legend row is ever tagged. The
    // unambiguous "dog" slice still correlates.
    const { result, svg } = correlate('pie title Dup\n  "cat": 40\n  "cat": 20\n  "dog": 15\n')
    expect(result.nodes.size).toBe(1)
    expect(result.nodes.get('slice:3')).toBe(svg.querySelector('path.pele-slice[data-id="dog"]'))
    expect(result.failed).toEqual(['slice:1', 'slice:2'])
    // neither colliding slice nor its legend row is tagged
    for (const el of svg.querySelectorAll('[data-id="cat"]')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
    expect(svg.querySelector('g.pele-legend-item[data-id="dog"]')!.getAttribute('data-mw-entity')).toBe('slice:3')
  })

  it('degrades a slice whose label fits more than one unclaimed pele path', () => {
    // two pele paths share one data-id (should not happen on real pele
    // output, but if a release ever duplicates them, matching by label would
    // be ambiguous) — degrade instead of picking either
    const svg = syntheticSvg(
      '<g class="pele-slices">' +
        '<path class="pele-slice" data-id="cat" d="M0,0"/>' +
        '<path class="pele-slice" data-id="cat" d="M1,1"/>' +
        '</g>',
    )
    const result = correlatePelePie(svg, fakeGraph([{ label: 'cat' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['slice:1'])
    for (const el of svg.querySelectorAll('path.pele-slice')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('degrades a slice pele never rendered a path for', () => {
    // core has two slices, pele rendered one path (e.g. a zero-value slice is
    // skipped by pele) — the missing one degrades to view-only, the rendered
    // one still correlates
    const svg = syntheticSvg('<g class="pele-slices"><path class="pele-slice" data-id="cat" d="M0,0"/></g>')
    const result = correlatePelePie(svg, fakeGraph([{ label: 'cat' }, { label: 'dog' }]))
    expect(result.nodes.get('slice:1')).toBeTruthy()
    expect(result.failed).toEqual(['slice:2'])
    expect(svg.querySelector('path.pele-slice')!.getAttribute('data-mw-entity')).toBe('slice:1')
  })

  it('never tags pele scenery outside the slice/legend selectors', () => {
    // the empty-pie circle pele renders when no slice has a value, and the
    // percent/label texts, are chrome — never tagged
    const svg = syntheticSvg(
      '<g class="pele-slices"><circle class="pele-slice" r="10"/></g>' +
        '<g class="pele-legend"><g class="pele-legend-item" data-id="cat"><rect/></g></g>',
    )
    const result = correlatePelePie(svg, fakeGraph([{ label: 'cat' }]))
    // the circle carries no data-id, so the slice degrades; the legend row is
    // only tagged alongside its claimed slice
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['slice:1'])
    expect(svg.querySelector('g.pele-legend-item')!.hasAttribute('data-mw-entity')).toBe(false)
  })
})

describe('view dispatch', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('dispatches pie charts through the pele correlator', async () => {
    const { view } = await mountWithView(container, SAMPLE)
    expect(container.querySelector('svg')).toBeTruthy()
    for (const label of ['cat', 'dog', 'fish'] as const) {
      expect(container.querySelector(`path.pele-slice[data-id="${label}"][data-mw-entity]`)).toBeTruthy()
      expect(container.querySelector(`g.pele-legend-item[data-id="${label}"][data-mw-entity]`)).toBeTruthy()
    }
    expect(container.querySelector('[data-mw-entity="slice:2"]')).toBeTruthy()
    view.destroy()
  })

  // Step 5 style spot-check: pele maps mermaid's `pie1..pie8` themeVariables
  // onto `--pele-series-1..8` (verified against pele@1.13.0) — a configured
  // slice color must land visibly in the rendered SVG, and the styled slice
  // must still correlate.
  it('round-trips a configured slice color visibly under pele', async () => {
    const { editor, view } = await mountWithView(container, SAMPLE, {
      config: { themeVariables: { pie1: '#ff0000' } },
    })
    expect(container.querySelector('svg')).toBeTruthy()
    // pele paints the series palette onto the root svg's style attribute
    expect(container.querySelector('svg')!.getAttribute('style')).toContain('--pele-series-1:#ff0000')
    // the styled (first) slice still correlates after the re-render
    const styled = container.querySelector('path.pele-slice[data-id="cat"]')!
    expect(styled).toBeTruthy()
    expect(styled.getAttribute('data-mw-entity')).toBe('slice:1')
    expect(editor.result.pie!.slices[0].entityId).toBe('slice:1')
    view.destroy()
  })
})
