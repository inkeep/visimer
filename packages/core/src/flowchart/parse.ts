import type { LineInfo, Span } from '../types'

/** Node shapes expressible with bracket syntax. */
export type ShapeId =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'doublecircle'
  | 'diamond'
  | 'hexagon'
  | 'lean_r'
  | 'lean_l'
  | 'trap_t'
  | 'trap_b'
  | 'odd'

interface ShapeDef {
  open: string
  close: string[]
}

/** Ordered longest-open-first so matching is unambiguous. */
const SHAPE_OPENS: ShapeDef[] = [
  { open: '(((', close: [')))'] },
  { open: '([', close: ['])'] },
  { open: '[[', close: [']]'] },
  { open: '[(', close: [')]'] },
  { open: '[/', close: ['/]', '\\]'] },
  { open: '[\\', close: ['\\]', '/]'] },
  { open: '((', close: ['))'] },
  { open: '{{', close: ['}}'] },
  { open: '{', close: ['}'] },
  { open: '(', close: [')'] },
  { open: '[', close: [']'] },
  { open: '>', close: [']'] },
]

const SHAPE_BY_DELIMS: Record<string, ShapeId> = {
  '(((|)))': 'doublecircle',
  '((|))': 'circle',
  '([|])': 'stadium',
  '[[|]]': 'subroutine',
  '[(|)]': 'cylinder',
  '[/|/]': 'lean_r',
  '[/|\\]': 'trap_b',
  '[\\|\\]': 'lean_l',
  '[\\|/]': 'trap_t',
  '{{|}}': 'hexagon',
  '{|}': 'diamond',
  '(|)': 'round',
  '[|]': 'rect',
  '>|]': 'odd',
}

export const SHAPE_DELIMS: Record<ShapeId, { open: string; close: string }> = {
  rect: { open: '[', close: ']' },
  round: { open: '(', close: ')' },
  stadium: { open: '([', close: '])' },
  subroutine: { open: '[[', close: ']]' },
  cylinder: { open: '[(', close: ')]' },
  circle: { open: '((', close: '))' },
  doublecircle: { open: '(((', close: ')))' },
  diamond: { open: '{', close: '}' },
  hexagon: { open: '{{', close: '}}' },
  lean_r: { open: '[/', close: '/]' },
  lean_l: { open: '[\\', close: '\\]' },
  trap_t: { open: '[\\', close: '/]' },
  trap_b: { open: '[/', close: '\\]' },
  odd: { open: '>', close: ']' },
}

export interface NodeRef {
  id: string
  /** full ref span (id + shape + attrs + :::classes), absolute offsets */
  span: Span
  idSpan: Span
  shape: ShapeId | null
  /** raw label text (between delimiters, excluding quotes) */
  label: string | null
  /** span of the label text (inside quotes if quoted) */
  labelSpan: Span | null
  quoted: boolean
  /** raw @{...} attribute blob, if present */
  attrsRaw: string | null
  classNames: string[]
}

export type EdgeLine = 'solid' | 'thick' | 'dotted' | 'invisible'
export type EdgeArrow = 'arrow' | 'open' | 'circle' | 'cross'

export interface EdgeSeg {
  /** span covering operator plus any label form, absolute offsets */
  span: Span
  raw: string
  line: EdgeLine
  arrowEnd: EdgeArrow
  arrowStart: EdgeArrow
  label: string | null
  labelSpan: Span | null
}

export interface ChainStmt {
  kind: 'chain'
  lineIndex: number
  /** groups of `&`-joined node refs; edges[i] connects groups[i] → groups[i+1] */
  groups: NodeRef[][]
  edges: EdgeSeg[]
}

export interface SubgraphOpenStmt {
  kind: 'subgraphOpen'
  lineIndex: number
  id: string
  title: string | null
  titleSpan: Span | null
}

export interface SimpleStmt {
  kind: 'end' | 'direction' | 'classDef' | 'classAssign' | 'style' | 'linkStyle' | 'click' | 'unknown'
  lineIndex: number
  /** for 'classAssign': node id list; for 'style'/'click': [targetId]; for 'direction': [dir] */
  ids: string[]
  /** span of the id-list portion (classAssign) or full trimmed statement */
  idsSpan: Span | null
}

export type FlowStmt = ChainStmt | SubgraphOpenStmt | SimpleStmt

const ID_CHAR = /[A-Za-z0-9_.]/
const DIRECTIONS = ['TB', 'TD', 'BT', 'RL', 'LR']

class LineParser {
  text: string
  pos = 0
  end: number
  base: number

  constructor(line: LineInfo) {
    this.text = line.text
    this.base = line.start
    // trim trailing semicolons/whitespace (mermaid allows optional `;`)
    let e = this.text.length
    while (e > 0 && /[;\s]/.test(this.text[e - 1])) e--
    this.end = e
    // skip indent
    let p = 0
    while (p < e && /[ \t]/.test(this.text[p])) p++
    this.pos = p
  }

  skipWs() {
    while (this.pos < this.end && /[ \t]/.test(this.text[this.pos])) this.pos++
  }

  atEnd() {
    return this.pos >= this.end
  }

