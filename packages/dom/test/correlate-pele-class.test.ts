// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type ClassGraph } from '@visimer/core'
import { correlatePeleClass } from '../src/correlate.pele.class'
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

const SAMPLE = `classDiagram
  class BankAccount {
    +String owner
    +int balance
    +deposit() bool
    -withdraw(int amount)
  }
  BankAccount "1" *-- "many" Transaction : holds
`

/** render a code string with real pele, correlate it against core's class graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.classGraph
  if (!graph) throw new Error('code did not parse as a class diagram')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePeleClass(svg, graph) }
}

/** minimal ClassGraph for synthetic-DOM tests (decode entities, leftover zip) */
function fakeGraph(classes: Array<{ id: string; members?: string[] }>): ClassGraph {
  return {
    headerLine: 0,
    classes: classes.map((c, i) => ({
      entityId: `class:${c.id}`,
      id: c.id,
      label: c.id,
      decl: null,
      block: null,
      members: (c.members ?? []).map((text, j) => ({
        lineIndex: i * 10 + j + 1,
        text,
        textSpan: { start: 0, end: text.length },
      })),
      extraLines: [],
      refLines: [],
      firstRefLine: 0,
    })),
    classById: new Map(),
    relations: [],
    statements: new Map(),
    direction: null,
    lastContentLine: 0,
  } as unknown as ClassGraph
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleClass', () => {
  it('correlates classes, member rows, the relation and its label', () => {
    const { result, svg, graph } = correlate(SAMPLE)

    // every class lands on its pele-class group (data-id compare goes through
    // decodeEntities), tagged with its entity id
    for (const id of ['BankAccount', 'Transaction'] as const) {
      const el = result.nodes.get(`class:${id}`)!
      expect(el).toBeTruthy()
      expect(el).toBe(svg.querySelector(`g.pele-class[data-id="${id}"]`))
      expect(el.getAttribute('data-mw-entity')).toBe(`class:${id}`)
    }
    expect(result.failed).toEqual([])

    // member rows are tagged mirroring mermaid's supplementary contract:
    // attributes first, then methods, count-checked per class
    const box = svg.querySelector('g.pele-class[data-id="BankAccount"]')!
    const attrEls = [...box.querySelectorAll('text.pele-member.pele-attribute')]
    const methodEls = [...box.querySelectorAll('text.pele-member.pele-method')]
    expect(attrEls).toHaveLength(2)
    expect(methodEls).toHaveLength(2)
    const cls = graph.classes.find((c) => c.id === 'BankAccount')!
    const attrs = cls.members.filter((m) => !m.text.includes('('))
    const methods = cls.members.filter((m) => m.text.includes('('))
    expect(attrs).toHaveLength(2)
    expect(methods).toHaveLength(2)
    attrs.forEach((m, i) => {
      expect(attrEls[i].getAttribute('data-mw-member-class')).toBe('BankAccount')
      expect(attrEls[i].getAttribute('data-mw-member-line')).toBe(String(m.lineIndex))
    })
    methods.forEach((m, i) => {
      expect(methodEls[i].getAttribute('data-mw-member-class')).toBe('BankAccount')
      expect(methodEls[i].getAttribute('data-mw-member-line')).toBe(String(m.lineIndex))
    })

    // the class-name label is never tagged as a member row
    expect(box.querySelector('text.pele-label')!.hasAttribute('data-mw-member-line')).toBe(false)
    // classes without members tag nothing
    expect(svg.querySelectorAll('[data-mw-member-line]')).toHaveLength(4)

    // the relation correlates to its pele-relation group's inner path — the
    // data-id is pele's `id_<Src>_<Tgt>_<N>` scheme
    const relId = 'rel:BankAccount->Transaction#0'
    const path = result.edges.get(relId)!
    expect(path).toBeTruthy()
    expect(path.tagName.toLowerCase()).toBe('path')
    expect(path.classList.contains('pele-marker')).toBe(false)
    expect(path.getAttribute('data-mw-entity')).toBe(relId)
    expect(path.closest('g.pele-edge')?.getAttribute('data-id')).toBe('id_BankAccount_Transaction_1')
    // the transparent hit-overlay sibling clone exists for the visible path
    const overlay = path.parentElement!.querySelector(`[data-mw-hit-overlay="${relId}"]`)
    expect(overlay).toBeTruthy()
    expect(overlay!.getAttribute('d')).toBe(path.getAttribute('d'))

    // the relation label group carries the same data-id as its edge group
    const label = result.edgeLabels.get(relId)!
    expect(label).toBe(svg.querySelector('g.pele-edge-label[data-id="id_BankAccount_Transaction_1"]'))
    expect(label.getAttribute('data-mw-entity')).toBe(relId)
    expect(label.textContent).toContain('holds')

    // cardinality texts are positional scenery — they never claim a tag
    const cards = svg.querySelectorAll('text.pele-cardinality')
    expect(cards).toHaveLength(2)
    for (const card of cards) expect(card.hasAttribute('data-mw-entity')).toBe(false)
  })

  it('degrades member rows (not the class) when pele split them differently', () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const graph = editor.result.classGraph!
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    host.innerHTML = peleRender(SAMPLE).svg
    const svg = host.querySelector('svg')!
    // pele rendered one more attribute than core has — inject a foreign row
    // the same way the state suite injects foreign pele DOM
    svg
      .querySelector('g.pele-class[data-id="BankAccount"] g.pele-members')!
      .insertAdjacentHTML('beforeend', '<text class="pele-member pele-attribute" x="0" y="0">+stray int</text>')
    const result = correlatePeleClass(svg, graph)
    // the class itself still correlates
    expect(result.nodes.get('class:BankAccount')).toBe(svg.querySelector('g.pele-class[data-id="BankAccount"]'))
    expect(result.nodes.get('class:BankAccount')!.getAttribute('data-mw-entity')).toBe('class:BankAccount')
    // but not one member row on it is tagged — a shifted zip would edit the
    // wrong member line
    for (const row of svg.querySelectorAll('text.pele-member')) {
      expect(row.hasAttribute('data-mw-member-class')).toBe(false)
      expect(row.hasAttribute('data-mw-member-line')).toBe(false)
    }
    // the other class (no members) and the relation are unaffected
    expect(result.nodes.get('class:Transaction')).toBeTruthy()
    expect(result.edges.size).toBe(1)
    expect(result.failed).toEqual([])
  })

  it('degrades relations when the id_<Src>_<Tgt>_ prefix collides (duplicate pair)', () => {
    const { result, svg } = correlate(
      'classDiagram\n  A --> B : first\n  A --> B : second\n',
    )
    // both pele groups share the `id_A_B_` prefix — the guard degrades BOTH
    // relations instead of pairing either, however plausibly
    expect(svg.querySelectorAll('g.pele-edge.pele-relation')).toHaveLength(2)
    expect(result.edges.size).toBe(0)
    expect(result.failed).toEqual(['rel:A->B#0', 'rel:A->B#1'])
    for (const path of svg.querySelectorAll('g.pele-edge.pele-relation path')) {
      expect(path.hasAttribute('data-mw-entity')).toBe(false)
    }
    // labels degrade with their edges (no claimed edge to match against)
    expect(result.edgeLabels.size).toBe(0)
    for (const label of svg.querySelectorAll('g.pele-edge-label')) {
      expect(label.hasAttribute('data-mw-entity')).toBe(false)
    }
    // classes are unaffected by the relation degradation
    expect(result.nodes.size).toBe(2)
    expect(result.failed.filter((f) => f.startsWith('class:'))).toEqual([])
  })

  it('degrades an underscore id whose prefix fits two relations', () => {
    // `A-->B` and `A_B-->C`: pele's ids are id_A_B_1 and id_A_B_C_2. The
    // first relation's prefix fits BOTH groups (ambiguous), and the second's
    // group fits the first relation's prefix too — both degrade, nothing is
    // mis-paired across the phantom split.
    const { result, svg } = correlate('classDiagram\n  A --> B\n  A_B --> C\n')
    expect(result.edges.size).toBe(0)
    expect(result.failed).toEqual(['rel:A->B#0', 'rel:A_B->C#0'])
    for (const path of svg.querySelectorAll('g.pele-edge.pele-relation path')) {
      expect(path.hasAttribute('data-mw-entity')).toBe(false)
    }
    // all four classes still correlate through their data-ids
    expect(result.nodes.size).toBe(4)
  })

  it('matches relation prefixes through pele entity encoding', () => {
    // pele entity-encodes data-id values; the graph id arrives encoded, the
    // DOM attribute decodes it. Core class ids are [\\w.~]+, so this is a
    // no-op in practice — pinned so it stays that way.
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-edges">' +
      '<g class="pele-edge pele-relation" data-id="id_A_B_1"><path d="M0,0L10,10"/><path class="pele-marker" d="M1,1"/></g>' +
      '</g></svg>'
    const svg = host.querySelector('svg')!
    const graph = {
      classes: [],
      relations: [
        {
          entityId: 'rel:A->B#0',
          source: 'A',
          target: 'B',
          lineIndex: 1,
          label: null,
          order: 0,
          stmt: {},
        },
      ],
    } as unknown as ClassGraph
    const result = correlatePeleClass(svg, graph)
    const path = result.edges.get('rel:A->B#0')!
    expect(path.getAttribute('d')).toBe('M0,0L10,10')
    expect(path.classList.contains('pele-marker')).toBe(false)
    expect(path.getAttribute('data-mw-entity')).toBe('rel:A->B#0')
    expect(result.failed).toEqual([])
  })

  it('zips leftover classes in DOM order when data-id matching misses', () => {
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes">' +
      '<g class="pele-node pele-class" data-id="Unknown1"><rect/></g>' +
      '<g class="pele-node pele-class" data-id="Unknown2"><rect/></g>' +
      '</g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleClass(svg, fakeGraph([{ id: 'P' }, { id: 'Q' }]))
    expect(result.nodes.get('class:P')).toBe(svg.querySelector('[data-id="Unknown1"]'))
    expect(result.nodes.get('class:Q')).toBe(svg.querySelector('[data-id="Unknown2"]'))
    expect(result.failed).toEqual([])
  })

  it('degrades leftover classes when counts disagree', () => {
    const host = document.createElement('div')
    hosts.push(host)
    // core has two classes, pele rendered only one — the zip must not fire
    host.innerHTML = '<svg><g class="pele-nodes"><g class="pele-node pele-class" data-id="X"><rect/></g></g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleClass(svg, fakeGraph([{ id: 'P' }, { id: 'Q' }]))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['class:P', 'class:Q'])
    expect(svg.querySelector('[data-id="X"]')!.hasAttribute('data-mw-entity')).toBe(false)
  })

  it('degrades member rows when pele and core split the same members differently', () => {
    // probe (pele@1.13.0): pele renders BOTH `+foo(` and `+bar)` as
    // pele-attribute — its classifier only makes a balanced `()` pair a
    // method, so unbalanced parens stay attributes — while our
    // `includes('(')` verdict splits the same members 1 attribute + 1 method.
    // The per-kind counts disagree (2 attribute rows vs 1 + 1): BOTH rows
    // degrade, never swap.
    const { result, svg } = correlate('classDiagram\n  class A {\n    +foo(\n    +bar)\n  }\n')
    const rows = [...svg.querySelectorAll('text.pele-member')]
    expect(rows).toHaveLength(2)
    // pele's own kind classes, pinned from the probe: both attributes
    for (const row of rows) expect(row.classList.contains('pele-attribute')).toBe(true)
    // both rows degraded — no member tags, so no member edit can route
    for (const row of rows) {
      expect(row.hasAttribute('data-mw-member-class')).toBe(false)
      expect(row.hasAttribute('data-mw-member-line')).toBe(false)
    }
    // the class itself stays correlated and selectable
    expect(result.nodes.get('class:A')!.getAttribute('data-mw-entity')).toBe('class:A')
    expect(result.failed).toEqual([])
  })

  it('degrades member rows when pele split a member into the other group', () => {
    // pele@1.13.0 makes a member a method only for a balanced `()` pair —
    // unbalanced parens fall back to attribute — so pele-method ⊆ our
    // `includes('(')` method set. A member like `+foo(` (has `(`, no `()`)
    // splits differently: pele renders it an attribute, we split it as a
    // method, and the per-kind counts disagree: the rows degrade rather than
    // shift.
    const host = document.createElement('div')
    hosts.push(host)
    host.innerHTML =
      '<svg><g class="pele-nodes">' +
      '<g class="pele-node pele-class" data-id="A"><rect/>' +
      '<g class="pele-members">' +
      '<text class="pele-member pele-attribute" x="0" y="0">+foo(</text>' +
      '<text class="pele-member pele-attribute" x="0" y="0">+int x</text>' +
      '</g></g></g></svg>'
    const svg = host.querySelector('svg')!
    const result = correlatePeleClass(svg, fakeGraph([{ id: 'A', members: ['+foo(', '+int x'] }]))
    expect(result.nodes.get('class:A')).toBeTruthy()
    for (const row of svg.querySelectorAll('text.pele-member')) {
      expect(row.hasAttribute('data-mw-member-line')).toBe(false)
    }
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

  it('dispatches class diagrams through the pele correlator', async () => {
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
    expect(container.querySelector('[data-mw-entity="class:BankAccount"]')).toBeTruthy()
    expect(container.querySelector('[data-mw-entity="class:Transaction"]')).toBeTruthy()
    expect(container.querySelector('[data-mw-entity="rel:BankAccount->Transaction#0"]')).toBeTruthy()
    // member rows are tagged through the view path too
    expect(container.querySelector('[data-mw-member-class="BankAccount"]')).toBeTruthy()
    // and pele's own chrome (cardinalities) stays untagged
    expect(container.querySelector('.pele-cardinality[data-mw-entity]')).toBeNull()
  })

  // Member-edit parity (spec goal 1): pele's member rows are SVG <text> —
  // the mermaid in-place `.nodeLabel` session can't attach, so the dblclick
  // member edit must route to the overlay editor (same commit op) instead of
  // silently no-oping.
  it('edits a member through the overlay editor under pele', async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    const row = container.querySelector('text.pele-member.pele-attribute[data-mw-member-line]')!
    expect(row.textContent).toBe('+String owner')
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    // no in-place session attached inside the svg (that contract is HTML-only)
    expect(container.querySelector('svg [contenteditable]')).toBeNull()
    // the overlay editor opened, seeded with the member's current text
    const overlay = container.querySelector('.mw-inplace-editor')!
    expect(overlay).toBeTruthy()
    expect(overlay.textContent).toBe('+String owner')
    // commit renames the member; the source rewrites through cl.setMemberText
    overlay.textContent = '+String ownerName'
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.code).toContain('+String ownerName')
    // and the re-rendered svg shows the committed text, still correlated
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    const renamed = container.querySelector('text.pele-member.pele-attribute[data-mw-member-line]')!
    expect(renamed.textContent).toBe('+String ownerName')
    expect(renamed.getAttribute('data-mw-member-class')).toBe('BankAccount')
  })

  // Degraded rows must not offer a member edit: dblclicking one cannot enter
  // the member branch (the rows carry no `data-mw-member-line`), so no editor
  // seeded with a member's text can ever appear — the dblclick falls through
  // to the class entity and opens the class-rename editor instead.
  it('offers no member edit for degraded member rows', async () => {
    const editor = new MermaidWysiwygEditor({ code: 'classDiagram\n  class A {\n    +foo(\n    +bar)\n  }\n' })
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    views.push(view)
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    const rows = [...container.querySelectorAll('text.pele-member')]
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.hasAttribute('data-mw-member-line')).toBe(false)
    rows[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    // the ONLY editor that opens is the class rename (seeded with the class
    // id via the entity hit) — never a member edit seeded with member text
    const overlay = container.querySelector('.mw-inplace-editor')!
    expect(overlay).toBeTruthy()
    expect(overlay.textContent).toBe('A')
  })

  // Step 5 style spot-check: pele's class renderer keeps `style A fill:#f00`
  // (verified against pele@1.13.0) — the rendered SVG must visibly change, and
  // the styled class must still correlate. Note pele@1.13.0 DROPS classDef /
  // `class A bad` styling for class diagrams (its parser mis-reads the
  // statement), so this spot-check pins the form that actually survives.
  it('keeps inline style styling visible under pele', async () => {
    const code = 'classDiagram\n  A --> B\n  style A fill:#f00\n'
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
    const rect = container.querySelector('[data-mw-entity="class:A"] rect')
    expect(rect).toBeTruthy()
    expect(rect!.getAttribute('style')).toContain('fill:#f00')
  })
})
