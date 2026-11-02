// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type StateGraph } from '@visimer/core'
import { correlatePeleState } from '../src/correlate.pele.state'
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

const SAMPLE = `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  state Processing {
    [*] --> Run
    Run --> Done
  }
  Processing --> Idle: retry
  Done --> [*]
`

/** render a code string with real pele, correlate it against core's state graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.state
  if (!graph) throw new Error('code did not parse as a state diagram')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePeleState(svg, graph) }
}

/** minimal StateGraph for synthetic-DOM tests (decode entities, leftover zip) */
function fakeGraph(states: Array<{ id: string; composite?: boolean }>): StateGraph {
  return {
    states: states.map((s) => ({
      entityId: `state:${s.id}`,
      id: s.id,
      label: s.id,
      decl: null,
      declLines: [],
      refLines: [],
      firstRefLine: 0,
      parent: null,
      isComposite: s.composite ?? false,
      stereotype: null,
      typeDeclLine: null,
    })),
    transitions: [],
  } as unknown as StateGraph
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleState', () => {
  it('correlates states, the composite cluster, transitions and labels', () => {
    const { result, svg, graph } = correlate(SAMPLE)

    // every simple state lands on its pele-state group (data-id compare goes
    // through decodeEntities), tagged with its entity id
    for (const id of ['Idle', 'Run', 'Done'] as const) {
      const el = result.nodes.get(`state:${id}`)!
      expect(el).toBeTruthy()
      expect(el).toBe(svg.querySelector(`g.pele-state[data-id="${id}"]`))
      expect(el.getAttribute('data-mw-entity')).toBe(`state:${id}`)
    }

    // the composite state correlates to its pele-cluster (pele renders
    // composites as clusters, not pele-state boxes), and the cluster-label
    // inside is tagged too
    const cluster = result.nodes.get('state:Processing')!
    expect(cluster).toBe(svg.querySelector('g.pele-cluster.pele-state-composite[data-id="Processing"]'))
    expect(cluster.getAttribute('data-mw-entity')).toBe('state:Processing')
    const label = cluster.querySelector('.pele-cluster-label')!
    expect(label).toBeTruthy()
    expect(label.getAttribute('data-mw-entity')).toBe('state:Processing')

    // transitions zip in document order, count-checked: 6 core transitions
    // (including the two `[*]` ones) against 6 pele-transition groups
    expect(svg.querySelectorAll('g.pele-edge.pele-transition')).toHaveLength(6)
    expect(result.edges.size).toBe(6)
    for (const t of graph.transitions) {
      const path = result.edges.get(t.entityId)!
      expect(path).toBeTruthy()
      expect(path.tagName.toLowerCase()).toBe('path')
      // the inner <path> is the visible line, never the pele-marker arrowhead
      expect(path.classList.contains('pele-marker')).toBe(false)
      expect(path.getAttribute('data-mw-entity')).toBe(t.entityId)
      expect(path.closest('g.pele-edge')?.getAttribute('data-id')).toBe(`edge${t.order}`)
      // the transparent hit-overlay sibling clone exists for the visible path
      const overlay = path.parentElement!.querySelector(`[data-mw-hit-overlay="${t.entityId}"]`)
      expect(overlay).toBeTruthy()
      expect(overlay!.getAttribute('d')).toBe(path.getAttribute('d'))
    }
    expect(result.failed).toEqual([])
  })

  it('correlates labeled transition labels to their edge groups', () => {
    const { result, svg } = correlate(SAMPLE)
    // pele only renders label groups for labeled transitions; the label's
    // data-id equals its edge group's data-id
    const start = result.edgeLabels.get('trans:Idle->Processing#0')!
    expect(start).toBe(svg.querySelector('g.pele-edge-label[data-id="edge1"]'))
    expect(start.getAttribute('data-mw-entity')).toBe('trans:Idle->Processing#0')
    expect(start.textContent).toContain('start')
    const retry = result.edgeLabels.get('trans:Processing->Idle#0')!
    expect(retry).toBe(svg.querySelector('g.pele-edge-label[data-id="edge4"]'))
    expect(retry.getAttribute('data-mw-entity')).toBe('trans:Processing->Idle#0')
    expect(retry.textContent).toContain('retry')
    // unlabeled transitions claim no label group
    expect(result.edgeLabels.size).toBe(2)
    expect(result.failed).toEqual([])
  })

  it('never tags [*] scenery (pele-state-start / pele-state-end)', () => {
    const { result, svg } = correlate(SAMPLE)
    for (const id of ['root_start', 'root_end', 'Processing_start'] as const) {
      const el = svg.querySelector(`g.pele-state-${id.endsWith('start') ? 'start' : 'end'}[data-id="${id}"]`)
      expect(el).toBeTruthy()
      expect(el!.hasAttribute('data-mw-entity')).toBe(false)
      // no descendant scenery picked up an entity tag either
      for (const child of el!.querySelectorAll('[data-mw-entity]')) {
        expect(child).toBeNull()
      }
    }
    // and no state entity ever points at a pseudo-state element
    for (const el of result.nodes.values()) {
      expect(el.classList.contains('pele-state-start')).toBe(false)
      expect(el.classList.contains('pele-state-end')).toBe(false)
    }
  })

  // adversarial: with counts mismatched (an extra pele renders a group core
  // has no transition for) the zip must degrade EVERY transition rather than
  // shift pairings. pele's edge list mirrors core's transitions 1:1 for every
  // source we probed, so the mismatch is injected the same way the flowchart
  // suite injects foreign pele-cluster-titles DOM.
  it('degrades every transition when counts mismatch (never mis-zips)', () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const graph = editor.result.state!
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    host.innerHTML = peleRender(SAMPLE).svg
    const svg = host.querySelector('svg')!
    // one foreign group: 7 DOM groups vs 6 core transitions
    svg.querySelector('g.pele-edges')!.insertAdjacentHTML(
      'beforeend',
      '<g class="pele-edge pele-transition" data-id="edge6"><path d="M0,0L10,10"/><path class="pele-marker" d="M10,10"/></g>',
    )
    const result = correlatePeleState(svg, graph)
    expect(result.edges.size).toBe(0)
    expect(result.failed).toEqual(graph.transitions.map((t) => t.entityId))
    // no rendered path was tagged with anyone's entity
    for (const path of svg.querySelectorAll('g.pele-edge.pele-transition path')) {
      expect(path.hasAttribute('data-mw-entity')).toBe(false)
    }
    // states are unaffected by the transition degradation
    expect(result.nodes.get('state:Idle')).toBe(svg.querySelector('g.pele-state[data-id="Idle"]'))
    // and labels degrade with their edges (no claimed edge to match against)
    expect(result.edgeLabels.size).toBe(0)
    for (const label of svg.querySelectorAll('g.pele-edge-label')) {
      expect(label.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  // label-side count check: an extra label group makes the counts disagree,
  // so every label degrades instead of shifting onto the wrong transition
  it('degrades labels when label-group counts mismatch', () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const graph = editor.result.state!
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    host.innerHTML = peleRender(SAMPLE).svg
    const svg = host.querySelector('svg')!
    svg.querySelector('g.pele-edge-labels')!.insertAdjacentHTML(
      'beforeend',
      '<g class="pele-edge-label" data-id="edge9"><text>stray</text></g>',
    )
    const result = correlatePeleState(svg, graph)
    expect(result.edgeLabels.size).toBe(0)
    for (const label of svg.querySelectorAll('g.pele-edge-label')) {
      expect(label.hasAttribute('data-mw-entity')).toBe(false)
    }
    // transitions themselves still correlate
    expect(result.edges.size).toBe(graph.transitions.length)
  })

  it('correlates entity-coded graph ids against DOM-decoded data-ids', () => {
    const host = document.createElement('div')
    hosts.push(host)
    // the attribute value is S"x after HTML parsing; the graph id arrives encoded
    host.innerHTML = '<svg><g class="pele-node pele-state" data-id="S&quot;x"><rect/></g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleState(svg, fakeGraph([{ id: 'S&quot;x' }]))
    const el = result.nodes.get('state:S&quot;x')!
    expect(el).toBe(svg.querySelector('g.pele-state'))
    expect(el.getAttribute('data-mw-entity')).toBe('state:S&quot;x')
    expect(result.failed).toEqual([])
  })

  it('zips leftover states in DOM order when data-id matching misses', () => {
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes">' +
      '<g class="pele-node pele-state" data-id="Unknown1"><rect/></g>' +
      '<g class="pele-node pele-state" data-id="Unknown2"><rect/></g>' +
      '</g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleState(svg, fakeGraph([{ id: 'P' }, { id: 'Q' }]))
    expect(result.nodes.get('state:P')).toBe(svg.querySelector('[data-id="Unknown1"]'))
    expect(result.nodes.get('state:Q')).toBe(svg.querySelector('[data-id="Unknown2"]'))
    expect(result.failed).toEqual([])
  })

  it('degrades leftover states when counts disagree', () => {
    const host = document.createElement('div')
    hosts.push(host)
    // core has two states, pele rendered only one — the zip must not fire
    host.innerHTML = '<svg><g class="pele-nodes"><g class="pele-node pele-state" data-id="X"><rect/></g></g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleState(svg, fakeGraph([{ id: 'P' }, { id: 'Q' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['state:P', 'state:Q'])
    expect(svg.querySelector('[data-id="X"]')!.hasAttribute('data-mw-entity')).toBe(false)
  })
})

/** drain microtasks and the macrotask queue so renders in flight land */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('view dispatch', () => {
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

  it('dispatches state diagrams through the pele correlator', async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    await flush()
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('[data-mw-entity="state:Idle"]')).toBeTruthy()
    expect(container.querySelector('[data-mw-entity="state:Processing"]')).toBeTruthy()
    expect(container.querySelector('[data-mw-entity="trans:Idle->Processing#0"]')).toBeTruthy()
    // scenery stays untagged through the view path too
    expect(container.querySelector('.pele-state-start[data-mw-entity]')).toBeNull()
    expect(container.querySelector('.pele-state-end[data-mw-entity]')).toBeNull()
  })

  // Step 5 style spot-check: pele's allowlist keeps state classDef styling —
  // the re-rendered SVG must visibly change (fill on the state's rect), and
  // the styled state must still correlate
  it('keeps classDef state styling visible under pele', async () => {
    const editor = new MermaidWysiwygEditor({
      code: 'stateDiagram-v2\n  classDef bad fill:#f00,stroke:#900\n  A: my state\n  A --> B\n  class A bad\n',
    })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    await flush()
    expect(container.querySelector('svg')).toBeTruthy()
    const rect = container.querySelector('[data-mw-entity="state:A"] rect')
    expect(rect).toBeTruthy()
    expect(rect!.getAttribute('style')).toContain('fill:#f00')
  })
})
