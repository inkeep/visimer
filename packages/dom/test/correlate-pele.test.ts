// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type FlowGraph, type FlowNode } from '@visimer/core'
import { correlatePeleFlowchart, decodeEntities } from '../src/correlate.pele'
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

/** render a code string with real pele, correlate it against core's graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.flowchart!
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePeleFlowchart(svg, graph) }
}
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleFlowchart', () => {
  it('correlates nodes, edge paths and edge labels of a standard flowchart', () => {
    const { result, svg } = correlate(
      'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]\n',
    )
    // nodes land on the pele node groups, tagged
    for (const [entityId, id] of [
      ['node:A', 'A'],
      ['node:B', 'B'],
      ['node:C', 'C'],
    ] as const) {
      const el = result.nodes.get(entityId)!
      expect(el).toBeTruthy()
      expect(el).toBe(svg.querySelector(`g.pele-node[data-id="${id}"]`))
      expect(el.getAttribute('data-mw-entity')).toBe(entityId)
    }
    // edges land on the inner <path> of the right pele-edge group
    const ab = result.edges.get('edge:A->B#0')!
    const bc = result.edges.get('edge:B->C#0')!
    expect(ab).toBeTruthy()
    expect(bc).toBeTruthy()
    expect(ab).not.toBe(bc)
    expect(ab.closest('g.pele-edge')?.getAttribute('data-id')).toMatch(/^L_A_B_/)
    expect(bc.closest('g.pele-edge')?.getAttribute('data-id')).toMatch(/^L_B_C_/)
    expect(ab.getAttribute('data-mw-entity')).toBe('edge:A->B#0')
    // the transparent hit-overlay sibling clone exists for the visible path
    const overlay = ab.parentElement!.querySelector('[data-mw-hit-overlay="edge:A->B#0"]')
    expect(overlay).toBeTruthy()
    expect(overlay!.getAttribute('d')).toBe(ab.getAttribute('d'))
    // the labeled edge's label correlates to its pele-edge-label group
    const label = result.edgeLabels.get('edge:B->C#0')!
    expect(label).toBe(svg.querySelector('g.pele-edge-label[data-id="L_B_C_0"]'))
    expect(label.getAttribute('data-mw-entity')).toBe('edge:B->C#0')
    expect(result.failed).toEqual([])
  })

  it('correlates clusters, and struck cluster titles outside their cluster', () => {
    const { result, svg, graph } = correlate(
      'flowchart TD\n  subgraph SG [Group]\n    A[Start] --> B\n  end\n  B --> C\n',
    )
    const cluster = result.nodes.get('subgraph:SG')!
    expect(cluster).toBe(svg.querySelector('g.pele-cluster[data-id="SG"]'))
    expect(cluster.getAttribute('data-mw-entity')).toBe('subgraph:SG')

    // pele draws struck cluster titles in a top-level group OUTSIDE their
    // cluster (pele src/svg/cluster.ts:67) — inject that shape and re-correlate
    svg.insertAdjacentHTML(
      'beforeend',
      '<g class="pele-cluster-titles"><g class="pele-cluster-title" data-id="SG">Group</g></g>',
    )
    const again = correlatePeleFlowchart(svg, graph)
    const title = svg.querySelector('g.pele-cluster-title[data-id="SG"]')!
    expect(title.getAttribute('data-mw-entity')).toBe('subgraph:SG')
    // the title is tagged but not stored — selection styling queries the DOM
    expect(again.nodes.get('subgraph:SG')).toBe(cluster)
  })

  it('zips duplicate pair edges first-declared to first-in-DOM', () => {
    const { result } = correlate('flowchart TD\n  A -->|one| B\n  A -->|two| B\n')
    const first = result.edges.get('edge:A->B#0')!
    const second = result.edges.get('edge:A->B#1')!
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
    // pele numbers a pair's edges 0, 2, ... (count is per-pair and skips 1) —
    // the zip must follow DOM order, never pele's count
    expect(first.closest('g.pele-edge')?.getAttribute('data-id')).toBe('L_A_B_0')
    expect(second.closest('g.pele-edge')?.getAttribute('data-id')).toBe('L_A_B_2')
    expect(result.edgeLabels.get('edge:A->B#0')?.textContent).toContain('one')
    expect(result.edgeLabels.get('edge:A->B#1')?.textContent).toContain('two')
    expect(result.failed).toEqual([])
  })

  // amended per review ruling: with invisible edges never claimable, the
  // visible member pairs correctly (per-pair: 1 visible vs 1 DOM) and only
  // the invisible edge lands in failed
  it('pairs the visible member and degrades only the invisible one', () => {
    const { result, svg } = correlate('flowchart TD\n  A --> B\n  A ~~~ B\n')
    // pele does not render the invisible edge: one DOM group, one visible edge
    expect(svg.querySelectorAll('g.pele-edge')).toHaveLength(1)
    const path = result.edges.get('edge:A->B#0')!
    expect(path).toBeTruthy()
    expect(path.closest('g.pele-edge')).toBe(svg.querySelector('g.pele-edge'))
    expect(path.getAttribute('data-mw-entity')).toBe('edge:A->B#0')
    // the hit overlay clone sits immediately before the visible path
    expect(path.previousElementSibling?.getAttribute('data-mw-hit-overlay')).toBe('edge:A->B#0')
    expect(result.failed).toEqual(['edge:A->B#1'])
  })

  // review finding 1 (critical): pele omits the invisible `a_b ~~~ c`, but
  // its phantom bucket — L_a_b_c_0 right-parses as a_b->c — used to swallow
  // the group rendered for the visible `a --> b_c` and tag that path with the
  // INVISIBLE edge's entity. Invisible edges are never claimable now; the
  // group survives to the leftover pass, which pairs it with the visible
  // edge unambiguously.
  it('never pairs a rendered path with an invisible edge (phantom bucket)', () => {
    const { result, svg } = correlate('flowchart TD\n  a --> b_c\n  a_b ~~~ c\n')
    expect(svg.querySelectorAll('g.pele-edge')).toHaveLength(1)
    const path = result.edges.get('edge:a->b_c#0')!
    expect(path).toBeTruthy()
    expect(path.getAttribute('data-mw-entity')).toBe('edge:a->b_c#0')
    expect(path.closest('g.pele-edge')?.getAttribute('data-id')).toBe('L_a_b_c_0')
    expect(result.failed).toEqual(['edge:a_b->c#0'])
  })

  // review finding 2 (important): pele renders BOTH edges with the identical
  // data-id L_a_b_c_0 (the subgraph-crossing edge hoists after the regular
  // one, so DOM order is reversed too). Identical ids are indistinguishable —
  // the guarded leftover degrades both rather than cross-pairing them.
  // (node:a_b also degrades: core creates it from the edge ref, but pele
  // renders a_b only as the cluster.)
  it('degrades both edges when leftover candidates are ambiguous (identical data-ids)', () => {
    const { result, svg } = correlate(
      'flowchart TD\n  subgraph a_b [T]\n    c\n  end\n  a_b --> c\n  a --> b_c\n',
    )
    expect(result.edges.size).toBe(0)
    expect(result.failed).toEqual(
      expect.arrayContaining(['edge:a_b->c#0', 'edge:a->b_c#0', 'node:a_b']),
    )
    expect(result.failed).toHaveLength(3)
    for (const path of svg.querySelectorAll('g.pele-edge path')) {
      expect(path.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  // review fix-round-2: pele RENDERS the invisible edge's label (design-doc
  // constraint; verified by probe — the re-review assumed otherwise), as a
  // second g.pele-edge-label with the IDENTICAL data-id L_a_b_c_0. Two
  // prefix-compatible unclaimed candidates for the visible edge's label →
  // ambiguous → the label degrades and is never bound to the invisible
  // edge's entity.
  it('degrades the visible edge label when the invisible twin renders an identical label id', () => {
    const { result, svg } = correlate('flowchart TD\n  a -->|x| b_c\n  a_b ~~~|y| c\n')
    // the visible edge's path pairs via the guarded leftover; the invisible
    // edge itself degrades
    const path = result.edges.get('edge:a->b_c#0')!
    expect(path.closest('g.pele-edge')?.getAttribute('data-id')).toBe('L_a_b_c_0')
    expect(path.getAttribute('data-mw-entity')).toBe('edge:a->b_c#0')
    expect(result.failed).toEqual(['edge:a_b->c#0'])
    // pele renders both label groups (x and y) — none of them is claimable
    expect(svg.querySelectorAll('g.pele-edge-label')).toHaveLength(2)
    expect(result.edgeLabels.size).toBe(0)
    for (const label of svg.querySelectorAll('g.pele-edge-label')) {
      expect(label.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  // same class, the one-label shape: only the invisible edge is labeled, so
  // pele renders exactly one label group — FOR the invisible edge. Invisible
  // edges are view-only, so that label must stay untagged; before the
  // label-pass skip it was zipped 1-vs-1 with the invisible edge's entity.
  it('never lets an invisible edge claim its rendered label group', () => {
    const { result, svg } = correlate('flowchart TD\n  a --> b_c\n  a_b ~~~|y| c\n')
    expect(svg.querySelectorAll('g.pele-edge-label')).toHaveLength(1)
    expect(result.edgeLabels.size).toBe(0)
    expect(svg.querySelector('g.pele-edge-label')!.hasAttribute('data-mw-entity')).toBe(false)
    // the visible edge's path still correlates
    expect(result.edges.get('edge:a->b_c#0')!.getAttribute('data-mw-entity')).toBe('edge:a->b_c#0')
    expect(result.failed).toEqual(['edge:a_b->c#0'])
  })

  // kept per controller ruling: the brief pinned node:a-b / edge:a-b->c#0
  // correlating here, but core's node-id grammar excludes '-' — `a-b --> c`
  // parses as an `unknown` statement, so the graph only ever holds a, b_c and
  // edge:a->b_c#0, while pele renders DOM for the dropped line too. The
  // fixture's point: that foreign DOM is never mis-paired AND never blocks a
  // correct pairing — the visible edge claims its L_a_b_c_0 group through the
  // guarded leftover (its unique prefix-compatible unclaimed candidate), and
  // the foreign L_a-b_c_0 group just stays untagged.
  it('leaves foreign DOM untagged when a source line core cannot parse', () => {
    const { result, svg } = correlate('flowchart TD\n  a-b --> c\n  a --> b_c\n')
    expect(result.nodes.get('node:a')).toBe(svg.querySelector('g.pele-node[data-id="a"]'))
    expect(result.nodes.get('node:b_c')).toBe(svg.querySelector('g.pele-node[data-id="b_c"]'))
    // nodes pele rendered that core dropped stay untagged (view-only)
    expect(svg.querySelector('g.pele-node[data-id="a-b"]')!.hasAttribute('data-mw-entity')).toBe(false)
    expect(svg.querySelector('g.pele-node[data-id="c"]')!.hasAttribute('data-mw-entity')).toBe(false)
    // the visible edge pairs with its own group despite the foreign DOM
    const path = result.edges.get('edge:a->b_c#0')!
    expect(path).toBeTruthy()
    expect(path.closest('g.pele-edge')?.getAttribute('data-id')).toBe('L_a_b_c_0')
    expect(path.getAttribute('data-mw-entity')).toBe('edge:a->b_c#0')
    // the foreign group (rendered for the core-unparseable line) stays untagged
    expect(
      svg.querySelector('g.pele-edge[data-id="L_a-b_c_0"] path')!.hasAttribute('data-mw-entity'),
    ).toBe(false)
    expect(result.failed).toEqual([])
  })

  // leftover-rule success: dots are in core's id grammar, so both lines parse.
  // Pele's data-id for a --> b_c is L_a_b_c_0, which right-parses into the
  // WRONG bucket (a_b -> c) in the pair pass — the leftover rule must
  // reconcile it against exactly that DOM element.
  it('pairs an edge via the leftover rule when its data-id parses into the wrong bucket', () => {
    const { result, svg } = correlate('flowchart TD\n  a.b --> c\n  a --> b_c\n')
    for (const [entityId, id] of [
      ['node:a.b', 'a.b'],
      ['node:c', 'c'],
      ['node:a', 'a'],
      ['node:b_c', 'b_c'],
    ] as const) {
      expect(result.nodes.get(entityId)).toBe(svg.querySelector(`g.pele-node[data-id="${id}"]`))
    }
    const dotEdge = result.edges.get('edge:a.b->c#0')!
    expect(dotEdge).toBeTruthy()
    expect(dotEdge.closest('g.pele-edge')?.getAttribute('data-id')).toMatch(/^L_a\.b_c_/)
    const underscoreEdge = result.edges.get('edge:a->b_c#0')!
    expect(underscoreEdge).toBeTruthy()
    expect(underscoreEdge).not.toBe(dotEdge)
    expect(underscoreEdge.closest('g.pele-edge')?.getAttribute('data-id')).toBe('L_a_b_c_0')
    expect(underscoreEdge.getAttribute('data-mw-entity')).toBe('edge:a->b_c#0')
    expect(result.failed).toEqual([])
  })

  it('correlates entity-coded graph ids against DOM-decoded data-ids', () => {
    const host = document.createElement('div')
    hosts.push(host)
    // the attribute value is A"x after HTML parsing; the graph id arrives encoded
    host.innerHTML = '<svg><g class="pele-node" data-id="A&quot;x"><rect/></g></svg>'
    const svg = host.querySelector('svg')!
    const node: FlowNode = {
      entityId: 'node:x',
      id: 'A&quot;x',
      label: 'A"x',
      shape: 'rect',
      refs: [],
      primary: null,
      classes: [],
      subgraph: null,
    }
    const graph = { nodes: [node], edges: [], subgraphs: [] } as unknown as FlowGraph
    const result = correlatePeleFlowchart(svg, graph)
    const el = result.nodes.get('node:x')!
    expect(el).toBe(svg.querySelector('g.pele-node'))
    expect(el.getAttribute('data-mw-entity')).toBe('node:x')
    expect(result.failed).toEqual([])
  })

  it('decodeEntities decodes the named set and numeric codes, passing unknown through', () => {
    expect(decodeEntities('A&quot;x')).toBe('A"x')
    expect(decodeEntities('a&amp;b')).toBe('a&b')
    expect(decodeEntities('&#65;')).toBe('A')
    expect(decodeEntities('&#x41;')).toBe('A')
    expect(decodeEntities('&nbsp;')).toBe('&nbsp;')
  })

  it('correlates multi-line edge labels', () => {
    const { result, svg } = correlate('flowchart TD\n  A -->|"line1<br/>line2"| B\n')
    const label = result.edgeLabels.get('edge:A->B#0')!
    expect(label).toBe(svg.querySelector('g.pele-edge-label[data-id="L_A_B_0"]'))
    expect(label.getAttribute('data-mw-entity')).toBe('edge:A->B#0')
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

  it('dispatches flowcharts through the pele correlator', async () => {
    const editor = new MermaidWysiwygEditor({
      code: 'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]\n',
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
    expect(container.querySelector('[data-mw-entity="node:A"]')).toBeTruthy()
  })

  it('renders non-flowchart slots view-only under pele', async () => {
    const editor = new MermaidWysiwygEditor({ code: 'pie title Pets\n  "cat": 40\n  "dog": 60\n' })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    await flush()
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelectorAll('[data-mw-entity]')).toHaveLength(0)
  })
})
