// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyLiveLayout, transplantGeometry, warpCoord, warpPathData, type LiveLayout, type WarpAxis } from '../src/live-layout'

const SPAN: WarpAxis = { lo: 100, hi: 200, delta: 40 }
const FLAT: WarpAxis = { lo: 0, hi: 10, delta: 0 }

describe('warpCoord', () => {
  it('pushes both sides of the span apart and stretches the inside evenly', () => {
    expect(warpCoord(50, SPAN)).toBe(30)
    expect(warpCoord(250, SPAN)).toBe(270)
    expect(warpCoord(100, SPAN)).toBe(80)
    expect(warpCoord(200, SPAN)).toBe(220)
    expect(warpCoord(150, SPAN)).toBe(150)
  })

  it('shrinks the span when the label gets shorter', () => {
    const shrink = { ...SPAN, delta: -20 }
    expect(warpCoord(50, shrink)).toBe(60)
    expect(warpCoord(250, shrink)).toBe(240)
    expect(warpCoord(150, shrink)).toBe(150)
  })
})

describe('warpPathData', () => {
  it('moves an edge that crosses the edited box with the box', () => {
    expect(warpPathData('M50,10L150,10C160,10,240,10,250,10', SPAN, FLAT)).toBe('M30,10L150,10C164,10 260,10 270,10')
  })

  it('resolves relative commands against the current point', () => {
    expect(warpPathData('m50,10 l100,0 l100,0', SPAN, FLAT)).toBe('M30,10L150,10L270,10')
    expect(warpPathData('M50,10 100,10 250,10', SPAN, FLAT)).toBe('M30,10L80,10L270,10')
  })

  it('warps horizontal and vertical segments on their own axis', () => {
    const down: WarpAxis = { lo: 0, hi: 10, delta: 10 }
    expect(warpPathData('M50,0H250V20z', SPAN, down)).toBe('M30,-5H270V25Z')
  })

  it('leaves data it cannot parse untouched', () => {
    expect(warpPathData('M50,10 L oops', SPAN, FLAT)).toBe('M50,10 L oops')
  })
})

const SVG_NS = 'http://www.w3.org/2000/svg'

function svgFrom(markup: string): SVGSVGElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  return host.querySelector('svg') as SVGSVGElement
}

