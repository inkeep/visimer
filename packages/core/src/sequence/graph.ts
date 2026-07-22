import type { LineInfo, Span } from '../types'
import {
  parseSequenceStatement,
  type ParticipantType,
  type SeqMessageStmt,
  type SeqNoteStmt,
  type SeqParticipantStmt,
  type SeqStmt,
} from './parse'

export interface SeqParticipant {
  /** entity id: `participant:<id>` */
  entityId: string
  id: string
  /** display label (alias if declared) */
  label: string
  ptype: ParticipantType
  /** declaration statement, if explicitly declared */
  decl: SeqParticipantStmt | null
  /** left-to-right order as mermaid will render it (first mention) */
  order: number
}

export type SeqEvent =
  | { kind: 'message'; entityId: string; lineIndex: number; stmt: SeqMessageStmt }
  | { kind: 'note'; entityId: string; lineIndex: number; stmt: SeqNoteStmt }

export interface SequenceGraph {
  headerLine: number
  participants: SeqParticipant[]
  participantById: Map<string, SeqParticipant>
  /** messages and notes, in document order (== render order) */
  events: SeqEvent[]
  autonumber: { enabled: boolean; lineIndex: number | null }
  statements: Map<number, SeqStmt>
  lastContentLine: number
  /** line index of the last participant/actor declaration (for insertion), or headerLine */
  lastDeclLine: number
}

export function buildSequenceGraph(lines: LineInfo[], headerIndex: number): SequenceGraph {
  const participants = new Map<string, SeqParticipant>()
  const events: SeqEvent[] = []
  const statements = new Map<number, SeqStmt>()
  let autonumber: SequenceGraph['autonumber'] = { enabled: false, lineIndex: null }
  let lastContentLine = headerIndex
  let lastDeclLine = headerIndex

  const touch = (id: string): SeqParticipant => {
    let p = participants.get(id)
    if (!p) {
      p = {
        entityId: `participant:${id}`,
        id,
        label: id,
        ptype: 'participant',
        decl: null,
        order: participants.size,
      }
      participants.set(id, p)
    }
    return p
  }

  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    const stmt = parseSequenceStatement(line)
    statements.set(line.index, stmt)
    lastContentLine = line.index

    switch (stmt.kind) {
      case 'participant': {
        const p = touch(stmt.id)
        p.decl = stmt
        p.ptype = stmt.ptype
        if (stmt.alias) p.label = stmt.alias
        lastDeclLine = stmt.lineIndex
        break
      }
      case 'message': {
        touch(stmt.source)
        touch(stmt.target)
        events.push({ kind: 'message', entityId: `event:${stmt.lineIndex}`, lineIndex: stmt.lineIndex, stmt })
        break
      }
      case 'note': {
        for (const t of stmt.targets) touch(t)
        events.push({ kind: 'note', entityId: `event:${stmt.lineIndex}`, lineIndex: stmt.lineIndex, stmt })
        break
      }
      case 'autonumber':
        autonumber = { enabled: true, lineIndex: stmt.lineIndex }
        break
      default:
        break
    }
  }

  return {
    headerLine: headerIndex,
    participants: [...participants.values()],
    participantById: participants,
    events,
    autonumber,
    statements,
    lastContentLine,
    lastDeclLine,
  }
}

/** Spans belonging to an entity, for code highlighting. */
export function sequenceEntitySpans(graph: SequenceGraph, lines: LineInfo[], entityId: string): Span[] {
  if (entityId.startsWith('participant:')) {
    const p = graph.participantById.get(entityId.slice(12))
    if (!p) return []
    const spans: Span[] = []
    if (p.decl) {
      const line = lines[p.decl.lineIndex]
      spans.push({ start: line.start + line.indent.length, end: line.end })
    }
    for (const ev of graph.events) {
      if (ev.kind === 'message') {
        if (ev.stmt.source === p.id) spans.push(ev.stmt.sourceSpan)
        if (ev.stmt.target === p.id) spans.push(ev.stmt.targetSpan)
      } else if (ev.stmt.targets.includes(p.id)) {
        spans.push(ev.stmt.targetsSpan)
      }
    }
    return spans
  }
  if (entityId.startsWith('event:')) {
    const ev = graph.events.find((e) => e.entityId === entityId)
    if (!ev) return []
    const line = lines[ev.lineIndex]
    return [{ start: line.start + line.indent.length, end: line.end }]
  }
  return []
}

export function sequenceEntityAt(graph: SequenceGraph, lines: LineInfo[], offset: number): string | null {
  for (const ev of graph.events) {
    const line = lines[ev.lineIndex]
    if (offset >= line.start && offset <= line.end) {
      if (ev.kind === 'message') {
        if (offset >= ev.stmt.sourceSpan.start && offset <= ev.stmt.sourceSpan.end) {
          return `participant:${ev.stmt.source}`
        }
        if (offset >= ev.stmt.targetSpan.start && offset <= ev.stmt.targetSpan.end) {
          return `participant:${ev.stmt.target}`
        }
      }
      return ev.entityId
    }
  }
  for (const p of graph.participants) {
    if (p.decl) {
      const line = lines[p.decl.lineIndex]
      if (offset >= line.start && offset <= line.end) return p.entityId
    }
  }
  return null
}
