// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type SequenceGraph } from '@visimer/core'
import { correlatePeleSequence } from '../src/correlate.pele.sequence'
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

// probe's sequence sample (task-7 brief) — pele@1.13.0 renders it as:
// messages i0 (Hello), i2 (Hi), i6 (Ping); note i4 (greeting); the i<N>
// counter is global across messages AND notes and skips activation statements
// (i1, i3, i5), so the ids are non-contiguous per kind and are HINTS ONLY.
const SAMPLE = `sequenceDiagram
  participant Alice
  actor Bob
  Alice->>Bob: Hello
  activate Bob
  Bob-->>Alice: Hi
  deactivate Bob
  Note over Alice,Bob: greeting
  loop Daily
    Alice->>Bob: Ping
  end
`

// the same sample with a note inserted after the first message — every message
// i<N> AFTER the insertion point shifts (probed: messages i0, i3, i7 with
// notes i2, i5). Pins that the count-checked order zip pairs by document
// order, never by the i<N> ids.
const INSERTED = `sequenceDiagram
  participant Alice
  actor Bob
  Alice->>Bob: Hello
  activate Bob
  Note over Bob: inserted
  Bob-->>Alice: Hi
  deactivate Bob
  Note over Alice,Bob: greeting
  loop Daily
    Alice->>Bob: Ping
  end
`

const hosts: HTMLElement[] = []

/** render a code string with real pele and correlate it against core's graph */
function correlate(code: string, opts: { visible?: boolean } = {}) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.sequence
  if (!graph) throw new Error('code did not produce a sequence graph')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  if (opts.visible !== false) stampWidth(svg, 400)
  return { svg, graph, result: correlatePeleSequence(svg, graph) }
}

/**
 * jsdom never lays elements out, so `getBoundingClientRect` is always zero —
 * the correlator's lifeline guard (mirroring mermaid's) reads the svg root's
 * width. Stamp a non-zero width to exercise the visible path, or 0 for the
 * hidden-mount path.
 */
function stampWidth(svg: SVGSVGElement, width: number) {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      right: width,
      top: 0,
      bottom: 400,
      width,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    configurable: true,
  })
}

function syntheticSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = `<svg>${markup}</svg>`
  return host.querySelector('svg')!
}

