// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SequenceGraph } from '@visimer/core'
import { MermaidCanvasView } from '../src'

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  }
}

type IOCallback = (entries: Array<{ intersectionRatio: number }>) => void
type ObserverRecord = {
  target: Element | null
  callback: IOCallback
  disconnected: boolean
  fire(ratio: number): void
}

function installIntersectionObserverStub(): {
  observers: ObserverRecord[]
  restore(): void
} {
  const observers: ObserverRecord[] = []
  const OriginalIntersectionObserver = (
    globalThis as { IntersectionObserver?: unknown }
  ).IntersectionObserver
  class StubObserver {
    constructor(cb: IOCallback) {
      this.record = {
        target: null,
        callback: cb,
        disconnected: false,
        fire: (ratio: number) => {
          cb([{ intersectionRatio: ratio }])
        },
      }
      observers.push(this.record)
    }
    private record: ObserverRecord
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
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    StubObserver as unknown as typeof IntersectionObserver
  return {
    observers,
    restore() {
      ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
        OriginalIntersectionObserver
    },
  }
}

/**
 * Stamp `getBoundingClientRect` on the SVG root and its child rects/lines so
 * `correlateSequence`'s geometry pass either collapses (hidden mount) or
 * pairs alice→line1, bob→line2 (visible).
 */
function stampGeometry(svg: SVGSVGElement, mode: 'hidden' | 'visible') {
  const zero = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
  Object.defineProperty(svg, 'getBoundingClientRect', {
    value: () =>
      mode === 'hidden'
        ? zero
        : { left: 0, right: 400, top: 0, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) },
    configurable: true,
  })
  const actors = svg.querySelectorAll<Element>('text.actor')
  const lines = svg.querySelectorAll<Element>('line.actor-line')
  const boxes = mode === 'hidden' ? [zero, zero] : [
    { left: 10, right: 30, top: 0, bottom: 20, width: 20, height: 20, x: 10, y: 0, toJSON: () => ({}) },
    { left: 300, right: 320, top: 0, bottom: 20, width: 20, height: 20, x: 300, y: 0, toJSON: () => ({}) },
  ]
  const lineBoxes = mode === 'hidden' ? [zero, zero] : [
    { left: 20, right: 20, top: 0, bottom: 400, width: 0, height: 400, x: 20, y: 0, toJSON: () => ({}) },
    { left: 310, right: 310, top: 0, bottom: 400, width: 0, height: 400, x: 310, y: 0, toJSON: () => ({}) },
  ]
  actors.forEach((el, i) => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => boxes[i],
      configurable: true,
    })
  })
  lines.forEach((el, i) => {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => lineBoxes[i],
      configurable: true,
    })
  })
}

const graph: SequenceGraph = {
  kind: 'sequence',
  participants: [
    { entityId: 'alice-uuid', id: 'alice', type: 'participant', name: 'Alice' },
    { entityId: 'bob-uuid', id: 'bob', type: 'participant', name: 'Bob' },
  ],
  events: [],
} as unknown as SequenceGraph

type ArmRetryView = MermaidCanvasView & {
  svg: SVGSVGElement | null
  seqCorrelation: { lifelines: Map<string, Element> } | null
  visibilityRetryObserver: { disconnect(): void } | null
  armVisibilityRetry(svg: SVGSVGElement, sequence: SequenceGraph | null): void
}

describe('armVisibilityRetry', () => {
  let ioStub: ReturnType<typeof installIntersectionObserverStub>
  let view: ArmRetryView

  beforeEach(() => {
    ioStub = installIntersectionObserverStub()
    // Bypass the constructor — it wires the whole editor / mermaid mount
    // pipeline, and none of that is relevant here. armVisibilityRetry only
    // reads three fields and calls correlateSequence, so a prototype-only
    // instance suffices.
    view = Object.create(MermaidCanvasView.prototype) as ArmRetryView
    view.svg = null
    view.seqCorrelation = null
    view.visibilityRetryObserver = null
  })

  afterEach(() => {
    ioStub.restore()
  })

  it('arms the observer when the svg has zero width and re-runs correlation on reveal', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const cls of ['alice', 'bob']) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('class', 'actor')
      t.setAttribute('name', cls)
      svg.appendChild(t)
    }
    for (let i = 0; i < 2; i++) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      l.setAttribute('class', 'actor-line')
      svg.appendChild(l)
    }

    // Hidden-mount initial state: correlation stamps participants but not
    // lifelines. That empty lifelines map is what armVisibilityRetry keys off.
    stampGeometry(svg, 'hidden')
    view.svg = svg
    view.seqCorrelation = { lifelines: new Map() }

    view.armVisibilityRetry(svg, graph)
    expect(ioStub.observers.length).toBe(1)
    expect(ioStub.observers[0].target).toBe(svg)

    // Flip to visible layout, then fire the observer with intersectionRatio > 0.
    stampGeometry(svg, 'visible')
    ioStub.observers[0].fire(0.5)

    // Correlation re-ran and populated lifelines.
    expect(view.seqCorrelation?.lifelines.size).toBe(2)
    // Observer disconnected itself after the one-shot fired.
    expect(ioStub.observers[0].disconnected).toBe(true)
    expect(view.visibilityRetryObserver).toBeNull()
  })

  it('does not arm when the initial correlation already produced lifelines (svg is visible)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    view.svg = svg
    view.seqCorrelation = { lifelines: new Map([['alice-uuid', document.createElement('div')]]) }

    view.armVisibilityRetry(svg, graph)
    expect(ioStub.observers.length).toBe(0)
  })

  it('is a no-op when there is no sequence graph', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    view.svg = svg
    view.seqCorrelation = null

    view.armVisibilityRetry(svg, null)
    expect(ioStub.observers.length).toBe(0)
  })

  it('skips the callback when the fire-time svg still has zero width (mid-transition)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const cls of ['alice', 'bob']) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('class', 'actor')
      t.setAttribute('name', cls)
      svg.appendChild(t)
    }
    for (let i = 0; i < 2; i++) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      l.setAttribute('class', 'actor-line')
      svg.appendChild(l)
    }
    stampGeometry(svg, 'hidden')
    view.svg = svg
    view.seqCorrelation = { lifelines: new Map() }
    view.armVisibilityRetry(svg, graph)

    // Fire with intersectionRatio > 0 but leave geometry zero: observer must
    // NOT consume its one-shot, so a later fire (once real geometry lands)
    // can still recover.
    ioStub.observers[0].fire(0.5)
    expect(view.seqCorrelation?.lifelines.size).toBe(0)
    expect(ioStub.observers[0].disconnected).toBe(false)
    expect(view.visibilityRetryObserver).not.toBeNull()

    stampGeometry(svg, 'visible')
    ioStub.observers[0].fire(0.5)
    expect(view.seqCorrelation?.lifelines.size).toBe(2)
  })
})
