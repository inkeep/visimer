import type { LineInfo, Span } from '../types'

/** left-side cardinality glyphs → meaning */
export const ER_CARDS_LEFT = ['|o', '||', '}o', '}|'] as const
export const ER_CARDS_RIGHT = ['o|', '||', 'o{', '|{'] as const

export interface ErRelationStmt {
  kind: 'relation'
  lineIndex: number
  source: string
  sourceSpan: Span
  target: string
  targetSpan: Span
  leftCard: string
  leftCardSpan: Span
  rightCard: string
  rightCardSpan: Span
  /** '--' identifying, '..' non-identifying */
  line: '--' | '..'
  lineSpan: Span
  label: string
  labelSpan: Span
}

export interface ErEntityDeclStmt {
  kind: 'entityDecl'
  lineIndex: number
  id: string
  idSpan: Span
  alias: string | null
  opensBlock: boolean
}

export interface ErAttributeStmt {
  kind: 'attribute'
  lineIndex: number
  text: string
  textSpan: Span
}

export interface ErSimpleStmt {
  kind: 'blockClose' | 'passthrough' | 'unknown'
  lineIndex: number
  parts: string[]
}

export type ErStmt = ErRelationStmt | ErEntityDeclStmt | ErAttributeStmt | ErSimpleStmt

const ID = String.raw`[\w-]+`
const RELATION_RE = new RegExp(
  String.raw`^(${ID})\s*([|}o]{2})(--|\.\.)([o|{]{2})\s*(${ID})\s*:\s*(.*)$`,
)
const DECL_RE = new RegExp(String.raw`^(${ID})(\[[^\]]*\])?\s*(\{)?\s*$`)

function span(line: LineInfo, relStart: number, relEnd: number): Span {
  return { start: line.start + relStart, end: line.start + relEnd }
}

export function parseErStatement(line: LineInfo, inBlock: boolean): ErStmt {
  const raw = line.text
  const t = raw.trim()
  const lineIndex = line.index
  const indent = raw.length - raw.trimStart().length

  if (t === '}') return { kind: 'blockClose', lineIndex, parts: [] }
  if (inBlock) {
    return { kind: 'attribute', lineIndex, text: t, textSpan: span(line, indent, raw.length) }
  }
  if (/^(direction|style|classDef|class)\b/.test(t)) return { kind: 'passthrough', lineIndex, parts: [] }

  const rel = RELATION_RE.exec(t)
  if (rel) {
    const [, source, leftCard, lineStyle, rightCard, target] = rel
    const srcStart = indent
    const leftStart = raw.indexOf(leftCard, srcStart + source.length)
    const lineStart = leftStart + leftCard.length
    const rightStart = lineStart + lineStyle.length
    const tgtStart = raw.indexOf(target, rightStart + rightCard.length)
    const colon = raw.indexOf(':', tgtStart + target.length)
    return {
      kind: 'relation',
      lineIndex,
      source,
      sourceSpan: span(line, srcStart, srcStart + source.length),
      target,
      targetSpan: span(line, tgtStart, tgtStart + target.length),
      leftCard,
      leftCardSpan: span(line, leftStart, leftStart + leftCard.length),
      rightCard,
      rightCardSpan: span(line, rightStart, rightStart + rightCard.length),
      line: lineStyle as '--' | '..',
      lineSpan: span(line, lineStart, lineStart + lineStyle.length),
      label: raw.slice(colon + 1).trim(),
      labelSpan: span(line, colon + 1, raw.length),
    }
  }

  const decl = DECL_RE.exec(t)
  if (decl) {
    return {
      kind: 'entityDecl',
      lineIndex,
      id: decl[1],
      idSpan: span(line, indent, indent + decl[1].length),
      alias: decl[2] ? decl[2].slice(1, -1) : null,
      opensBlock: !!decl[3],
    }
  }

  return { kind: 'unknown', lineIndex, parts: [] }
}
