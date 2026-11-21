// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type LineItemsGraph } from '@visimer/core'
import { correlatePeleLineItems } from '../src/correlate.pele.lineitems'
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

// playground sample strings (apps/js-playground/src/samples.ts) — core-parseable
// and pele-renderable; the selectors below are pinned by probing pele@1.13.0
// with exactly these strings (see task-6 report).
const SAMPLES: Record<string, string> = {
  kanban: `kanban
  Todo
    [Create Documentation]
    docs[Create Blog about the new diagram]
  [In progress]
    id6[Create renderer so that it works in all cases]
  id9[Ready for deploy]
    id8[Design grammar]
`,
  gitgraph: `gitGraph
  commit
  commit
  branch develop
  checkout develop
  commit
  commit
  checkout main
  merge develop
  commit
`,
  journey: `journey
  title My working day
  section Go to work
    Make tea: 5: Me
    Go upstairs: 3: Me
    Do work: 1: Me, Cat
  section Go home
    Go downstairs: 5: Me
    Sit down: 5: Me
`,
  timeline: `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook
       : Google
  2005 : YouTube
  2006 : Twitter
`,
  sankey: `sankey-beta
Agricultural 'waste',Bio-conversion,124.729
Bio-conversion,Liquid,0.597
Bio-conversion,Losses,26.862
Bio-conversion,Solid,280.322
Bio-conversion,Gas,81.144
`,
  mindmap: `mindmap
  root((visimer))
    Parsing
      Lossless CST
      Statement classifier
    Editing
      Semantic ops
      Minimal diffs
    Rendering
      Mermaid SVG
      Interaction overlay
`,
  treemap: `treemap-beta
"Products"
    "Electronics"
        "Phones": 50
        "Laptops": 30
    "Furniture"
        "Chairs": 20
        "Tables": 15
`,
  packet: `packet-beta
0-15: "Source Port"
16-31: "Destination Port"
32-63: "Sequence Number"
64-95: "Acknowledgment Number"
`,
  radar: `radar-beta
  title Grades
  axis m["Math"], s["Science"], e["English"]
  axis h["History"], g["Geography"], a["Art"]
  curve alice["Alice"]{85, 90, 80, 70, 75, 90}
  curve bob["Bob"]{70, 75, 85, 80, 90, 85}
  max 100
  min 0
`,
  xychart: `xychart-beta
  title "Sales Revenue"
  x-axis [jan, feb, mar, apr, may, jun]
  y-axis "Revenue (in $)" 4000 --> 11000
  bar [5000, 6000, 7500, 8200, 9500, 10500]
  line [5000, 6000, 7500, 8200, 9500, 10500]
`,
  architecture: `architecture-beta
  group api(cloud)[API]

  service db(database)[Database] in api
  service disk1(disk)[Storage] in api
  service disk2(disk)[Storage] in api
  service server(server)[Server] in api

  db:L -- R:server
  disk1:T -- B:server
  disk2:T -- B:db
`,
  requirement: `requirementDiagram
  requirement test_req {
    id: 1
    text: the test text.
    risk: high
    verifymethod: test
  }
  element test_entity {
    type: simulation
  }
  test_entity - satisfies -> test_req
`,
  c4: `C4Context
  title System Context diagram for Internet Banking System
  Person(customerA, "Banking Customer A", "A customer of the bank.")
  System(SystemAA, "Internet Banking System", "Allows customers to check accounts.")
  System_Ext(SystemE, "Mainframe Banking System", "Stores core banking information.")
  Rel(customerA, SystemAA, "Uses")
  Rel(SystemAA, SystemE, "Uses")
`,
  block: `block-beta
columns 1
  db(("DB"))
  blockArrowId6<["&nbsp;&nbsp;&nbsp;"]>(down)
  block:ID
    A
    B["A wide one in the middle"]
    C
  end
  space
  D
  ID --> D
  C --> D
  style B fill:#969,stroke:#333,stroke-width:4px
`,
  quadrant: `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 We should expand
  quadrant-2 Need to promote
  quadrant-3 Re-evaluate
  quadrant-4 May be improved
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]
  Campaign C: [0.57, 0.69]
`,
}

/** render a code string with real pele, correlate it against core's lineItems graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.lineItems
  if (!graph) throw new Error('code did not produce a lineItems graph')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePeleLineItems(svg, graph) }
}

/** item ids for 1-based source lines (entity ids are `item:<lineIndex>`) */
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `item:${from + i}`)

