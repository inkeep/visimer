import type { LineInfo, Span } from '../types'

/** mermaid class relation operators, longest-first for unambiguous matching */
export const RELATION_OPS = [
  '<|--',
  '--|>',
  '<|..',
  '..|>',
  '*--',
  '--*',
  'o--',
  '--o',
  '<--',
  '-->',
  '<..',
  '..>',
  '--',
  '..',
] as const

export type RelationOp = (typeof RELATION_OPS)[number]

export interface ClRelationStmt {
  kind: 'relation'
  lineIndex: number
  source: string
  sourceSpan: Span
  target: string
  targetSpan: Span
  op: RelationOp
  opSpan: Span
  label: string | null
  labelSpan: Span | null
  /** `"1"`-style cardinality strings; spans cover the inner text */
  sourceCard: string | null
  sourceCardSpan: Span | null
  targetCard: string | null
  targetCardSpan: Span | null
}

export interface ClClassDeclStmt {
  kind: 'classDecl'
  lineIndex: number
  id: string
  idSpan: Span
  /** `class A["Label"]` display label */
  label: string | null
  labelSpan: Span | null
  opensBlock: boolean
}

export interface ClMemberStmt {
  kind: 'member'
  lineIndex: number
  /** `A : +int age` one-liner form; null when inside a class block */
  classId: string | null
  text: string
  textSpan: Span
}

export interface ClSimpleStmt {
  kind: 'blockClose' | 'annotation' | 'note' | 'direction' | 'passthrough' | 'unknown'
  lineIndex: number
  parts: string[]
}

export type ClStmt = ClRelationStmt | ClClassDeclStmt | ClMemberStmt | ClSimpleStmt

const ID = String.raw`[\w.~]+`
const OP_ALT = RELATION_OPS.map((o) => o.replace(/[|*.]/g, (c) => `\\${c}`)).join('|')
const RELATION_RE = new RegExp(
  String.raw`^(${ID})\s*(?:"([^"]*)"\s*)?(${OP_ALT})\s*(?:"([^"]*)"\s*)?(${ID})\s*(?::\s*(.*))?$`,
)
const CLASS_DECL_RE = /^class\s+([\w.~]+)(?:\["([^"]*)"\])?\s*(\{)?\s*$/
const MEMBER_ONELINE_RE = /^([\w.~]+)\s*:\s*(.+)$/

function span(line: LineInfo, relStart: number, relEnd: number): Span {
  return { start: line.start + relStart, end: line.start + relEnd }
}

export function parseClassStatement(line: LineInfo, inBlockOf: string | null): ClStmt {
  const raw = line.text
  const t = raw.trim()
  const lineIndex = line.index
  const indent = raw.length - raw.trimStart().length

  if (inBlockOf !== null) {
    if (t === '}') return { kind: 'blockClose', lineIndex, parts: [] }
    // any other line inside a class block is a member (annotations included)
    if (/^<<\w+>>$/.test(t)) return { kind: 'annotation', lineIndex, parts: [t] }
    return { kind: 'member', lineIndex, classId: null, text: t, textSpan: span(line, indent, raw.length) }
  }

  if (t === '}') return { kind: 'blockClose', lineIndex, parts: [] }
  if (/^direction\s+(TB|TD|BT|RL|LR)\s*$/.test(t)) return { kind: 'direction', lineIndex, parts: [t.split(/\s+/)[1]] }
  if (/^note\b/i.test(t)) return { kind: 'note', lineIndex, parts: [] }
  if (/^(classDef|style|cssClass|click|callback|link|namespace)\b/.test(t)) {
    return { kind: 'passthrough', lineIndex, parts: [] }
  }
  const anno = /^<<(\w+)>>\s+([\w.~]+)$/.exec(t)
  if (anno) return { kind: 'annotation', lineIndex, parts: [anno[1], anno[2]] }

  const decl = CLASS_DECL_RE.exec(t)
  if (decl) {
    const id = decl[1]
    const idStart = raw.indexOf(id, indent + 5)
    let label: string | null = null
    let labelSpan: Span | null = null
    if (decl[2] !== undefined) {
      const lStart = raw.indexOf('"', idStart + id.length) + 1
      label = decl[2]
      labelSpan = span(line, lStart, lStart + decl[2].length)
    }
    return {
      kind: 'classDecl',
      lineIndex,
      id,
      idSpan: span(line, idStart, idStart + id.length),
      label,
      labelSpan,
      opensBlock: !!decl[3],
    }
  }

  const rel = RELATION_RE.exec(t)
  if (rel) {
    const [, source, srcCard, opRaw, tgtCard, target, labelRaw] = rel
    const srcStart = indent + t.indexOf(source)
    let sourceCardSpan: Span | null = null
    let searchFrom = srcStart + source.length
    if (srcCard !== undefined) {
      const q = raw.indexOf(`"${srcCard}"`, searchFrom)
      sourceCardSpan = span(line, q + 1, q + 1 + srcCard.length)
      searchFrom = q + srcCard.length + 2
    }
    const opStart = raw.indexOf(opRaw, searchFrom)
    let targetCardSpan: Span | null = null
    searchFrom = opStart + opRaw.length
    if (tgtCard !== undefined) {
      const q = raw.indexOf(`"${tgtCard}"`, searchFrom)
      targetCardSpan = span(line, q + 1, q + 1 + tgtCard.length)
      searchFrom = q + tgtCard.length + 2
    }
    const tgtStart = raw.indexOf(target, searchFrom)
    let label: string | null = null
    let labelSpan: Span | null = null
    if (labelRaw !== undefined) {
      const colon = raw.indexOf(':', tgtStart + target.length)
      label = raw.slice(colon + 1).trim()
      labelSpan = span(line, colon + 1, raw.length)
    }
    return {
      kind: 'relation',
      lineIndex,
      source,
      sourceSpan: span(line, srcStart, srcStart + source.length),
      target,
      targetSpan: span(line, tgtStart, tgtStart + target.length),
      op: opRaw as RelationOp,
      opSpan: span(line, opStart, opStart + opRaw.length),
      label,
      labelSpan,
      sourceCard: srcCard ?? null,
      sourceCardSpan,
      targetCard: tgtCard ?? null,
      targetCardSpan,
    }
  }

  const member = MEMBER_ONELINE_RE.exec(t)
  if (member) {
    const colon = raw.indexOf(':', indent + member[1].length)
    return {
      kind: 'member',
      lineIndex,
      classId: member[1],
      text: member[2].trim(),
      textSpan: span(line, colon + 1, raw.length),
    }
  }

  return { kind: 'unknown', lineIndex, parts: [] }
}
