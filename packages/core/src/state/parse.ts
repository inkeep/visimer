import type { LineInfo, Span } from '../types'

export interface StTransitionStmt {
  kind: 'transition'
  lineIndex: number
  /** `[*]` allowed on either side */
  source: string
  sourceSpan: Span
  target: string
  targetSpan: Span
  label: string | null
  /** span of the label text after `:` */
  labelSpan: Span | null
}

export interface StDeclStmt {
  kind: 'decl'
  lineIndex: number
  id: string
  idSpan: Span
  /** display description, if declared */
  label: string | null
  labelSpan: Span | null
  /** `state "x" as id` | `state id` | `id: x` */
  form: 'quoted' | 'state' | 'desc'
  opensBlock: boolean
  stereotype: string | null
}

export interface StSimpleStmt {
  kind:
    | 'blockClose'
    | 'direction'
    | 'divider'
    | 'note'
    | 'noteBlockOpen'
    | 'noteBlockEnd'
    | 'classDef'
    | 'classAssign'
    | 'style'
    | 'unknown'
  lineIndex: number
  parts: string[]
}

export type StStmt = StTransitionStmt | StDeclStmt | StSimpleStmt

const ID = String.raw`(?:\[\*\]|[\w-]+)`
const TRANSITION_RE = new RegExp(String.raw`^(${ID})\s*-->\s*(${ID})\s*(?::(.*))?$`)
const QUOTED_DECL_RE = /^state\s+"([^"]*)"\s+as\s+([\w-]+)\s*(\{)?\s*$/
const STATE_DECL_RE = /^state\s+([\w-]+)\s*(<<\w+>>)?\s*(\{)?\s*$/
const DESC_DECL_RE = /^([\w-]+)\s*:\s*(.*)$/
const NOTE_LINE_RE = /^note\s+(left|right)\s+of\s+[\w-]+\s*:/i
const NOTE_BLOCK_RE = /^note\s+(left|right)\s+of\s+[\w-]+\s*$/i

function span(line: LineInfo, relStart: number, relEnd: number): Span {
  return { start: line.start + relStart, end: line.start + relEnd }
}

export function parseStateStatement(line: LineInfo): StStmt {
  const raw = line.text
  const t = raw.trim()
  const lineIndex = line.index
  const indent = raw.length - raw.trimStart().length

  if (t === '}') return { kind: 'blockClose', lineIndex, parts: [] }
  if (t === '--') return { kind: 'divider', lineIndex, parts: [] }
  const dir = /^direction\s+(TB|TD|BT|RL|LR)\s*$/.exec(t)
  if (dir) return { kind: 'direction', lineIndex, parts: [dir[1]] }
  if (/^end\s+note$/i.test(t)) return { kind: 'noteBlockEnd', lineIndex, parts: [] }
  if (NOTE_LINE_RE.test(t)) return { kind: 'note', lineIndex, parts: [] }
  if (NOTE_BLOCK_RE.test(t)) return { kind: 'noteBlockOpen', lineIndex, parts: [] }
  if (/^classDef\b/.test(t)) return { kind: 'classDef', lineIndex, parts: [] }
  if (/^style\b/.test(t)) return { kind: 'style', lineIndex, parts: [] }
  const cls = /^class\s+([\w-,\s]+)\s+([\w-]+)\s*$/.exec(t)
  if (cls) return { kind: 'classAssign', lineIndex, parts: cls[1].split(',').map((s) => s.trim()) }

  const trans = TRANSITION_RE.exec(t)
  if (trans) {
    const [, source, target, labelRaw] = trans
    const srcStart = indent + t.indexOf(source)
    const arrowStart = raw.indexOf('-->', srcStart + source.length)
    const tgtStart = raw.indexOf(target, arrowStart + 3)
    let label: string | null = null
    let labelSpan: Span | null = null
    if (labelRaw !== undefined) {
      const colon = raw.indexOf(':', tgtStart + target.length)
      label = raw.slice(colon + 1).trim()
      labelSpan = span(line, colon + 1, raw.length)
    }
    return {
      kind: 'transition',
      lineIndex,
      source,
      sourceSpan: span(line, srcStart, srcStart + source.length),
      target,
      targetSpan: span(line, tgtStart, tgtStart + target.length),
      label,
      labelSpan,
    }
  }

  const quoted = QUOTED_DECL_RE.exec(t)
  if (quoted) {
    const label = quoted[1]
    const id = quoted[2]
    const labelStart = raw.indexOf('"') + 1
    const idStart = raw.indexOf(id, labelStart + label.length + 1)
    return {
      kind: 'decl',
      lineIndex,
      id,
      idSpan: span(line, idStart, idStart + id.length),
      label,
      labelSpan: span(line, labelStart, labelStart + label.length),
      form: 'quoted',
      opensBlock: !!quoted[3],
      stereotype: null,
    }
  }

  const stateDecl = STATE_DECL_RE.exec(t)
  if (stateDecl) {
    const id = stateDecl[1]
    const idStart = raw.indexOf(id, indent + 5)
    return {
      kind: 'decl',
      lineIndex,
      id,
      idSpan: span(line, idStart, idStart + id.length),
      label: null,
      labelSpan: null,
      form: 'state',
      opensBlock: !!stateDecl[3],
      stereotype: stateDecl[2] ?? null,
    }
  }

  const desc = DESC_DECL_RE.exec(t)
  if (desc) {
    const id = desc[1]
    const idStart = indent
    const colon = raw.indexOf(':', idStart + id.length)
    return {
      kind: 'decl',
      lineIndex,
      id,
      idSpan: span(line, idStart, idStart + id.length),
      label: desc[2].trim(),
      labelSpan: span(line, colon + 1, raw.length),
      form: 'desc',
      opensBlock: false,
      stereotype: null,
    }
  }

  return { kind: 'unknown', lineIndex, parts: [] }
}