  abs(rel: number): number {
    return this.base + rel
  }

  parseNodeRef(): NodeRef | null {
    const start = this.pos
    const idStart = this.pos
    while (this.pos < this.end && ID_CHAR.test(this.text[this.pos])) this.pos++
    if (this.pos === idStart) return null
    const id = this.text.slice(idStart, this.pos)
    const idSpan: Span = { start: this.abs(idStart), end: this.abs(this.pos) }

    let shape: ShapeId | null = null
    let label: string | null = null
    let labelSpan: Span | null = null
    let quoted = false

    for (const def of SHAPE_OPENS) {
      if (this.text.startsWith(def.open, this.pos)) {
        const openEnd = this.pos + def.open.length
        let closeStr: string | null = null
        let labelStart: number
        let labelEnd: number
        let afterLabel: number
        if (this.text[openEnd] === '"') {
          const q = this.text.indexOf('"', openEnd + 1)
          if (q === -1 || q >= this.end) return null
          labelStart = openEnd + 1
          labelEnd = q
          afterLabel = q + 1
          quoted = true
          for (const c of def.close) {
            if (this.text.startsWith(c, afterLabel)) {
              closeStr = c
              break
            }
          }
          if (!closeStr) return null
          this.pos = afterLabel + closeStr.length
        } else {
          let best = -1
          for (const c of def.close) {
            const i = this.text.indexOf(c, openEnd)
            if (i !== -1 && i < this.end && (best === -1 || i < best)) {
              best = i
              closeStr = c
            }
          }
          if (best === -1 || !closeStr) return null
          labelStart = openEnd
          labelEnd = best
          this.pos = best + closeStr.length
        }
        shape = SHAPE_BY_DELIMS[`${def.open}|${closeStr}`] ?? 'rect'
        label = this.text.slice(labelStart, labelEnd)
        labelSpan = { start: this.abs(labelStart), end: this.abs(labelEnd) }
        break
      }
    }

    // v11 `@{ shape: ..., label: ... }` attribute object — preserved raw
    let attrsRaw: string | null = null
    if (this.text.startsWith('@{', this.pos)) {
      const close = this.text.indexOf('}', this.pos + 2)
      if (close === -1 || close >= this.end + 1) return null
      attrsRaw = this.text.slice(this.pos, close + 1)
      this.pos = close + 1
    }

    const classNames: string[] = []
    while (this.text.startsWith(':::', this.pos)) {
      let p = this.pos + 3
      const cStart = p
      while (p < this.end && /[A-Za-z0-9_-]/.test(this.text[p])) p++
      if (p === cStart) return null
      classNames.push(this.text.slice(cStart, p))
      this.pos = p
    }

    return {
      id,
      span: { start: this.abs(start), end: this.abs(this.pos) },
      idSpan,
      shape,
      label,
      labelSpan,
      quoted,
      attrsRaw,
      classNames,
    }
  }

  parseGroup(): NodeRef[] | null {
    const first = this.parseNodeRef()
    if (!first) return null
    const refs = [first]
    while (true) {
      const save = this.pos
      this.skipWs()
      if (this.text[this.pos] === '&') {
        this.pos++
        this.skipWs()
        const next = this.parseNodeRef()
        if (!next) return null
        refs.push(next)
      } else {
        this.pos = save
        break
      }
    }
    return refs
  }

  parseEdge(): EdgeSeg | null {
    const start = this.pos
    const rest = this.text.slice(this.pos, this.end)
    const m = /^(?:(x|o|<)(?=[-=.~]))?(-{2,}|={2,}|-\.+-+|-\.+|~{3,})(>|x|o)?/.exec(rest)
    if (!m) return null
    let raw = m[0]
    this.pos += raw.length
    const startDec: string | null = m[1] ?? null
    let endDec: string | null = m[3] ?? null
    const body = m[2]

    let label: string | null = null
    let labelSpan: Span | null = null

    // mid-label form: `-- text -->`, `== text ==>`, `-. text .->`
    if (!endDec && /^(-{2}|={2}|-\.+-*)$/.test(body) && this.text[this.pos] === ' ') {
      const closeRe =
        body[0] === '='
          ? /\s(={2,}(>|x|o)?)/
          : body.includes('.')
            ? /\s(\.*-*\.+->|\.+-+(>|x|o)?|\.->)/
            : /\s(-{2,}(>|x|o)?)/
      const tail = this.text.slice(this.pos, this.end)
      const cm = closeRe.exec(tail)
      if (cm && cm.index >= 0) {
        const lStart = this.pos + 1
        const lEnd = this.pos + cm.index
        if (lEnd > lStart - 1) {
          label = this.text.slice(lStart, lEnd)
          labelSpan = { start: this.abs(lStart), end: this.abs(lEnd) }
          const closeRaw = cm[1]
          this.pos = this.pos + cm.index + cm[0].length
          endDec = /[>xo]$/.test(closeRaw) ? closeRaw[closeRaw.length - 1] : null
        }
      }
    }

    // pipe label form: `-->|text|`
    const savePos = this.pos
    this.skipWs()
    if (this.text[this.pos] === '|') {
      const close = this.text.indexOf('|', this.pos + 1)
      if (close !== -1 && close < this.end) {
        label = this.text.slice(this.pos + 1, close)
        labelSpan = { start: this.abs(this.pos + 1), end: this.abs(close) }
        this.pos = close + 1
      } else {
        this.pos = savePos
      }
    } else {
      this.pos = savePos
    }

    raw = this.text.slice(start, this.pos)
    const line: EdgeLine =
      body[0] === '=' ? 'thick' : body.includes('.') ? 'dotted' : body[0] === '~' ? 'invisible' : 'solid'
    const dec = (d: string | null): EdgeArrow =>
      d === '>' ? 'arrow' : d === 'x' ? 'cross' : d === 'o' ? 'circle' : 'open'

    return {
      span: { start: this.abs(start), end: this.abs(this.pos) },
      raw,
      line,
      arrowEnd: dec(endDec),
      arrowStart: startDec ? (startDec === '<' ? 'arrow' : dec(startDec)) : 'open',
      label,
      labelSpan,
    }
  }
}