/** core-shaped graph for synthetic fixtures (entity ids: participant:/event:) */
function fakeGraph(participants: string[], events: Array<'message' | 'note'>): SequenceGraph {
  return {
    participants: participants.map((id) => ({
      entityId: `participant:${id}`,
      id,
      label: id,
      ptype: 'participant',
      decl: null,
      order: 0,
    })),
    events: events.map((kind, i) => ({
      kind,
      entityId: `event:${i + 1}`,
      lineIndex: i + 1,
      stmt: {},
    })),
  } as unknown as SequenceGraph
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleSequence (pele@1.13.0 surface, probed sample)', () => {
  it('correlates participants (both actor twins, participant and actor kinds) by data-id', () => {
    const { result, svg } = correlate(SAMPLE)
    expect(result.failed).toEqual([])
    expect(result.participants.size).toBe(2)
    // BOTH twins — the pele-actor-footer bottom box and the top box — are
    // stored per participant and carry the participant: tag
    for (const id of ['Alice', 'Bob']) {
      const twins = [...svg.querySelectorAll(`g.pele-actor[data-id="${id}"]`)]
      expect(twins).toHaveLength(2)
      const stored = result.participants.get(`participant:${id}`)!
      expect(stored).toHaveLength(2)
      expect(stored).toEqual(expect.arrayContaining(twins))
      for (const t of twins) expect(t.getAttribute('data-mw-entity')).toBe(`participant:${id}`)
    }
    // the declared participant and the actor kind both land in participants
    expect(svg.querySelectorAll('.pele-actor-participant, .pele-actor-actor')).toHaveLength(4)
    // exactly one footer twin per participant
    expect(svg.querySelectorAll('g.pele-actor.pele-actor-footer[data-mw-entity]')).toHaveLength(2)
  })

  it('fills the lifelines slot with path.pele-lifeline by its own data-id', () => {
    const { result, svg } = correlate(SAMPLE)
    expect(result.lifelines.size).toBe(2)
    expect(result.lifelines.get('participant:Alice')).toBe(svg.querySelector('path.pele-lifeline[data-id="Alice"]'))
    expect(result.lifelines.get('participant:Bob')).toBe(svg.querySelector('path.pele-lifeline[data-id="Bob"]'))
    // lifelines are an interaction surface, not entity surfaces — like
    // mermaid's correlator, they carry no data-mw-entity
    for (const el of svg.querySelectorAll('path.pele-lifeline')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('correlates messages and notes by per-kind document order against core events', () => {
    const { result, svg, graph } = correlate(SAMPLE)
    // core: event:3 Hello (message), event:5 Hi (message), event:7 greeting
    // (note), event:9 Ping (message)
    expect(graph.events.map((e) => `${e.kind.slice(0, 3)}@${e.entityId}`)).toEqual([
      'mes@event:3',
      'mes@event:5',
      'not@event:7',
      'mes@event:9',
    ])
    expect(result.failed).toEqual([])
    expect(result.events.size).toBe(4)
    // messages land on the inner <path> of the right pele-message group (the
    // marker carries pele-marker, the hit overlay data-mw-hit-overlay)
    const msgLine = (id: string) =>
      svg.querySelector(`g.pele-message[data-id="${id}"] path:not([data-mw-hit-overlay]):not(.pele-marker)`)
    expect(result.events.get('event:3')).toBe(msgLine('i0'))
    expect(result.events.get('event:5')).toBe(msgLine('i2'))
    expect(result.events.get('event:9')).toBe(msgLine('i6'))
    // the note lands on the note group's rect
    expect(result.events.get('event:7')).toBe(svg.querySelector('g.pele-note[data-id="i4"] > rect'))
    // every event element is tagged with its entity id
    for (const id of ['event:3', 'event:5', 'event:7', 'event:9']) {
      expect(svg.querySelectorAll(`[data-mw-entity="${id}"]`).length).toBeGreaterThan(0)
    }
    // message labels pair to their message group by the shared data-id; the
    // note's text lives inside the note group
    expect(result.eventTexts.get('event:3')?.textContent).toBe('Hello')
    expect(result.eventTexts.get('event:5')?.textContent).toBe('Hi')
    expect(result.eventTexts.get('event:9')?.textContent).toBe('Ping')
    expect(result.eventTexts.get('event:7')?.textContent).toBe('greeting')
    // the message line gets the transparent hit-overlay sibling, like
    // mermaid's correlators
    const overlay = svg.querySelector('[data-mw-hit-overlay="event:3"]')
    expect(overlay).toBeTruthy()
    expect(overlay!.getAttribute('d')).toBe(result.events.get('event:3')!.getAttribute('d'))
  })

  it('never tags scenery: activations, destroy marks and fragments carry no entity', () => {
    const { result, svg } = correlate(SAMPLE)
    // rect.pele-activation shares the participant's data-id — the participant
    // sweep only covers g.pele-node.pele-actor groups, so the activation rect
    // itself stays untagged and selects nothing
    for (const el of svg.querySelectorAll('rect.pele-activation')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
      expect(el.closest('[data-mw-entity]')).toBeNull()
    }
    // g.pele-frame (fragments) and its children are scenery
    for (const el of svg.querySelectorAll('g.pele-frame')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
      expect(el.closest('[data-mw-entity]')).toBeNull()
      for (const child of el.querySelectorAll('*')) {
        expect(child.hasAttribute('data-mw-entity')).toBe(false)
      }
    }
    // the lifelines / activations / frames layers contain no tagged element
    // at all beyond what the events themselves own (none of them live there)
    expect(svg.querySelectorAll('.pele-lifelines [data-mw-entity]')).toHaveLength(0)
    expect(svg.querySelectorAll('.pele-activations [data-mw-entity]')).toHaveLength(0)
    expect(svg.querySelectorAll('.pele-frames [data-mw-entity]')).toHaveLength(0)
    // result completeness is pinned above; nothing failed
    expect(result.failed).toEqual([])
  })

  it('adversarial: a note inserted mid-sequence shifts message i<N> ids, the order zip still pairs', () => {
    const { result, svg, graph } = correlate(INSERTED)
    // core: event:3 Hello, event:5 note(inserted), event:6 Hi, event:8
    // note(greeting), event:10 Ping
    expect(graph.events.map((e) => e.entityId)).toEqual(['event:3', 'event:5', 'event:6', 'event:8', 'event:10'])
    expect(graph.events.map((e) => e.kind)).toEqual(['message', 'note', 'message', 'note', 'message'])
    // the fixture really shifts the ids: messages render i0, i3, i7 (not
    // i0, i2, i6) and notes i2, i5 — pin the shift so the pairing assertions
    // below are proving order-matching, not id-matching
    expect([...svg.querySelectorAll('g.pele-message')].map((g) => g.getAttribute('data-id'))).toEqual([
      'i0',
      'i3',
      'i7',
    ])
    expect([...svg.querySelectorAll('g.pele-note')].map((g) => g.getAttribute('data-id'))).toEqual(['i2', 'i5'])
    // the zip pairs by document order within each kind, not by the shifted ids
    const msgLine = (id: string) =>
      svg.querySelector(`g.pele-message[data-id="${id}"] path:not([data-mw-hit-overlay]):not(.pele-marker)`)
    expect(result.failed).toEqual([])
    expect(result.events.get('event:3')).toBe(msgLine('i0'))
    expect(result.events.get('event:6')).toBe(msgLine('i3'))
    expect(result.events.get('event:10')).toBe(msgLine('i7'))
    expect(result.events.get('event:5')).toBe(svg.querySelector('g.pele-note[data-id="i2"] > rect'))
    expect(result.events.get('event:8')).toBe(svg.querySelector('g.pele-note[data-id="i5"] > rect'))
    // texts follow the same order pairing (labels share the shifted ids yet
    // pair by group data-id equality; notes by their inner text)
    expect(result.eventTexts.get('event:3')?.textContent).toBe('Hello')
    expect(result.eventTexts.get('event:5')?.textContent).toBe('inserted')
    expect(result.eventTexts.get('event:6')?.textContent).toBe('Hi')
    expect(result.eventTexts.get('event:8')?.textContent).toBe('greeting')
    expect(result.eventTexts.get('event:10')?.textContent).toBe('Ping')
  })

  it('leaves lifelines empty under a hidden mount (zero-width svg) and correlates everything else', () => {
    // mirrors mermaid's correlateSequence guard: an unlaid-out svg must not
    // correlate lifelines — the view's visibility retry re-correlates on
    // reveal (see the view-level test below)
    const { result } = correlate(SAMPLE, { visible: false })
    expect(result.lifelines.size).toBe(0)
    expect(result.participants.size).toBe(2)
    expect(result.events.size).toBe(4)
    expect(result.eventTexts.size).toBe(4)
    expect(result.failed).toEqual([])
  })

  it('never tags destroy marks, and a destroyed participant keeps its single remaining twin', () => {
    const code = `sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello
  destroy Bob
  Bob-->>Alice: never
`
    const { result, svg } = correlate(code)
    expect(result.failed).toEqual([])
    expect(result.events.size).toBe(2)
    // pele renders the destroy mark as g.pele-destroys > path.pele-destroy —
    // core has no entity for it, so it must select nothing
    const marks = svg.querySelectorAll('.pele-destroy, .pele-destroys')
    expect(marks.length).toBeGreaterThan(0)
    for (const el of marks) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
      expect(el.closest('[data-mw-entity]')).toBeNull()
    }
    // the destroyed participant renders only its top box — the data-id pass
    // still stores that single twin, so selection and popover keep working
    expect(svg.querySelectorAll('g.pele-actor[data-id="Bob"]')).toHaveLength(1)
    expect(result.participants.get('participant:Bob')!).toHaveLength(1)
    expect(result.participants.get('participant:Alice')!).toHaveLength(2)
  })

  it('degrades a kind whose counts disagree to view-only instead of mis-zipping (synthetic)', () => {
    const svg = syntheticSvg(`
      <g class="pele-nodes">
        <g class="pele-node pele-actor pele-actor-footer" data-id="A"><rect/></g>
        <g class="pele-node pele-actor" data-id="A"><rect/></g>
      </g>
      <g class="pele-edges">
        <g class="pele-edge pele-message" data-id="i0"><path d="M0,0H10"/></g>
        <g class="pele-edge pele-message" data-id="i2"><path d="M0,5H10"/></g>
      </g>
      <g class="pele-edge-labels">
        <g class="pele-edge-label" data-id="i0"><text>hello</text></g>
        <g class="pele-edge-label" data-id="i2"><text>bye</text></g>
      </g>
      <g class="pele-notes">
        <g class="pele-note" data-id="i1"><rect/><text class="pele-label">note</text></g>
      </g>`)
    stampWidth(svg, 400)
    // two rendered messages but only one message event: a zip would pair the
    // second message with nothing — every message degrades instead
    const graph = fakeGraph(['A'], ['message', 'note'])
    const result = correlatePeleSequence(svg, graph)
    expect(result.failed).toEqual(['event:1'])
    expect(result.events.has('event:1')).toBe(false)
    expect(result.eventTexts.has('event:1')).toBe(false)
    // nothing in the message/label layers is tagged
    expect(svg.querySelectorAll('.pele-edges [data-mw-entity]')).toHaveLength(0)
    expect(svg.querySelectorAll('.pele-edge-labels [data-mw-entity]')).toHaveLength(0)
    // the well-counted note still correlates
    expect(result.events.get('event:2')).toBe(svg.querySelector('g.pele-note > rect'))
    expect(result.eventTexts.get('event:2')?.textContent).toBe('note')
  })

  it('zips message labels by document order when data-id pairing is unavailable (synthetic)', () => {
    const svg = syntheticSvg(`
      <g class="pele-edges">
        <g class="pele-edge pele-message"><path d="M0,0H10"/></g>
        <g class="pele-edge pele-message"><path d="M0,5H10"/></g>
      </g>
      <g class="pele-edge-labels">
        <g class="pele-edge-label"><text>hello</text></g>
        <g class="pele-edge-label"><text>bye</text></g>
      </g>`)
    stampWidth(svg, 400)
    const graph = fakeGraph([], ['message', 'message'])
    const result = correlatePeleSequence(svg, graph)
    expect(result.failed).toEqual([])
    // no data-id to pair on — the count-checked document-order fallback zips
    expect(result.eventTexts.get('event:1')?.textContent).toBe('hello')
    expect(result.eventTexts.get('event:2')?.textContent).toBe('bye')
    expect(result.eventTexts.get('event:1')?.getAttribute('data-mw-entity')).toBe('event:1')
    expect(result.eventTexts.get('event:2')?.getAttribute('data-mw-entity')).toBe('event:2')
  })

  it('zips leftover participants by twin buckets, count-checked (synthetic)', () => {
    const svg = syntheticSvg(`
      <g class="pele-nodes">
        <g class="pele-node pele-actor pele-actor-footer" data-id="gen1"><rect/></g>
        <g class="pele-node pele-actor pele-actor-footer" data-id="gen2"><rect/></g>
        <g class="pele-node pele-actor" data-id="gen1"><rect/></g>
        <g class="pele-node pele-actor" data-id="gen2"><rect/></g>
      </g>`)
    stampWidth(svg, 400)
    // pele stamps generated ids core cannot name: equal counts of unmatched
    // participants and unclaimed twin buckets zip in document order
    const result = correlatePeleSequence(svg, fakeGraph(['P1', 'P2'], []))
    expect(result.failed).toEqual([])
    const p1 = result.participants.get('participant:P1')!
    const p2 = result.participants.get('participant:P2')!
    expect(p1).toHaveLength(2)
    expect(p2).toHaveLength(2)
    expect(p1.every((el) => el.getAttribute('data-id') === 'gen1')).toBe(true)
    expect(p2.every((el) => el.getAttribute('data-id') === 'gen2')).toBe(true)
    expect(p1[0].getAttribute('data-mw-entity')).toBe('participant:P1')
    expect(p2[0].getAttribute('data-mw-entity')).toBe('participant:P2')
  })

  it('degrades leftover participants whose twin buckets do not add up (synthetic)', () => {
    const svg = syntheticSvg(`
      <g class="pele-nodes">
        <g class="pele-node pele-actor pele-actor-footer" data-id="gen1"><rect/></g>
        <g class="pele-node pele-actor" data-id="gen1"><rect/></g>
        <g class="pele-node pele-actor" data-id="gen2"><rect/></g>
      </g>`)
    stampWidth(svg, 400)
    // three unclaimed groups — no twin structure to key a zip on: both
    // participants degrade rather than risk a mis-pair
    const result = correlatePeleSequence(svg, fakeGraph(['P1', 'P2'], []))
    expect(result.failed).toEqual(['participant:P1', 'participant:P2'])
    expect(result.participants.size).toBe(0)
    expect(svg.querySelectorAll('[data-mw-entity]')).toHaveLength(0)
  })
})

describe('pele sequence through the view (lifeline UI, visibility retry, label edit)', () => {
  type IOCallback = (entries: Array<{ intersectionRatio: number }>) => void
  type ObserverRecord = { target: Element | null; fire(ratio: number): void; disconnected: boolean }
  let observers: ObserverRecord[]
  let restoreIO: () => void
  let container: HTMLElement
  let view: MermaidCanvasView | undefined

  function installIntersectionObserverStub() {
    const Original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    class StubObserver {
      private record: ObserverRecord
      constructor(cb: IOCallback) {
        this.record = {
          target: null,
          fire: (ratio: number) => cb([{ intersectionRatio: ratio }]),
          disconnected: false,
        }
        observers.push(this.record)
      }
      observe(el: Element) {
        this.record.target = el
      }
      disconnect() {
        this.record.disconnected = true
      }
      unobserve() {}
      takeRecords() {
        return []
      }
    }
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = StubObserver as unknown
    return () => {
      ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Original
    }
  }

  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  }

  beforeEach(() => {
    observers = []
    restoreIO = installIntersectionObserverStub()
    container = document.createElement('div')
    document.body.appendChild(container)
    hosts.push(container)
  })

  afterEach(() => {
    view?.destroy()
    restoreIO()
    for (const host of hosts.splice(0)) host.remove()
  })

  it('renders the sample under pele, arms the visibility retry for sequence on a hidden mount, and re-correlates on reveal', async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    await flush()

    const svg = container.querySelector('svg')!
    expect(svg).toBeTruthy()
    const seq = view as unknown as {
      seqCorrelation: {
        participants: Map<string, Element[]>
        lifelines: Map<string, Element>
        events: Map<string, Element>
        eventTexts: Map<string, Element>
        failed: string[]
      } | null
      visibilityRetryObserver: unknown
    }

    // entities tagged in the live DOM
    expect(container.querySelectorAll('[data-mw-entity="participant:Alice"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-mw-entity="event:3"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-mw-entity="event:7"]').length).toBeGreaterThan(0)

    // hidden mount (jsdom lays nothing out — zero-width svg): everything but
    // lifelines correlates, and the visibility retry is ARMED for sequence
    expect(seq.seqCorrelation!.failed).toEqual([])
    expect(seq.seqCorrelation!.participants.size).toBe(2)
    expect(seq.seqCorrelation!.events.size).toBe(4)
    expect(seq.seqCorrelation!.lifelines.size).toBe(0)
    expect(observers.length).toBe(1)
    expect(observers[0].target).toBe(svg)
    expect(seq.visibilityRetryObserver).not.toBeNull()

    // reveal: the svg now has geometry; the one-shot fires and re-correlates
    // through the PELE correlator — lifelines fill from path[data-id] (the
    // mermaid correlator would find no line.actor-line and leave them empty)
    stampWidth(svg, 400)
    observers[0].fire(0.5)
    expect(seq.seqCorrelation!.lifelines.size).toBe(2)
    expect(seq.seqCorrelation!.lifelines.get('participant:Alice')?.classList.contains('pele-lifeline')).toBe(true)
    expect(seq.seqCorrelation!.events.size).toBe(4)
    // the one-shot consumed itself
    expect(seq.visibilityRetryObserver).toBeNull()
    expect(observers[0].disconnected).toBe(true)
  })

  it('does not re-arm after a re-render once lifelines correlated (visible mount)', async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    await flush()
    const seq = view as unknown as {
      seqCorrelation: { lifelines: Map<string, Element> } | null
      visibilityRetryObserver: unknown
    }
    // hidden first pass armed the retry (jsdom lays nothing out)
    expect(observers).toHaveLength(1)
    expect(seq.seqCorrelation!.lifelines.size).toBe(0)

    // make the environment "visible": every svg root now reports real
    // geometry, so the re-render correlates lifelines on the first pass
    const rect = {
      left: 0,
      right: 400,
      top: 0,
      bottom: 400,
      width: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    const spy = vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
    try {
      editor.setCode(SAMPLE + ' ', 'external')
      await flush()
    } finally {
      spy.mockRestore()
    }
    // the second render correlated lifelines and did NOT arm a new retry:
    // the first observer is the only one ever, and it was disconnected
    expect(observers).toHaveLength(1)
    expect(observers[0].disconnected).toBe(true)
    expect(seq.seqCorrelation!.lifelines.size).toBe(2)
    expect(seq.visibilityRetryObserver).toBeNull()
  })

  it("round-trips a note text edit through the view's sequence machinery (style ops stop-and-ruled: core has none)", async () => {
    const editor = new MermaidWysiwygEditor({ code: SAMPLE })
    view = new MermaidCanvasView({
      editor,
      container,
      renderer: peleAdapter({ render: (src) => peleRender(src) }),
      debounceMs: 0,
    })
    await flush()

    // the sequence "edit text" op is the closest visible round-trip to a
    // style op (core defines no seq style op — see report). The overlay
    // editor anchors on the note's eventTexts element.
    view.editEntityLabel('event:7')
    const overlay = container.querySelector<HTMLElement>('.mw-inplace-editor')!
    expect(overlay).not.toBeNull()
    expect(overlay.textContent).toBe('greeting')
    overlay.textContent = 'salutations'
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(editor.code).toContain('salutations')
    await flush()

    // the re-render re-correlated: the note still tags, its text updated
    expect(container.querySelector('[data-mw-entity="event:7"]')).toBeTruthy()
    const svg = container.querySelector('svg')!
    expect(svg.textContent).toContain('salutations')
  })
})
