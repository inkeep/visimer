export interface WarpAxis {
  lo: number
  hi: number
  delta: number
}

export function warpCoord(v: number, axis: WarpAxis): number {
  const { lo, hi, delta } = axis
  if (delta === 0) return v
  if (v <= lo) return v - delta / 2
  if (v >= hi) return v + delta / 2
  return lo - delta / 2 + ((v - lo) * (hi - lo + delta)) / (hi - lo)
}

function warpSlope(v: number, axis: WarpAxis): number {
  return v > axis.lo && v < axis.hi ? (axis.hi - axis.lo + axis.delta) / (axis.hi - axis.lo) : 1
}

interface Frame {
  a: number
  d: number
  e: number
  f: number
}

const IDENTITY: Frame = { a: 1, d: 1, e: 0, f: 0 }

const PARAMS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)/y

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

export function warpPathData(d: string, ax: WarpAxis, ay: WarpAxis, frame: Frame = IDENTITY): string {
  const tokens: Array<string | number> = []
  PATH_TOKEN.lastIndex = 0
  while (PATH_TOKEN.lastIndex < d.length) {
    const m = PATH_TOKEN.exec(d)
    if (!m) return d
    if (m[1]) tokens.push(m[1])
    else if (m[2]) tokens.push(Number(m[2]))
  }
  const toRootX = (x: number) => frame.a * x + frame.e
  const toRootY = (y: number) => frame.d * y + frame.f
  const mapX = (x: number) => (warpCoord(toRootX(x), ax) - frame.e) / frame.a
  const mapY = (y: number) => (warpCoord(toRootY(y), ay) - frame.f) / frame.d
  const out: string[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let i = 0
  let cmd = ''
  while (i < tokens.length) {
    const t = tokens[i]
    if (typeof t === 'string') {
      cmd = t
      i++
    } else if (!cmd || cmd === 'Z' || cmd === 'z') {
      return d
    }
    const upper = cmd.toUpperCase()
    const rel = cmd !== upper
    const count = PARAMS[upper]
    if (count === 0) {
      out.push('Z')
      cx = sx
      cy = sy
      continue
    }
    const args = tokens.slice(i, i + count)
    if (args.length !== count || args.some((a) => typeof a !== 'number')) return d
    const n = args as number[]
    i += count
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    switch (upper) {
      case 'H': {
        cx = n[0] + ox
        out.push(`H${fmt(mapX(cx))}`)
        break
      }
      case 'V': {
        cy = n[0] + oy
        out.push(`V${fmt(mapY(cy))}`)
        break
      }
      case 'A': {
        const x = n[5] + ox
        const y = n[6] + oy
        const rx = n[0] * warpSlope(toRootX(x), ax)
        const ry = n[1] * warpSlope(toRootY(y), ay)
        out.push(`A${fmt(rx)},${fmt(ry)},${n[2]},${n[3]},${n[4]},${fmt(mapX(x))},${fmt(mapY(y))}`)
        cx = x
        cy = y
        break
      }
      default: {
        const pts: string[] = []
        for (let k = 0; k < count; k += 2) {
          const x = n[k] + ox
          const y = n[k + 1] + oy
          pts.push(`${fmt(mapX(x))},${fmt(mapY(y))}`)
          if (k + 2 === count) {
            cx = x
            cy = y
          }
        }
        out.push(`${upper}${pts.join(' ')}`)
        if (upper === 'M') {
          sx = cx
          sy = cy
          cmd = rel ? 'l' : 'L'
        }
      }
    }
  }
  return out.join('')
}

const RIGID_SELECTOR = 'g.node, g.edgeLabel, g.cluster-label'
const SHAPE_SELECTOR = 'path, rect, polygon, polyline, line, circle, ellipse'
const SHAPE_ATTRS = ['d', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry'] as const

interface RigidItem {
  el: SVGGraphicsElement
  transform: string | null
  cx: number
  cy: number
  parentScaleX: number
  parentScaleY: number
}

interface ShapeItem {
  el: SVGGraphicsElement
  frame: Frame
  attrs: Map<string, string | null>
}

export interface LiveLayout {
  svg: SVGSVGElement
  span: { x0: number; x1: number; y0: number; y1: number }
  viewBox: { x: number; y: number; width: number; height: number }
  labelGroup: { el: SVGGraphicsElement; transform: string | null; parentScaleX: number; parentScaleY: number }
  labelBox: { el: SVGForeignObjectElement; width: number; height: number; scaleX: number; scaleY: number }
  rigid: RigidItem[]
  shapes: ShapeItem[]
}

function frameOf(rootInverse: DOMMatrix, el: Element | null): Frame | null {
  if (!(el instanceof SVGGraphicsElement)) return null
  const ctm = el.getScreenCTM()
  if (!ctm) return null
  const m = rootInverse.multiply(ctm)
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || !m.a || !m.d) return null
  return { a: m.a, d: m.d, e: m.e, f: m.f }
}

export function captureLiveLayout(svg: SVGSVGElement, label: HTMLElement): LiveLayout | null {
  if (typeof svg.getScreenCTM !== 'function' || !svg.querySelector('g.root')) return null
  const rootCtm = svg.getScreenCTM()
  const fo = label.closest('foreignObject')
  const labelGroup = fo?.parentElement
  const focus = label.closest(RIGID_SELECTOR)
  if (!rootCtm || !(fo instanceof SVGForeignObjectElement) || !(labelGroup instanceof SVGGraphicsElement)) return null
  if (!(focus instanceof SVGGraphicsElement) || !svg.contains(focus) || !focus.contains(labelGroup)) return null
  const vb = svg.viewBox?.baseVal
  if (!vb || !vb.width || !vb.height) return null
  const inverse = rootCtm.inverse()

  const focusFrame = frameOf(inverse, focus)
  const box = focus.getBBox()
  if (!focusFrame || !box.width || !box.height) return null
  const x0 = focusFrame.a * box.x + focusFrame.e
  const y0 = focusFrame.d * box.y + focusFrame.f
  const span = { x0, x1: x0 + focusFrame.a * box.width, y0, y1: y0 + focusFrame.d * box.height }

  const labelParentFrame = frameOf(inverse, labelGroup.parentElement)
  const foFrame = frameOf(inverse, fo)
  if (!labelParentFrame || !foFrame) return null

  const rigid: RigidItem[] = []
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(RIGID_SELECTOR)) {
    if (el === focus || el.contains(focus)) continue
    const bb = el.getBBox()
    if (!bb.width && !bb.height) continue
    const frame = frameOf(inverse, el)
    const parentFrame = frameOf(inverse, el.parentElement)
    if (!frame || !parentFrame) continue
    rigid.push({
      el,
      transform: el.getAttribute('transform'),
      cx: frame.a * (bb.x + bb.width / 2) + frame.e,
      cy: frame.d * (bb.y + bb.height / 2) + frame.f,
      parentScaleX: parentFrame.a,
      parentScaleY: parentFrame.d,
    })
  }

  const shapes: ShapeItem[] = []
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(SHAPE_SELECTOR)) {
    if (el.closest('defs, marker, foreignObject, clipPath, mask, pattern, symbol')) continue
    const block = el.closest(RIGID_SELECTOR)
    if (block && block !== focus) continue
    if (labelGroup.contains(el)) continue
    if (el.localName === 'rect' && !el.hasAttribute('width')) continue
    const frame = frameOf(inverse, el)
    if (!frame) continue
    const attrs = new Map<string, string | null>()
    for (const name of SHAPE_ATTRS) attrs.set(name, el.getAttribute(name))
    shapes.push({ el, frame, attrs })
  }

  return {
    svg,
    span,
    viewBox: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
    labelGroup: {
      el: labelGroup,
      transform: labelGroup.getAttribute('transform'),
      parentScaleX: labelParentFrame.a,
      parentScaleY: labelParentFrame.d,
    },
    labelBox: {
      el: fo,
      width: fo.width.baseVal.value,
      height: fo.height.baseVal.value,
      scaleX: foFrame.a,
      scaleY: foFrame.d,
    },
    rigid,
    shapes,
  }
}