export function parseFlowStatement(line: LineInfo): FlowStmt {
  const t = line.text.trim()
  const lineIndex = line.index

  if (t === 'end') return { kind: 'end', lineIndex, ids: [], idsSpan: null }

  const dirM = /^direction\s+(TB|TD|BT|RL|LR)\s*;?\s*$/.exec(t)
  if (dirM) return { kind: 'direction', lineIndex, ids: [dirM[1]], idsSpan: null }

  const sgM = /^subgraph\s+(.*)$/.exec(t)
  if (sgM) {
    const p = new LineParser(line)
    p.pos = line.text.indexOf('subgraph') + 'subgraph'.length
    p.skipWs()
    const idStart = p.pos
    while (p.pos < p.end && /[^\s[]/.test(line.text[p.pos])) p.pos++
    const id = line.text.slice(idStart, p.pos)
    let title: string | null = null
    let titleSpan: Span | null = null
    p.skipWs()
    if (line.text[p.pos] === '[') {
      const close = line.text.lastIndexOf(']')
      if (close > p.pos) {
        let s = p.pos + 1
        let e = close
        if (line.text[s] === '"' && line.text[e - 1] === '"') {
          s++
          e--
        }
        title = line.text.slice(s, e)
        titleSpan = { start: line.start + s, end: line.start + e }
      }
    }
    return { kind: 'subgraphOpen', lineIndex, id, title, titleSpan }
  }

  if (/^classDef\b/.test(t)) return { kind: 'classDef', lineIndex, ids: [], idsSpan: null }
  if (/^linkStyle\b/.test(t)) return { kind: 'linkStyle', lineIndex, ids: [], idsSpan: null }

  const classM = /^class\s+([A-Za-z0-9_.,\s]+?)\s+([A-Za-z0-9_-]+)\s*;?\s*$/.exec(t)
  if (classM) {
    const ids = classM[1].split(',').map((s) => s.trim()).filter(Boolean)
    const listStart = line.text.indexOf(classM[1])
    return {
      kind: 'classAssign',
      lineIndex,
      ids,
      idsSpan: { start: line.start + listStart, end: line.start + listStart + classM[1].length },
    }
  }

  const styleM = /^style\s+([A-Za-z0-9_.]+)\b/.exec(t)
  if (styleM) return { kind: 'style', lineIndex, ids: [styleM[1]], idsSpan: null }

  const clickM = /^click\s+([A-Za-z0-9_.]+)\b/.exec(t)
  if (clickM) return { kind: 'click', lineIndex, ids: [clickM[1]], idsSpan: null }

  // chain (nodes and edges)
  const p = new LineParser(line)
  const groups: NodeRef[][] = []
  const edges: EdgeSeg[] = []
  const first = p.parseGroup()
  if (first) {
    groups.push(first)
    let ok = true
    while (true) {
      p.skipWs()
      if (p.atEnd()) break
      const edge = p.parseEdge()
      if (!edge) {
        ok = false
        break
      }
      p.skipWs()
      const g = p.parseGroup()
      if (!g) {
        ok = false
        break
      }
      edges.push(edge)
      groups.push(g)
    }
    if (ok) return { kind: 'chain', lineIndex, groups, edges }
  }

  return { kind: 'unknown', lineIndex, ids: [], idsSpan: null }
}

/** Parse the flowchart header, returning direction info. */
export function parseFlowHeader(line: LineInfo): { keyword: string; direction: string | null; directionSpan: Span | null } {
  const m = /^(\s*)(flowchart|graph)(\s+)?(TB|TD|BT|RL|LR)?/.exec(line.text)
  if (!m) return { keyword: 'flowchart', direction: null, directionSpan: null }
  const keyword = m[2]
  const direction = m[4] ?? null
  let directionSpan: Span | null = null
  if (direction) {
    const dirStart = line.start + m[1].length + keyword.length + (m[3]?.length ?? 0)
    directionSpan = { start: dirStart, end: dirStart + direction.length }
  }
  return { keyword, direction, directionSpan }
}

export { DIRECTIONS }
