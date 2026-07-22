import type { LineInfo, Span } from '../types'

/** All participant types supported by mermaid (v11.7+ for the extended set). */
export type ParticipantType =
  | 'participant'
  | 'actor'
  | 'boundary'
  | 'control'
  | 'entity'
  | 'database'
  | 'collections'
  | 'queue'

export const PARTICIPANT_TYPES: ParticipantType[] = [
  'participant',
  'actor',
  'boundary',
  'control',
  'entity',
  'database',
  'collections',
  'queue',
]

/** The eight mermaid sequence message operators. */
export type MessageOp = '->' | '-->' | '->>' | '-->>' | '-x' | '--x' | '-)' | '--)'

export const MESSAGE_OPS: Array<{ op: MessageOp; label: string }> = [
  { op: '->', label: 'solid line' },
  { op: '->>', label: 'solid arrow' },
  { op: '-->', label: 'dotted line' },
  { op: '-->>', label: 'dotted arrow' },
  { op: '-x', label: 'solid cross' },
  { op: '--x', label: 'dotted cross' },
  { op: '-)', label: 'solid async' },
  { op: '--)', label: 'dotted async' },
]

export type NotePlacement = 'over' | 'left of' | 'right of'

export interface SeqParticipantStmt {
  kind: 'participant'
  lineIndex: number
  keyword: 'participant' | 'actor'
  keywordSpan: Span
  id: string
  idSpan: Span
  alias: string | null
  aliasSpan: Span | null
  /** raw `@{ ... }` blob, if present */
  attrsRaw: string | null
  attrsSpan: Span | null
  ptype: ParticipantType
}

export interface SeqMessageStmt {
  kind: 'message'
  lineIndex: number
  source: string
  sourceSpan: Span
  op: MessageOp
  opSpan: Span
  /** `+` / `-` activation shorthand after the operator */
  activation: string | null
  target: string
  targetSpan: Span
  text: string
  textSpan: Span
}

export interface SeqNoteStmt {
  kind: 'note'
  lineIndex: number
  placement: NotePlacement
  targets: string[]
  targetsSpan: Span
  text: string
  textSpan: Span
}

export interface SeqSimpleStmt {
  kind: 'autonumber' | 'blockOpen' | 'blockMid' | 'end' | 'activation' | 'other' | 'unknown'
  lineIndex: number
  /** for 'activation': [keyword, id]; for blocks: [keyword] */
  parts: string[]
}

export type SeqStmt = SeqParticipantStmt | SeqMessageStmt | SeqNoteStmt | SeqSimpleStmt

const MESSAGE_RE = /^(.+?)(--?(?:>>|>|[x)]))([+-])?([^:+-][^:]*):(.*)$/
const PARTICIPANT_RE = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+?))?\s*(@\{.*\})?\s*;?\s*$/
const NOTE_RE = /^[Nn]ote\s+(over|left of|right of)\s+([^:]+):(.*)$/
const BLOCK_OPEN_RE = /^(alt|opt|loop|par|critical|break|rect|box)\b/
const BLOCK_MID_RE = /^(else|and|option)\b/
const ACTIVATION_RE = /^(activate|deactivate)\s+(.+?)\s*;?\s*$/
const OTHER_RE = /^(title|accTitle|accDescr|links?|properties|create|destroy)\b/

function span(line: LineInfo, relStart: number, relEnd: number): Span {
  return { start: line.start + relStart, end: line.start + relEnd }
}

function typeFromAttrs(attrsRaw: string | null): ParticipantType | null {
  if (!attrsRaw) return null
  const m = /["']?type["']?\s*:\s*["'](\w+)["']/.exec(attrsRaw)
  if (m && (PARTICIPANT_TYPES as string[]).includes(m[1])) return m[1] as ParticipantType
  return null
}

export function parseSequenceStatement(line: LineInfo): SeqStmt {
  const raw = line.text
  const t = raw.trim()
  const lineIndex = line.index
  const indentLen = raw.length - raw.trimStart().length

  if (t === 'end') return { kind: 'end', lineIndex, parts: [] }
  if (/^autonumber\b/.test(t)) return { kind: 'autonumber', lineIndex, parts: [] }

  const block = BLOCK_OPEN_RE.exec(t)
  if (block) return { kind: 'blockOpen', lineIndex, parts: [block[1]] }
  const mid = BLOCK_MID_RE.exec(t)
  if (mid) return { kind: 'blockMid', lineIndex, parts: [mid[1]] }

  const act = ACTIVATION_RE.exec(t)
  if (act) return { kind: 'activation', lineIndex, parts: [act[1], act[2]] }

  const part = PARTICIPANT_RE.exec(t)
  if (part) {
    const keyword = part[1] as 'participant' | 'actor'
    const id = part[2]
    const alias = part[3] ?? null
    const attrsRaw = part[4] ?? null
    const kwStart = indentLen
    const idStart = raw.indexOf(id, kwStart + keyword.length)
    const aliasStart = alias ? raw.indexOf(alias, idStart + id.length) : -1
    const attrsStart = attrsRaw ? raw.indexOf(attrsRaw, aliasStart === -1 ? idStart + id.length : aliasStart) : -1
    return {
      kind: 'participant',
      lineIndex,
      keyword,
      keywordSpan: span(line, kwStart, kwStart + keyword.length),
      id,
      idSpan: span(line, idStart, idStart + id.length),
      alias,
      aliasSpan: alias ? span(line, aliasStart, aliasStart + alias.length) : null,
      attrsRaw,
      attrsSpan: attrsRaw ? span(line, attrsStart, attrsStart + attrsRaw.length) : null,
      ptype: typeFromAttrs(attrsRaw) ?? (keyword === 'actor' ? 'actor' : 'participant'),
    }
  }

  const note = NOTE_RE.exec(t)
  if (note) {
    const placement = note[1] as NotePlacement
    const targetsRaw = note[2]
    const targetsStart = indentLen + t.indexOf(targetsRaw, 5)
    const colon = raw.indexOf(':', targetsStart + targetsRaw.length - 1)
    const textStart = colon + 1
    return {
      kind: 'note',
      lineIndex,
      placement,
      targets: targetsRaw.split(',').map((s) => s.trim()).filter(Boolean),
      targetsSpan: span(line, targetsStart, targetsStart + targetsRaw.trimEnd().length),
      text: raw.slice(textStart).trim(),
      textSpan: span(line, textStart, raw.length),
    }
  }

  const msg = MESSAGE_RE.exec(t)
  if (msg) {
    const [, srcRaw, op, activation, tgtRaw] = msg
    const source = srcRaw.trim()
    const target = tgtRaw.trim()
    if (source && target) {
      const srcStart = indentLen + srcRaw.indexOf(source)
      const opStart = indentLen + srcRaw.length
      const tgtRel = indentLen + srcRaw.length + op.length + (activation ? 1 : 0)
      const tgtStart = tgtRel + tgtRaw.indexOf(target)
      const colon = raw.indexOf(':', tgtStart + target.length)
      return {
        kind: 'message',
        lineIndex,
        source,
        sourceSpan: span(line, srcStart, srcStart + source.length),
        op: op as MessageOp,
        opSpan: span(line, opStart, opStart + op.length),
        activation: activation ?? null,
        target,
        targetSpan: span(line, tgtStart, tgtStart + target.length),
        text: raw.slice(colon + 1).trim(),
        textSpan: span(line, colon + 1, raw.length),
      }
    }
  }

  if (OTHER_RE.test(t)) return { kind: 'other', lineIndex, parts: [] }
  return { kind: 'unknown', lineIndex, parts: [] }
}
