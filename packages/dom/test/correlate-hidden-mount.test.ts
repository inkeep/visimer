// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SequenceGraph } from '@visimer/core'
import { correlateSequence } from '../src/correlate'

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  }
}

function makeSvg(zeroBbox: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line') as SVGLineElement
  line1.setAttribute('class', 'actor-line')
  const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line') as SVGLineElement
  line2.setAttribute('class', 'actor-line')
  const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect') as SVGRectElement
  p1.setAttribute('name', 'alice')
  const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect') as SVGRectElement
  p2.setAttribute('name', 'bob')
  const msgLine = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement
  msgLine.setAttribute('class', 'messageLine0')
  const msgText = document.createElementNS('http://www.w3.org/2000/svg', 'text') as SVGTextElement
  msgText.setAttribute('class', 'messageText')
  const noteRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect') as SVGRectElement
  noteRect.setAttribute('class', 'note')
  svg.append(p1, p2, line1, line2, msgLine, msgText, noteRect)
  const bboxWidth = zeroBbox ? 0 : 400
  const p1Box = { left: 10, right: 30, top: 0, bottom: 0, width: 20, height: 0, x: 10, y: 0, toJSON: () => ({}) }
  const p2Box = { left: 300, right: 320, top: 0, bottom: 0, width: 20, height: 0, x: 300, y: 0, toJSON: () => ({}) }
  const zero = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
  Object.defineProperty(svg, 'getBoundingClientRect', {
    value: () => (zeroBbox ? zero : { left: 0, right: bboxWidth, top: 0, bottom: 400, width: bboxWidth, height: 400, x: 0, y: 0, toJSON: () => ({}) }),
  })
  Object.defineProperty(p1, 'getBoundingClientRect', { value: () => (zeroBbox ? zero : p1Box) })
  Object.defineProperty(p2, 'getBoundingClientRect', { value: () => (zeroBbox ? zero : p2Box) })
  Object.defineProperty(line1, 'getBoundingClientRect', { value: () => (zeroBbox ? zero : { left: 20, right: 20, top: 0, bottom: 400, width: 0, height: 400, x: 20, y: 0, toJSON: () => ({}) }) })
  Object.defineProperty(line2, 'getBoundingClientRect', { value: () => (zeroBbox ? zero : { left: 310, right: 310, top: 0, bottom: 400, width: 0, height: 400, x: 310, y: 0, toJSON: () => ({}) }) })
  return svg
}

const graph: SequenceGraph = {
  kind: 'sequence',
  participants: [
    { entityId: 'alice-uuid', id: 'alice', type: 'participant', name: 'Alice' },
    { entityId: 'bob-uuid', id: 'bob', type: 'participant', name: 'Bob' },
  ],
  events: [
    { entityId: 'msg-1', kind: 'message', from: 'alice', to: 'bob', label: 'ping' },
    { entityId: 'note-1', kind: 'note', over: ['alice'], label: 'hi' },
  ],
} as unknown as SequenceGraph

describe('correlateSequence hidden-mount guard', () => {
  it('correlates lifelines by proximity when the svg is laid out', () => {
    const svg = makeSvg(false)
    const lifelineEls = svg.querySelectorAll<SVGLineElement>('line.actor-line')
    const [line1, line2] = [lifelineEls[0], lifelineEls[1]]
    const c = correlateSequence(svg, graph)
    expect(c.lifelines.size).toBe(2)
    // alice's participant box is centered at x=20, matches line1 (x=20).
    // bob's is at x=310, matches line2 (x=310). Pinning the mapping —
    // not just "differ" — protects against a swap-by-DOM-order regression.
    expect(c.lifelines.get('alice-uuid')).toBe(line1)
    expect(c.lifelines.get('bob-uuid')).toBe(line2)
  })

  it('leaves lifelines empty when the svg has zero bbox so every participant does not collapse onto the first lifeline', () => {
    const svg = makeSvg(true)
    const c = correlateSequence(svg, graph)
    expect(c.participants.size).toBe(2)
    expect(c.lifelines.size).toBe(0)
  })

  it('still correlates messages and notes under zero bbox (they are index-based)', () => {
    const svg = makeSvg(true)
    const c = correlateSequence(svg, graph)
    expect(c.events.get('msg-1')?.getAttribute('data-mw-entity')).toBe('msg-1')
    expect(c.eventTexts.get('msg-1')?.getAttribute('data-mw-entity')).toBe('msg-1')
    expect(c.events.get('note-1')?.getAttribute('data-mw-entity')).toBe('note-1')
  })
})