function diagram(opts: { aLabel: string; bLabel: string; width: number; edge: string; extraNode?: boolean }) {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${opts.width} 70">
    <style>.x{}</style>
    <g class="root"><g class="edgePaths"><path class="flowchart-link" d="${opts.edge}"></path></g>
    <g class="nodes">
      <g class="node" transform="translate(50, 35)"><rect x="-40" y="-27" width="80" height="54"></rect>
        <g class="label" transform="translate(-30, -12)"><foreignObject width="60" height="24"><div style="display: table-cell;"><span class="nodeLabel"><p>${opts.aLabel}</p></span></div></foreignObject></g></g>
      <g class="node" transform="translate(${opts.width - 50}, 35)"><rect x="-40" y="-27" width="80" height="54"></rect>
        <g class="label" transform="translate(-30, -12)"><foreignObject width="60" height="24"><div style="display: table-cell;"><span class="nodeLabel"><p>${opts.bLabel}</p></span></div></foreignObject></g></g>
      ${opts.extraNode ? '<g class="node"></g>' : ''}
    </g></g></svg>`
}

function liveDiagram() {
  const live = svgFrom(diagram({ aLabel: 'Write a doc and more', bLabel: 'End', width: 300, edge: 'M90,35L210,35' }))
  const visible = live.querySelector('path.flowchart-link')!
  const overlay = document.createElementNS(SVG_NS, 'path')
  overlay.setAttribute('data-mw-hit-overlay', 'edge:A->B#0')
  overlay.setAttribute('d', 'M90,35L210,35')
  visible.parentNode!.insertBefore(overlay, visible)
  const keyframes = document.createElementNS(SVG_NS, 'style')
  keyframes.setAttribute('data-vsmr-flow', '')
  live.insertBefore(keyframes, live.firstChild)
  const editing = live.querySelector<HTMLElement>('.nodeLabel p')!
  editing.setAttribute('contenteditable', 'true')
  editing.style.whiteSpace = 'nowrap'
  return { live, overlay, editing }
}

describe('transplantGeometry', () => {
  it('moves the live elements onto the fresh layout without touching the label being typed into', () => {
    const { live, overlay, editing } = liveDiagram()
    const fresh = svgFrom(
      diagram({ aLabel: 'Write a doc and', bLabel: 'Finish', width: 360, edge: 'M120,35L270,35' }),
    )
    const nodeA = live.querySelector('g.node')!
    nodeA.querySelector('rect')!.setAttribute('width', '95')
    nodeA.querySelector('foreignObject')!.parentElement!.setAttribute('transform', 'translate(-50, -12) translate(-30, -12)')

    expect(transplantGeometry(live, fresh, editing)).toBe(true)

    expect(live.getAttribute('viewBox')).toBe('0 0 360 70')
    expect(live.querySelector('path.flowchart-link')!.getAttribute('d')).toBe('M120,35L270,35')
    expect(overlay.getAttribute('d')).toBe('M120,35L270,35')
    expect(nodeA.querySelector('rect')!.getAttribute('width')).toBe('80')
    expect(nodeA.querySelector('foreignObject')!.parentElement!.getAttribute('transform')).toBe('translate(-30, -12)')
    expect(live.querySelectorAll('g.node')[1].getAttribute('transform')).toBe('translate(310, 35)')
    expect(editing.textContent).toBe('Write a doc and more')
    expect(editing.getAttribute('contenteditable')).toBe('true')
    expect(editing.style.whiteSpace).toBe('nowrap')
    expect(live.querySelectorAll('.nodeLabel p')[1].textContent).toBe('Finish')
  })

  it('changes nothing when the fresh render has a different shape', () => {
    const { live, editing } = liveDiagram()
    const before = live.outerHTML
    const fresh = svgFrom(
      diagram({ aLabel: 'Write a doc', bLabel: 'End', width: 360, edge: 'M120,35L270,35', extraNode: true }),
    )

    expect(transplantGeometry(live, fresh, editing)).toBe(false)
    expect(live.outerHTML).toBe(before)
  })
})

describe('applyLiveLayout', () => {
  function handBuiltLayout() {
    const svg = svgFrom(`<svg xmlns="${SVG_NS}" viewBox="0 0 300 70"><g class="root">
      <g class="edgePaths"><g transform="translate(100, 0)"><path d="M-10,35L110,35"></path></g></g>
      <g class="node" id="a" transform="translate(50, 35)"><rect x="-40" y="-27" width="80" height="54"></rect>
        <g class="label" transform="translate(-30, -12)"><foreignObject width="60" height="24"></foreignObject></g></g>
      <g class="node" id="b" transform="translate(250, 35)"><rect x="-40" y="-27" width="80" height="54"></rect></g>
    </g></svg>`)
    const nodeA = svg.querySelector('#a')!
    const rect = nodeA.querySelector('rect')!
    const edge = svg.querySelector('path')!
    const labelGroup = nodeA.querySelector('g.label')!
    const labelBox = nodeA.querySelector('foreignObject')!
    const attrsOf = (el: Element, names: string[]) => new Map(names.map((n) => [n, el.getAttribute(n)]))
    const layout = {
      svg,
      span: { x0: 10, x1: 90, y0: 8, y1: 62 },
      viewBox: { x: 0, y: 0, width: 300, height: 70 },
      labelGroup: { el: labelGroup, transform: labelGroup.getAttribute('transform'), parentScaleX: 1, parentScaleY: 1 },
      labelBox: { el: labelBox, width: 60, height: 24, scaleX: 1, scaleY: 1 },
      rigid: [{ el: svg.querySelector('#b')!, transform: 'translate(250, 35)', cx: 250, cy: 35, parentScaleX: 1, parentScaleY: 1 }],
      shapes: [
        { el: rect, frame: { a: 1, d: 1, e: 50, f: 35 }, attrs: attrsOf(rect, ['x', 'y', 'width', 'height']) },
        { el: edge, frame: { a: 1, d: 1, e: 100, f: 0 }, attrs: attrsOf(edge, ['d']) },
      ],
    } as unknown as LiveLayout
    return { svg, layout, rect, edge, labelGroup, labelBox }
  }

  it('widens the edited shape around its centre and moves the rest of the diagram apart', () => {
    const { svg, layout, rect, edge, labelGroup, labelBox } = handBuiltLayout()
    applyLiveLayout(layout, 40, 0)

    expect(svg.getAttribute('viewBox')).toBe('-20 0 340 70')
    expect(rect.getAttribute('x')).toBe('-60')
    expect(rect.getAttribute('width')).toBe('120')
    expect(labelGroup.getAttribute('transform')).toBe('translate(-20, 0) translate(-30, -12)')
    expect(labelBox.getAttribute('width')).toBe('100')
    expect(svg.querySelector('#b')!.getAttribute('transform')).toBe('translate(20, 0) translate(250, 35)')
    expect(edge.getAttribute('d')).toBe('M10,35L130,35')
  })

  it('puts every attribute back when the growth returns to zero', () => {
    const { svg, layout } = handBuiltLayout()
    const original = svg.outerHTML
    applyLiveLayout(layout, 40, 12)
    expect(svg.outerHTML).not.toBe(original)

    applyLiveLayout(layout, 0, 0)
    expect(svg.outerHTML).toBe(original)
  })
})