function setOrRemove(el: Element, name: string, value: string | null) {
  if (value === null) el.removeAttribute(name)
  else el.setAttribute(name, value)
}

function prependTranslate(original: string | null, tx: number, ty: number): string | null {
  if (Math.abs(tx) < 1e-3 && Math.abs(ty) < 1e-3) return original
  return `translate(${fmt(tx)}, ${fmt(ty)})${original ? ` ${original}` : ''}`
}

function num(attrs: Map<string, string | null>, name: string): number {
  return Number(attrs.get(name) ?? 0) || 0
}

function warpShape(item: ShapeItem, ax: WarpAxis, ay: WarpAxis) {
  const { el, frame, attrs } = item
  const toRootX = (x: number) => frame.a * x + frame.e
  const toRootY = (y: number) => frame.d * y + frame.f
  const mapX = (x: number) => (warpCoord(toRootX(x), ax) - frame.e) / frame.a
  const mapY = (y: number) => (warpCoord(toRootY(y), ay) - frame.f) / frame.d
  for (const [name, value] of attrs) setOrRemove(el, name, value)
  switch (el.localName) {
    case 'path': {
      const d = attrs.get('d')
      if (d) el.setAttribute('d', warpPathData(d, ax, ay, frame))
      break
    }
    case 'rect': {
      const x = num(attrs, 'x')
      const y = num(attrs, 'y')
      const nx = mapX(x)
      const ny = mapY(y)
      el.setAttribute('x', fmt(nx))
      el.setAttribute('y', fmt(ny))
      el.setAttribute('width', fmt(Math.max(0, mapX(x + num(attrs, 'width')) - nx)))
      el.setAttribute('height', fmt(Math.max(0, mapY(y + num(attrs, 'height')) - ny)))
      break
    }
    case 'line': {
      el.setAttribute('x1', fmt(mapX(num(attrs, 'x1'))))
      el.setAttribute('y1', fmt(mapY(num(attrs, 'y1'))))
      el.setAttribute('x2', fmt(mapX(num(attrs, 'x2'))))
      el.setAttribute('y2', fmt(mapY(num(attrs, 'y2'))))
      break
    }
    case 'polygon':
    case 'polyline': {
      const values = (attrs.get('points') ?? '').trim().split(/[\s,]+/).map(Number)
      if (values.length < 2 || values.length % 2 || values.some(Number.isNaN)) break
      const pairs: string[] = []
      for (let k = 0; k < values.length; k += 2) pairs.push(`${fmt(mapX(values[k]))},${fmt(mapY(values[k + 1]))}`)
      el.setAttribute('points', pairs.join(' '))
      break
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(attrs, 'cx')
      const cy = num(attrs, 'cy')
      const rx = el.localName === 'circle' ? num(attrs, 'r') : num(attrs, 'rx')
      const ry = el.localName === 'circle' ? rx : num(attrs, 'ry')
      const nrx = (mapX(cx + rx) - mapX(cx - rx)) / 2
      const nry = (mapY(cy + ry) - mapY(cy - ry)) / 2
      el.setAttribute('cx', fmt(mapX(cx)))
      el.setAttribute('cy', fmt(mapY(cy)))
      if (el.localName === 'circle') el.setAttribute('r', fmt(Math.max(nrx, nry)))
      else {
        el.setAttribute('rx', fmt(nrx))
        el.setAttribute('ry', fmt(nry))
      }
      break
    }
  }
}

