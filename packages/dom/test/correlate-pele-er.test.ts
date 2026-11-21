// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type ErGraph } from '@visimer/core'
import { correlatePeleEr } from '../src/correlate.pele.er'
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

const SAMPLE = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string name
    int id
  }
  ORDER ||--|{ LINEITEM : contains
`

/** render a code string with real pele, correlate it against core's er graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.er
  if (!graph) throw new Error('code did not parse as an er diagram')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePeleEr(svg, graph) }
}

/** minimal ErGraph for synthetic-DOM tests */
function fakeGraph(entities: Array<{ id: string; label?: string; attributes?: string[] }>, relations: Array<{ source: string; target: string; label?: string }> = []): ErGraph {
  return {
    headerLine: 0,
    entities: entities.map((e) => ({
      entityId: `entity:${e.id}`,
      id: e.id,
      label: e.label ?? e.id,
      decl: null,
      block: null,
      attributes: (e.attributes ?? []).map((text, i) => ({
        lineIndex: i + 1,
        text,
        textSpan: { start: 0, end: text.length },
      })),
      refLines: [],
      firstRefLine: 0,
    })),
    entityById: new Map(entities.map((e) => [e.id, {
      entityId: `entity:${e.id}`,
      id: e.id,
      label: e.label ?? e.id,
      decl: null,
      block: null,
      attributes: (e.attributes ?? []).map((text, i) => ({
        lineIndex: i + 1,
        text,
        textSpan: { start: 0, end: text.length },
      })),
      refLines: [],
      firstRefLine: 0,
    }])),
    relations: relations.map((r, i) => ({
      entityId: `erel:${r.source}->${r.target}#${i}`,
      source: r.source,
      target: r.target,
      lineIndex: i + 1,
      stmt: {},
      label: r.label ?? '',
      order: i,
    })),
    statements: new Map(),
    lastContentLine: 0,
  } as unknown as ErGraph
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleEr', () => {
  it('correlates entities, attribute rows, relationships and labels', () => {
    const { result, svg, graph } = correlate(SAMPLE)

    // every entity lands on its pele-entity group — pele keys data-id by the
    // entity's label (not core's `entity:` id), tagged with its entity id
    for (const name of ['CUSTOMER', 'ORDER', 'LINEITEM'] as const) {
      const el = result.nodes.get(`entity:${name}`)!
      expect(el).toBeTruthy()
      expect(el).toBe(svg.querySelector(`g.pele-entity[data-id="${name}"]`))
      expect(el.getAttribute('data-mw-entity')).toBe(`entity:${name}`)
    }
    expect(result.failed).toEqual([])

    // attribute rows are tagged mirroring mermaid's supplementary contract:
    // data-mw-attr-entity carries the entity's RAW id (the view's attr-edit
    // routing looks it up in er.entityById), data-mw-attr-line the line index
    const box = svg.querySelector('g.pele-entity[data-id="CUSTOMER"]')!
    const texts = [...box.querySelectorAll('g.pele-er-attributes text')]
    expect(texts).toHaveLength(4) // 2 rows x (type + name)
    const customer = graph.entityById.get('CUSTOMER')!
    expect(customer.attributes).toHaveLength(2)
    // pele lays each row out on one y: group the texts per row
    const rowYs = [...new Set(texts.map((t) => t.getAttribute('y')))]
    expect(rowYs).toHaveLength(2)
    for (let i = 0; i < 2; i++) {
      const row = texts.filter((t) => t.getAttribute('y') === rowYs[i])
      const attr = customer.attributes[i]
      for (const t of row) {
        expect(t.getAttribute('data-mw-attr-entity')).toBe('CUSTOMER')
        expect(t.getAttribute('data-mw-attr-line')).toBe(String(attr.lineIndex))
      }
    }
    // name and type both carry the row tags
    const byY = (y: string) => texts.filter((t) => t.getAttribute('y') === y)
    expect(byY(rowYs[0]).map((t) => t.textContent).sort()).toEqual(['name', 'string'])
    expect(byY(rowYs[1]).map((t) => t.textContent).sort()).toEqual(['id', 'int'])

    // pele's own chrome (stripes, divider, the entity label) is never tagged
    expect(box.querySelectorAll('g.pele-er-stripes rect').length).toBeGreaterThan(0)
    for (const scenery of [
      ...box.querySelectorAll('g.pele-er-stripes rect'),
      ...box.querySelectorAll('path.pele-er-divider'),
      ...box.querySelectorAll('text.pele-label'),
    ]) {
      expect(scenery.hasAttribute('data-mw-entity')).toBe(false)
      expect(scenery.hasAttribute('data-mw-attr-line')).toBe(false)
    }

    // relationships correlate to their pele-edge group's inner path — pele's
    // `id_entity-…` data-id scheme is a hint only; document-order count-check
    // against core's erel list is the truth
    const relId = 'erel:CUSTOMER->ORDER#0'
    const path = result.edges.get(relId)!
    expect(path).toBeTruthy()
    expect(path.tagName.toLowerCase()).toBe('path')
    expect(path.classList.contains('pele-marker')).toBe(false)
    expect(path.getAttribute('data-mw-entity')).toBe(relId)
    expect(path.closest('g.pele-edge')?.classList.contains('pele-er-identifying')).toBe(true)
    // the transparent hit-overlay sibling clone exists for the visible path
    const overlay = path.parentElement!.querySelector(`[data-mw-hit-overlay="${relId}"]`)
    expect(overlay).toBeTruthy()
    expect(overlay!.getAttribute('d')).toBe(path.getAttribute('d'))
    expect(result.edges.get('erel:ORDER->LINEITEM#0')).toBeTruthy()

    // the label group carries the same data-id as its edge group
    const label = result.edgeLabels.get(relId)!
    expect(label).toBe(
      svg.querySelector('g.pele-edge-label[data-id="id_entity-CUSTOMER-0_entity-ORDER-1_0"]'),
    )
    expect(label.getAttribute('data-mw-entity')).toBe(relId)
    expect(label.textContent).toContain('places')
  })

  it('degrades duplicate-label entities (core alias syntax) instead of mis-pairing', () => {
    // core's decl syntax `NAME[alias]` re-labels an entity — `A[X]` and `B[X]`
    // are two entities sharing one display label. Label-keyed matching is
    // inherently ambiguous for them: BOTH degrade to view-only, never pair
    // (not even positionally).
    const { result, svg } = correlate('erDiagram\n  A[X]\n  B[X]\n  A ||--o{ B : r\n')
    expect(svg.querySelectorAll('g.pele-entity')).toHaveLength(2)
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['entity:A', 'entity:B'])
    for (const el of svg.querySelectorAll('g.pele-entity')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
    // no attribute rows can be tagged for degraded entities
    expect(svg.querySelectorAll('[data-mw-attr-line]')).toHaveLength(0)
    // the relationship itself is unaffected — document-order zip vs core's
    // erel list is independent of entity correlation
    expect(result.edges.size).toBe(1)
    expect(result.failed.filter((f) => f.startsWith('erel:'))).toEqual([])
  })

  it('degrades attribute rows (not the entity) when pele rendered a different count', () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const graph = editor.result.er!
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    host.innerHTML = peleRender(SAMPLE).svg
    const svg = host.querySelector('svg')!
    // pele rendered one more attribute row than core has — inject a foreign
    // row (same y as an existing row's texts would merge, so give it its own y)
    const attrs = svg.querySelector('g.pele-entity[data-id="CUSTOMER"] g.pele-er-attributes')!
    attrs.insertAdjacentHTML(
      'beforeend',
      '<text class="pele-er-type" x="0" y="999">stray</text><text class="pele-er-name" x="0" y="999">row</text>',
    )
    const result = correlatePeleEr(svg, graph)
    // the entity itself still correlates
    expect(result.nodes.get('entity:CUSTOMER')).toBe(svg.querySelector('g.pele-entity[data-id="CUSTOMER"]'))
    expect(result.nodes.get('entity:CUSTOMER')!.getAttribute('data-mw-entity')).toBe('entity:CUSTOMER')
    // but not one attribute row on it is tagged — a shifted zip would edit
    // the wrong attribute line
    for (const t of attrs.querySelectorAll('text')) {
      expect(t.hasAttribute('data-mw-attr-entity')).toBe(false)
      expect(t.hasAttribute('data-mw-attr-line')).toBe(false)
    }
    // the other entities and the relationships are unaffected
    expect(result.nodes.get('entity:ORDER')).toBeTruthy()
    expect(result.edges.size).toBe(2)
    expect(result.failed).toEqual([])
  })

  it('degrades relationships when the document-order count disagrees', () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const graph = editor.result.er!
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    host.innerHTML = peleRender(SAMPLE).svg
    const svg = host.querySelector('svg')!
    // core has two relationships, pele rendered one more — inject a foreign
    // edge group; the count check must degrade every relation rather than
    // shift the zip onto the wrong line
    svg.querySelector('g.pele-edges')!.insertAdjacentHTML(
      'beforeend',
      '<g class="pele-edge pele-er-identifying" data-id="id_entity-CUSTOMER-0_entity-LINEITEM-2_9"><path d="M0,0L10,10"/><path class="pele-marker" d="M1,1"/></g>',
    )
    const result = correlatePeleEr(svg, graph)
    expect(result.edges.size).toBe(0)
    expect(result.failed).toEqual(['erel:CUSTOMER->ORDER#0', 'erel:ORDER->LINEITEM#0'])
    for (const path of svg.querySelectorAll('g.pele-edge path')) {
      expect(path.hasAttribute('data-mw-entity')).toBe(false)
    }
    // labels degrade with their edges (no claimed edge to match against)
    expect(result.edgeLabels.size).toBe(0)
    // entities and attribute rows still correlate
    expect(result.nodes.size).toBe(3)
    expect(svg.querySelectorAll('[data-mw-attr-line]').length).toBeGreaterThan(0)
  })

  it('correlates non-identifying (`..`) relationships alongside identifying ones', () => {
    const { result, svg } = correlate('erDiagram\n  A ||--o{ B : solid\n  A ||..o{ B : dashed\n')
    const groups = [...svg.querySelectorAll('g.pele-edge.pele-er-identifying, g.pele-edge.pele-er-non-identifying')]
    expect(groups).toHaveLength(2)
    expect(groups[0].classList.contains('pele-er-identifying')).toBe(true)
    expect(groups[1].classList.contains('pele-er-non-identifying')).toBe(true)
    expect(result.edges.size).toBe(2)
    expect(result.failed).toEqual([])
    for (const id of ['erel:A->B#0', 'erel:A->B#1'] as const) {
      const path = result.edges.get(id)!
      expect(path.classList.contains('pele-marker')).toBe(false)
      expect(path.getAttribute('data-mw-entity')).toBe(id)
    }
    expect(result.edgeLabels.size).toBe(2)
  })

  it('matches entity data-ids through pele entity encoding', () => {
    // pele entity-encodes data-id values; the graph label arrives encoded, the
    // DOM attribute decodes it. Core er names are [\w-]+, so this is a no-op
    // in practice — pinned so it stays that way.
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes">' +
      '<g class="pele-node pele-entity" data-id="A"><rect/></g>' +
      '</g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleEr(svg, fakeGraph([{ id: 'A', label: 'A' }]))
    expect(result.nodes.get('entity:A')).toBe(svg.querySelector('[data-id="A"]'))
    expect(result.nodes.get('entity:A')!.getAttribute('data-mw-entity')).toBe('entity:A')
    expect(result.failed).toEqual([])
  })

  it('degrades entities when counts disagree with no positional rescue', () => {
    // core has two entities, pele rendered only one. The leftover zip needs
    // equal counts; here they disagree, so BOTH degrade — a positional pair
    // could cross onto the wrong entity when labels disagree.
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes"><g class="pele-node pele-entity" data-id="X"><rect/></g></g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleEr(svg, fakeGraph([{ id: 'P', label: 'P' }, { id: 'Q', label: 'Q' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['entity:P', 'entity:Q'])
    expect(svg.querySelector('[data-id="X"]')!.hasAttribute('data-mw-entity')).toBe(false)
  })

  it('degrades an entity whose label fits more than one unclaimed pele group', () => {
    // two pele groups share one data-id (should not happen on real pele
    // output, but if a release ever duplicates them, matching by label would
    // be ambiguous) — degrade instead of picking either
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes">' +
      '<g class="pele-node pele-entity" data-id="A"><rect/></g>' +
      '<g class="pele-node pele-entity" data-id="A"><rect/></g>' +
      '</g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleEr(svg, fakeGraph([{ id: 'A' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['entity:A'])
    for (const el of svg.querySelectorAll('g.pele-entity')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('zips a leftover entity in DOM order when its label is absent from pele\u2019s data-ids', () => {
    // core's alias syntax re-labels `A` to `X`; pele keeps the NAME in
    // data-id and paints the alias as the box text, so the label pass misses
    // and the (count-checked) leftover zip pairs the one unmatched entity
    // with the one unclaimed group
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes">' +
      '<g class="pele-node pele-entity" data-id="A"><rect/></g>' +
      '<g class="pele-node pele-entity" data-id="B"><rect/></g>' +
      '</g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleEr(svg, fakeGraph([{ id: 'A', label: 'X' }, { id: 'B' }]))
    expect(result.nodes.get('entity:B')).toBe(svg.querySelector('[data-id="B"]'))
    expect(result.nodes.get('entity:A')).toBe(svg.querySelector('[data-id="A"]'))
    expect(result.failed).toEqual([])
  })
})

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

  it('dispatches er diagrams through the pele correlator', async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    // drain microtasks and the macrotask queue so the render lands
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('svg')).toBeTruthy()
    for (const id of ['entity:CUSTOMER', 'entity:ORDER', 'entity:LINEITEM'] as const) {
      expect(container.querySelector(`[data-mw-entity="${id}"]`)).toBeTruthy()
    }
    expect(container.querySelector('[data-mw-entity="erel:CUSTOMER->ORDER#0"]')).toBeTruthy()
    // attribute rows are tagged through the view path too
    expect(container.querySelector('[data-mw-attr-entity="CUSTOMER"]')).toBeTruthy()
    // and pele's own chrome (stripes) stays untagged
    expect(container.querySelector('.pele-er-stripes rect[data-mw-attr-line]')).toBeNull()
  })

  // Attribute-edit parity: pele's attribute cells are SVG <text> — the tags
  // must route dblclicks to the overlay editor with the er.setAttributeText
  // commit op (mermaid's HTML cells take the same branch).
  it('edits an attribute through the overlay editor under pele', async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    const cell = container.querySelector('text.pele-er-name[data-mw-attr-line]')!
    expect(cell).toBeTruthy()
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    // the overlay editor opened, seeded with the attribute's full line text
    const overlay = container.querySelector('.mw-inplace-editor')!
    expect(overlay).toBeTruthy()
    expect(overlay.textContent).toBe('string name')
    // commit rewrites the source through er.setAttributeText
    overlay.textContent = 'string fullName'
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.code).toContain('string fullName')
    // and the re-rendered svg shows the committed text, still correlated
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    const renamed = container.querySelector('text.pele-er-name[data-mw-attr-line]')!
    expect(renamed.textContent).toBe('fullName')
    expect(renamed.getAttribute('data-mw-attr-entity')).toBe('CUSTOMER')
  })

  // Step 5 style spot-check: pele's er renderer keeps `style A fill:#f00`
  // (verified against pele@1.13.0) — the rendered SVG must visibly change, and
  // the styled entity must still correlate.
  it('keeps inline style styling visible under pele', async () => {
    const code = 'erDiagram\n  A ||--o{ B : r\n  style A fill:#f00\n'
    const editor = new MermaidWysiwygEditor({ code })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('svg')).toBeTruthy()
    const rect = container.querySelector('[data-mw-entity="entity:A"] rect')
    expect(rect).toBeTruthy()
    expect(rect!.getAttribute('style')).toContain('fill:#f00')
  })
})