/** mount code through the full view with a pele adapter */
async function mountWithView(container: HTMLElement, code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const view = new MermaidCanvasView({
    editor,
    container,
    renderer: peleAdapter({ render: (src, opts) => peleRender(src, opts) }),
    debounceMs: 0,
  })
  // drain microtasks and the macrotask queue so the render lands
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  return { editor, view }
}

function syntheticSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = `<svg>${markup}</svg>`
  return host.querySelector('svg')!
}

function fakeGraph(typeId: string, items: Array<{ id: string; matchText: string | null }>): LineItemsGraph {
  return {
    typeId,
    headerLine: 0,
    items: items.map((it, i) => ({
      entityId: it.id,
      text: it.matchText ?? `line ${i}`,
      matchText: it.matchText,
      lineIndex: i + 1,
    })),
    lastContentLine: items.length,
    addTemplate: 'x',
  } as unknown as LineItemsGraph
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleLineItems — per-type fixtures (playground samples, pele@1.13.0 surface)', () => {
  it('kanban: cards and columns by data-id, id-less cards and bracket columns by label text', () => {
    const { result, svg, graph } = correlate(SAMPLES.kanban)
    // 7 statement lines, every one has a matchText
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 7))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(7)
    // column by data-id (item text "Todo" == column id)
    expect(result.nodes.get('item:1')!.getAttribute('data-id')).toBe('Todo')
    // card with no explicit id: the label IS the id
    expect(result.nodes.get('item:2')!.getAttribute('data-id')).toBe('Create Documentation')
    // card `docs[...]`: data-id is the card id, the label text wraps across
    // two text.pele-label elements — matched via the joined label text
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('docs')
    // bracket column `[In progress]`
    expect(result.nodes.get('item:4')!.getAttribute('data-id')).toBe('In progress')
    // wrapped label across two lines again
    expect(result.nodes.get('item:5')!.getAttribute('data-id')).toBe('id6')
    // `id9[Ready for deploy]` renders as a COLUMN whose visible label is the
    // bracket text (data-id is the card id) — matched via its cluster label
    expect(result.nodes.get('item:6')!.classList.contains('pele-column')).toBe(true)
    expect(result.nodes.get('item:7')!.getAttribute('data-id')).toBe('id8')
    // mermaid parity: hits get pointer-events re-enabled
    expect(result.nodes.get('item:2')!.style.pointerEvents).toBe('auto')
    // card counts (text.pele-count) and nothing else outside the groups is tagged
    for (const el of svg.querySelectorAll('text.pele-count')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('gitgraph: unique branch references match g.pele-branch; repeated references and id-less commits degrade', () => {
    const { result, svg, graph } = correlate(SAMPLES.gitgraph)
    // items: commits (null matchText), branch/checkout/merge (branch name)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 9))
    // `checkout main` is the ONLY item referencing main → the branch correlates
    expect(result.nodes.get('item:7')!.classList.contains('pele-branch')).toBe(true)
    expect(result.nodes.get('item:7')!.getAttribute('data-id')).toBe('main')
    // `branch develop` / `checkout develop` / `merge develop` all resolve to the
    // same branch surface — duplicate item text degrades BOTH sides, never mis-pairs
    expect(result.failed).toEqual([...ids(1, 6), 'item:8', 'item:9'])
    expect(result.nodes.get('item:3')).toBeUndefined()
    for (const el of svg.querySelectorAll('g.pele-commit')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
    expect(svg.querySelectorAll('g.pele-branch[data-mw-entity]')).toHaveLength(1)
  })

  it('journey: tasks and sections by data-id, title via standalone text', () => {
    const { result, svg, graph } = correlate(SAMPLES.journey)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 8))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(8)
    expect(result.nodes.get('item:2')!.getAttribute('data-id')).toBe('Go to work')
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('Make tea')
    expect(result.nodes.get('item:6')!.getAttribute('data-id')).toBe('Go home')
    // the title text (no data-id) is tagged through its anchor
    const title = svg.querySelector('text.pele-title')!
    expect(title.closest('[data-mw-entity]')!.getAttribute('data-mw-entity')).toBe('item:1')
    // the actor legend is scenery core does not model — never tagged
    for (const el of svg.querySelectorAll('g.pele-legend-item')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('timeline: events by label text (no data-id); period nodes stay untagged scenery', () => {
    const { result, svg, graph } = correlate(SAMPLES.timeline)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 6))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(6)
    // the title correlates through its text
    expect(svg.querySelector('text.pele-title')!.closest('[data-mw-entity]')!.getAttribute('data-mw-entity')).toBe('item:1')
    // events carry no data-id — matched by their label text, anchored on the event group
    const event = result.nodes.get('item:2')!
    expect(event.classList.contains('pele-event')).toBe(true)
    expect(event.textContent).toContain('LinkedIn')
    expect(result.nodes.get('item:4')!.textContent).toContain('Google')
    // pele-period nodes (data-id = the period label) are never claimed by event items
    for (const el of svg.querySelectorAll('g.pele-period')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('sankey: link lines derive their A->B key and match path.pele-sankey-link data-ids', () => {
    const { result, svg, graph } = correlate(SAMPLES.sankey)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 5))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(5)
    expect(result.nodes.get('item:1')!.getAttribute('data-id')).toBe("Agricultural 'waste'->Bio-conversion")
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('Bio-conversion->Losses')
    expect(result.nodes.get('item:1')!.tagName.toLowerCase()).toBe('path')
    // node rects and labels are node scenery — link items never claim them
    for (const el of svg.querySelectorAll('rect.pele-sankey-node, g.pele-label')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('mindmap: nodes by data-id, the root via its label text (data-id is the generic "root")', () => {
    const { result, svg, graph } = correlate(SAMPLES.mindmap)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 10))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(10)
    expect(result.nodes.get('item:2')!.getAttribute('data-id')).toBe('Parsing')
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('Lossless CST')
    // root((visimer)): pele stamps data-id="root", the label is "visimer"
    const root = result.nodes.get('item:1')!
    expect(root.getAttribute('data-id')).toBe('root')
    expect(root.classList.contains('pele-root')).toBe(true)
    // branch wrapper groups are scenery — never tagged
    for (const el of svg.querySelectorAll('g.pele-branch')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('treemap: sections and leaves by data-id', () => {
    const { result, svg, graph } = correlate(SAMPLES.treemap)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 7))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(7)
    expect(result.nodes.get('item:1')!.getAttribute('data-id')).toBe('Products')
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('Phones')
    expect(result.nodes.get('item:6')!.getAttribute('data-id')).toBe('Chairs')
  })

  it('packet: fields by their label text (data-id is the bit range)', () => {
    const { result, graph } = correlate(SAMPLES.packet)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 4))
    expect(result.failed).toEqual([])
    expect(result.nodes.size).toBe(4)
    expect(result.nodes.get('item:1')!.getAttribute('data-id')).toBe('0-15')
    expect(result.nodes.get('item:1')!.textContent).toContain('Source Port')
    expect(result.nodes.get('item:4')!.getAttribute('data-id')).toBe('64-95')
  })

  it('radar: axis labels by axis text, curves via their legend entry; title and max/min degrade', () => {
    const { result, svg, graph } = correlate(SAMPLES.radar)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 7))
    // `title Grades` has no quoted match text (radar extracts quoted strings
    // only), same for `max 100` / `min 0` — code-only
    expect(result.failed).toEqual(['item:1', 'item:6', 'item:7'])
    expect(result.nodes.size).toBe(4)
    // `axis m["Math"], ...` — one line, first quoted label is the match text
    expect(result.nodes.get('item:2')!.getAttribute('data-id')).toBe('m')
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('h')
    // `curve alice["Alice"]`: the curve path carries data-id "alice" (different
    // case, no text) — the legend entry is the matchable text surface
    expect(result.nodes.get('item:4')!.classList.contains('pele-legend-item')).toBe(true)
    expect(result.nodes.get('item:4')!.getAttribute('data-id')).toBe('alice')
    expect(result.nodes.get('item:5')!.getAttribute('data-id')).toBe('bob')
    // curve paths are never claimed (their data-id never equals the match text)
    expect(svg.querySelectorAll('path.pele-curve[data-mw-entity]')).toHaveLength(0)
  })

  it('xychart: only the title line has a matchable surface', () => {
    const { result, graph } = correlate(SAMPLES.xychart)
    expect(graph.items.map((i) => i.entityId)).toEqual(ids(1, 5))
    // x/y-axis, bar and line statements have no matchText — code-only
    expect(result.failed).toEqual(ids(2, 5))
    expect(result.nodes.size).toBe(1)
  })

  it('architecture: services and groups by label text; duplicated service labels degrade', () => {
    const { result, svg, graph } = correlate(SAMPLES.architecture)
    // group, 4 services, 3 edges
    expect(graph.items.map((i) => i.entityId)).toEqual([...ids(1, 1), ...ids(3, 6), ...ids(8, 10)])
    // core's architecture extractor yields the SHAPE keyword (firstBracketed
    // prefers the parens: "cloud", "database", "disk", "server"), not the
    // display name — so only the `server` line (whose shape keyword coincides
    // with pele's data-id) correlates; the display names and the `disk` pair
    // (duplicate key) degrade rather than mis-pair
    expect(result.failed).toEqual(['item:1', 'item:3', 'item:4', 'item:5', 'item:8', 'item:9', 'item:10'])
    expect(result.nodes.size).toBe(1)
    expect(result.nodes.get('item:6')!.getAttribute('data-id')).toBe('server')
    // no display-name text ever claims a node (matchText is the shape keyword)
    expect(svg.querySelector('g.pele-node[data-id="db"]')!.hasAttribute('data-mw-entity')).toBe(false)
    // edges have no matchText — no edge groups tagged
    expect(svg.querySelectorAll('g.pele-edge[data-mw-entity]')).toHaveLength(0)
  })

  it('requirement: requirements and elements by data-id; field rows and the relationship degrade', () => {
    const { result, svg, graph } = correlate(SAMPLES.requirement)
    expect(result.nodes.size).toBe(2)
    expect(result.nodes.get('item:1')!.getAttribute('data-id')).toBe('test_req')
    expect(result.nodes.get('item:1')!.classList.contains('pele-requirement')).toBe(true)
    expect(result.nodes.get('item:7')!.getAttribute('data-id')).toBe('test_entity')
    // field rows (`id: 1`, ...) and the relationship line have no matchable name
    const expectedFailed = graph.items
      .filter((i) => !['item:1', 'item:7'].includes(i.entityId))
      .map((i) => i.entityId)
    expect(result.failed).toEqual(expectedFailed)
    expect(svg.querySelectorAll('g.pele-edge[data-mw-entity]')).toHaveLength(0)
  })

  it('c4: persons/systems by their display name; duplicate "Uses" relationship labels degrade', () => {
    const { result, svg, graph } = correlate(SAMPLES.c4)
    expect(result.nodes.size).toBe(3)
    expect(result.nodes.get('item:2')!.getAttribute('data-id')).toBe('customerA')
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('SystemAA')
    expect(result.nodes.get('item:4')!.getAttribute('data-id')).toBe('SystemE')
    // both Rel lines render a label "Uses" — duplicate item text, degrade BOTH
    const expectedFailed = graph.items
      .filter((i) => !['item:2', 'item:3', 'item:4'].includes(i.entityId))
      .map((i) => i.entityId)
    expect(result.failed).toEqual(expectedFailed)
    expect(svg.querySelectorAll('g.pele-edge[data-mw-entity], g.pele-edge-label[data-mw-entity]')).toHaveLength(0)
  })

  it('block: single-word and bracketed blocks by data-id, shaped blocks by label text', () => {
    const { result, svg, graph } = correlate(SAMPLES.block)
    expect(result.nodes.size).toBe(6)
    // A, B, C, D are plain data-id matches (B's match text is its label, but its
    // data-id "B" is matched through the label text)
    expect(result.nodes.get('item:5')!.getAttribute('data-id')).toBe('A')
    expect(result.nodes.get('item:6')!.getAttribute('data-id')).toBe('B')
    expect(result.nodes.get('item:10')!.getAttribute('data-id')).toBe('D')
    // db(("DB")): data-id is "db", label text "DB"
    expect(result.nodes.get('item:2')!.getAttribute('data-id')).toBe('db')
    // blockArrowId6's label is literally "&nbsp;" entities — decoded on both sides
    expect(result.nodes.get('item:3')!.getAttribute('data-id')).toBe('blockArrowId6')
    // `columns 1`, `block:ID`, `space`, edges and the style line degrade
    const expectedFailed = graph.items
      .filter((i) => !ids(2, 3).concat(ids(5, 7), ['item:10']).includes(i.entityId))
      .map((i) => i.entityId)
    expect(result.failed).toEqual(expectedFailed)
    // the `block:ID` cluster has no item with a matchable name — never tagged
    expect(svg.querySelector('g.pele-cluster[data-id="ID"]')!.hasAttribute('data-mw-entity')).toBe(false)
  })

  it('quadrant: points by data-id; axes and quadrant titles have no matchText', () => {
    const { result, svg, graph } = correlate(SAMPLES.quadrant)
    expect(result.nodes.size).toBe(3)
    expect(result.nodes.get('item:8')!.getAttribute('data-id')).toBe('Campaign A')
    expect(result.nodes.get('item:9')!.getAttribute('data-id')).toBe('Campaign B')
    expect(result.nodes.get('item:10')!.getAttribute('data-id')).toBe('Campaign C')
    const expectedFailed = graph.items.filter((i) => !ids(8, 10).includes(i.entityId)).map((i) => i.entityId)
    expect(result.failed).toEqual(expectedFailed)
    // quadrant background tiles are scenery — never tagged
    for (const el of svg.querySelectorAll('g.pele-quadrant')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })
})