export function applyLiveLayout(layout: LiveLayout, dx: number, dy: number) {
  const ax: WarpAxis = { lo: layout.span.x0, hi: layout.span.x1, delta: dx }
  const ay: WarpAxis = { lo: layout.span.y0, hi: layout.span.y1, delta: dy }
  const vb = layout.viewBox
  const vx0 = warpCoord(vb.x, ax)
  const vy0 = warpCoord(vb.y, ay)
  const width = warpCoord(vb.x + vb.width, ax) - vx0
  const height = warpCoord(vb.y + vb.height, ay) - vy0
  layout.svg.setAttribute('viewBox', `${fmt(vx0)} ${fmt(vy0)} ${fmt(width)} ${fmt(height)}`)

  const { labelGroup, labelBox } = layout
  setOrRemove(
    labelGroup.el,
    'transform',
    prependTranslate(labelGroup.transform, -dx / 2 / labelGroup.parentScaleX, -dy / 2 / labelGroup.parentScaleY),
  )
  labelBox.el.setAttribute('width', fmt(Math.max(0, labelBox.width + dx / labelBox.scaleX)))
  labelBox.el.setAttribute('height', fmt(Math.max(0, labelBox.height + dy / labelBox.scaleY)))

  for (const item of layout.rigid) {
    const tx = (warpCoord(item.cx, ax) - item.cx) / item.parentScaleX
    const ty = (warpCoord(item.cy, ay) - item.cy) / item.parentScaleY
    setOrRemove(item.el, 'transform', prependTranslate(item.transform, tx, ty))
  }
  for (const item of layout.shapes) warpShape(item, ax, ay)
}

const GEOMETRY_ATTRS = ['transform', ...SHAPE_ATTRS] as const
const SVG_NS = 'http://www.w3.org/2000/svg'

function isLiveOnly(el: Element): boolean {
  return el.localName === 'style' || el.hasAttribute('data-mw-hit-overlay') || el.classList.contains('mw-ghost-edge')
}

function pairTrees(live: Element, fresh: Element, keep: Element, out: Array<[Element, Element]>): boolean {
  if (live.localName !== fresh.localName || live.namespaceURI !== fresh.namespaceURI) return false
  out.push([live, fresh])
  if (live === keep) return true
  const liveKids = [...live.children].filter((c) => !isLiveOnly(c))
  const freshKids = [...fresh.children].filter((c) => c.localName !== 'style')
  if (liveKids.length !== freshKids.length) return false
  return liveKids.every((child, i) => pairTrees(child, freshKids[i], keep, out))
}

export function transplantGeometry(live: SVGSVGElement, fresh: SVGSVGElement, keep: Element): boolean {
  const pairs: Array<[Element, Element]> = []
  if (!pairTrees(live, fresh, keep, pairs) || !pairs.some(([el]) => el === keep)) return false
  for (const [liveEl, freshEl] of pairs) {
    if (liveEl === live || liveEl === keep) continue
    if (liveEl.namespaceURI === SVG_NS) {
      for (const name of GEOMETRY_ATTRS) setOrRemove(liveEl, name, freshEl.getAttribute(name))
    } else {
      setOrRemove(liveEl, 'style', freshEl.getAttribute('style'))
      const leaf = liveEl.childElementCount === 0 && freshEl.childElementCount === 0
      if (leaf && liveEl.textContent !== freshEl.textContent) liveEl.textContent = freshEl.textContent
    }
  }
  for (const overlay of live.querySelectorAll('[data-mw-hit-overlay]')) {
    const visible = overlay.nextElementSibling
    const d = visible?.getAttribute('d')
    if (d) overlay.setAttribute('d', d)
  }
  setOrRemove(live, 'viewBox', fresh.getAttribute('viewBox'))
  return true
}