describe('correlatePeleLineItems — adversarial', () => {
  it('duplicate kanban card text degrades BOTH cards — never mis-pairs', () => {
    const { result, svg } = correlate(`kanban
  Col
    a[Same]
    b[Same]
`)
    // the column still correlates; the two identically-named cards do not
    expect(result.nodes.size).toBe(1)
    expect(result.failed).toEqual(['item:2', 'item:3'])
    for (const el of svg.querySelectorAll('g.pele-card')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('one item matching two candidate groups is ambiguous — degrades instead of guessing', () => {
    const svg = syntheticSvg(
      '<g class="pele-node" data-id="x1"><text>Dup</text></g>' +
        '<g class="pele-node" data-id="x2"><text>Dup</text></g>',
    )
    const result = correlatePeleLineItems(svg, fakeGraph('mindmap', [{ id: 'item:1', matchText: 'Dup' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['item:1'])
    for (const el of svg.querySelectorAll('g.pele-node')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('class-filters the sweep: text outside the type\u2019s candidate groups is never claimed', () => {
    // a stray text in a non-candidate group plus an unrelated pele-node — a
    // mindmap item must only ever land on g.pele-node, so the stray stays free
    const svg = syntheticSvg(
      '<g class="pele-branch"><text>Parsing</text></g>' +
        '<g class="pele-node" data-id="Other"><text>Other</text></g>',
    )
    const result = correlatePeleLineItems(svg, fakeGraph('mindmap', [{ id: 'item:1', matchText: 'Parsing' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['item:1'])
    expect(svg.querySelector('g.pele-branch text')!.hasAttribute('data-mw-entity')).toBe(false)
  })

  it('items with null matchText are code-only and never claim anything', () => {
    const svg = syntheticSvg('<g class="pele-node" data-id="a"><text>hello</text></g>')
    const result = correlatePeleLineItems(svg, fakeGraph('mindmap', [{ id: 'item:1', matchText: null }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['item:1'])
    expect(svg.querySelector('g.pele-node')!.hasAttribute('data-mw-entity')).toBe(false)
  })

  it('a claimed element is exclusive: a second item whose only hit is taken degrades', () => {
    // two items, keys "a" (data-id hit) and "a" again via text on the same group
    const svg = syntheticSvg('<g class="pele-node" data-id="a"><text>b</text></g>')
    const result = correlatePeleLineItems(
      svg,
      fakeGraph('block', [
        { id: 'item:1', matchText: 'a' },
        { id: 'item:2', matchText: 'b' },
      ]),
    )
    // item:1 claims the group by data-id; item:2's text hit is the same,
    // already-claimed group — degrades rather than double-tagging
    expect(result.nodes.get('item:1')).toBeTruthy()
    expect(result.failed).toEqual(['item:2'])
  })
})

describe('view dispatch + style spot-check', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('dispatches line-item types through the pele correlator', async () => {
    const { view } = await mountWithView(container, SAMPLES.kanban)
    expect(container.querySelector('svg')).toBeTruthy()
    const cards = container.querySelectorAll('g.pele-card[data-mw-entity]')
    expect(cards.length).toBeGreaterThan(0)
    expect(container.querySelector('[data-mw-entity="item:3"]')).toBeTruthy()
    // columns and cards both tagged, counts never
    expect(container.querySelector('g.pele-column[data-mw-entity]')).toBeTruthy()
    expect(container.querySelector('text.pele-count[data-mw-entity]')).toBeNull()
    view.destroy()
  })

  it('style op round-trips: selecting a kanban card marks it visibly and it stays correlated', async () => {
    const { editor, view } = await mountWithView(container, SAMPLES.kanban)
    const card = container.querySelector('g.pele-card[data-mw-entity="item:2"]')!
    expect(card).toBeTruthy()
    // click the card through the view's real click path
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(editor.selection).toEqual(['item:2'])
    // the selection style op lands on the same element the correlator tagged
    expect(card.classList.contains('mw-selected')).toBe(true)
    // and the correlation survives (the element is still the tagged anchor)
    expect(container.querySelector('[data-mw-entity="item:2"]')).toBe(card)
    view.destroy()
  })
})
