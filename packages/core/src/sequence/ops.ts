import type { LineInfo, TextEdit } from '../types'
import type { SequenceGraph, SeqEvent } from './graph'
import { type MessageOp, type NotePlacement, type ParticipantType } from './parse'

export type FragmentKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect'

const FRAGMENT_HEADERS: Record<FragmentKind, string> = {
  loop: 'loop Repeat',
  alt: 'alt Condition',
  opt: 'opt Optional',
  par: 'par Parallel',
  critical: 'critical Required',
  break: 'break Break',
  rect: 'rect rgb(107, 114, 148, 0.25)',
}

export type SequenceOp =
  | { type: 'seq.addParticipant'; ptype?: ParticipantType; name?: string }
  | { type: 'seq.renameParticipant'; id: string; name: string }
  | { type: 'seq.setParticipantType'; id: string; ptype: ParticipantType }
  | { type: 'seq.deleteParticipant'; id: string }
  | {
      type: 'seq.addMessage'
      source: string
      target: string
      text?: string
      op?: MessageOp
      /** insert after this event (entity id); omit = append after last event */
      afterEvent?: string | null
    }
  | { type: 'seq.addNote'; participant: string; placement: NotePlacement; text?: string; afterEvent?: string | null }
  | { type: 'seq.setMessageOp'; eventId: string; op: MessageOp }
  | { type: 'seq.reverseMessage'; eventId: string }
  | { type: 'seq.setEventText'; eventId: string; text: string }
  | { type: 'seq.deleteEvent'; eventId: string }
  | { type: 'seq.moveEvent'; eventId: string; afterEvent: string | null }
  | { type: 'seq.wrapInFragment'; eventId: string; kind: FragmentKind }
  | { type: 'seq.toggleAutonumber' }

export interface SeqOpContext {
  code: string
  lines: LineInfo[]
  graph: SequenceGraph
}

export interface SeqOpResult {
  edits: TextEdit[]
  created?: string[]
}

function findEvent(graph: SequenceGraph, eventId: string): SeqEvent | null {
  return graph.events.find((e) => e.entityId === eventId) ?? null
}

function bodyIndent(ctx: SeqOpContext): string {
  for (const line of ctx.lines) {
    if (line.kind === 'statement' && line.index !== ctx.graph.headerLine && line.text.trim() !== '') {
      return line.indent
    }
  }
  return '  '
}

function insertAfterLine(ctx: SeqOpContext, lineIndex: number, texts: string[]): TextEdit {
  const line = ctx.lines[lineIndex]
  return { start: line.end, end: line.end, text: texts.map((t) => `\n${t}`).join('') }
}

function deleteLine(ctx: SeqOpContext, lineIndex: number): TextEdit {
  const line = ctx.lines[lineIndex]
  if (line.end < ctx.code.length) return { start: line.start, end: line.end + 1, text: '' }
  if (line.start > 0) return { start: line.start - 1, end: line.end, text: '' }
  return { start: line.start, end: line.end, text: '' }
}

/** Line to insert an event after, honoring `afterEvent` (null/undefined = append). */
function eventAnchor(ctx: SeqOpContext, afterEvent: string | null | undefined): { lineIndex: number; indent: string } {
  const { graph } = ctx
  if (afterEvent) {
    const ev = findEvent(graph, afterEvent)
    if (ev) return { lineIndex: ev.lineIndex, indent: ctx.lines[ev.lineIndex].indent }
  }
  if (afterEvent === null && graph.events.length > 0) {
    // insert before the FIRST event
    const first = graph.events[0]
    return { lineIndex: first.lineIndex - 1, indent: ctx.lines[first.lineIndex].indent }
  }
  const last = graph.events[graph.events.length - 1]
  if (last) return { lineIndex: last.lineIndex, indent: ctx.lines[last.lineIndex].indent }
  return { lineIndex: graph.lastContentLine, indent: bodyIndent(ctx) }
}

function attrsForType(ptype: ParticipantType): { keyword: 'participant' | 'actor'; attrs: string | null } {
  if (ptype === 'actor') return { keyword: 'actor', attrs: null }
  if (ptype === 'participant') return { keyword: 'participant', attrs: null }
  return { keyword: 'participant', attrs: `@{ "type" : "${ptype}" }` }
}

function generateParticipantName(graph: SequenceGraph, preferred?: string): string {
  const existing = new Set(graph.participants.map((p) => p.id))
  if (preferred && !existing.has(preferred)) return preferred
  let i = 1
  while (existing.has(`P${i}`)) i++
  return `P${i}`
}

export function compileSequenceOp(ctx: SeqOpContext, op: SequenceOp): SeqOpResult | null {
  const { graph, lines } = ctx

  switch (op.type) {
    case 'seq.addParticipant': {
      const name = generateParticipantName(graph, op.name)
      const { keyword, attrs } = attrsForType(op.ptype ?? 'participant')
      const text = `${bodyIndent(ctx)}${keyword} ${name}${attrs ? attrs : ''}`
      return {
        edits: [insertAfterLine(ctx, graph.lastDeclLine, [text])],
        created: [`participant:${name}`],
      }
    }

    case 'seq.renameParticipant': {
      const p = graph.participantById.get(op.id)
      if (!p) return null
      const name = op.name.trim().replace(/[:;]/g, '')
      if (!name) return null
      if (p.decl?.alias && p.decl.aliasSpan) {
        return { edits: [{ start: p.decl.aliasSpan.start, end: p.decl.aliasSpan.end, text: name }] }
      }
      // rewrite the id at every reference site
      const edits: TextEdit[] = []
      if (p.decl) edits.push({ start: p.decl.idSpan.start, end: p.decl.idSpan.end, text: name })
      for (const ev of graph.events) {
        if (ev.kind === 'message') {
          if (ev.stmt.source === op.id) edits.push({ ...ev.stmt.sourceSpan, text: name } as TextEdit)
          if (ev.stmt.target === op.id) edits.push({ ...ev.stmt.targetSpan, text: name } as TextEdit)
        } else if (ev.stmt.targets.includes(op.id)) {
          const newList = ev.stmt.targets.map((t) => (t === op.id ? name : t)).join(',')
          edits.push({ start: ev.stmt.targetsSpan.start, end: ev.stmt.targetsSpan.end, text: newList })
        }
      }
      for (const [lineIndex, stmt] of graph.statements) {
        if (stmt.kind === 'activation' && stmt.parts[1] === op.id) {
          const line = lines[lineIndex]
          const idStart = line.start + line.text.lastIndexOf(stmt.parts[1])
          edits.push({ start: idStart, end: idStart + stmt.parts[1].length, text: name })
        }
      }
      return { edits: edits.map((e) => ({ start: e.start, end: e.end, text: e.text })) }
    }

    case 'seq.setParticipantType': {
      const p = graph.participantById.get(op.id)
      if (!p) return null
      const { keyword, attrs } = attrsForType(op.ptype)
      if (p.decl) {
        const edits: TextEdit[] = [
          { start: p.decl.keywordSpan.start, end: p.decl.keywordSpan.end, text: keyword },
        ]
        if (p.decl.attrsSpan) {
          // replace or remove existing @{...} (including the space before it)
          const start = p.decl.attrsSpan.start
          const prevChar = ctx.code[start - 1]
          const removeFrom = prevChar === ' ' && !attrs ? start - 1 : start
          edits.push({ start: removeFrom, end: p.decl.attrsSpan.end, text: attrs ? attrs : '' })
        } else if (attrs) {
          const at = p.decl.aliasSpan ? p.decl.aliasSpan.end : p.decl.idSpan.end
          edits.push({ start: at, end: at, text: attrs })
        }
        return { edits }
      }
      // implicit participant: create a declaration after the last decl / header
      const text = `${bodyIndent(ctx)}${keyword} ${op.id}${attrs ? attrs : ''}`
      return { edits: [insertAfterLine(ctx, graph.lastDeclLine, [text])] }
    }

    case 'seq.deleteParticipant': {
      const p = graph.participantById.get(op.id)
      if (!p) return null
      const doomed = new Set<number>()
      if (p.decl) doomed.add(p.decl.lineIndex)
      const edits: TextEdit[] = []
      for (const ev of graph.events) {
        if (ev.kind === 'message') {
          if (ev.stmt.source === op.id || ev.stmt.target === op.id) doomed.add(ev.lineIndex)
        } else if (ev.stmt.targets.includes(op.id)) {
          if (ev.stmt.targets.length === 1) {
            doomed.add(ev.lineIndex)
          } else {
            const newList = ev.stmt.targets.filter((t) => t !== op.id).join(',')
            edits.push({ start: ev.stmt.targetsSpan.start, end: ev.stmt.targetsSpan.end, text: newList })
          }
        }
      }
      for (const [lineIndex, stmt] of graph.statements) {
        if (stmt.kind === 'activation' && stmt.parts[1] === op.id) doomed.add(lineIndex)
      }
      for (const lineIndex of doomed) edits.push(deleteLine(ctx, lineIndex))
      return { edits }
    }

    case 'seq.addMessage': {
      const anchor = eventAnchor(ctx, op.afterEvent)
      const text = `${anchor.indent}${op.source}${op.op ?? '->>'}${op.target}: ${op.text ?? 'message'}`
      const newLineIndex = anchor.lineIndex + 1
      return {
        edits: [insertAfterLine(ctx, anchor.lineIndex, [text])],
        created: [`event:${newLineIndex}`],
      }
    }

    case 'seq.addNote': {
      const anchor = eventAnchor(ctx, op.afterEvent)
      const text = `${anchor.indent}Note ${op.placement} ${op.participant}: ${op.text ?? 'note'}`
      return {
        edits: [insertAfterLine(ctx, anchor.lineIndex, [text])],
        created: [`event:${anchor.lineIndex + 1}`],
      }
    }

    case 'seq.setMessageOp': {
      const ev = findEvent(graph, op.eventId)
      if (!ev || ev.kind !== 'message') return null
      return { edits: [{ start: ev.stmt.opSpan.start, end: ev.stmt.opSpan.end, text: op.op }] }
    }

    case 'seq.reverseMessage': {
      const ev = findEvent(graph, op.eventId)
      if (!ev || ev.kind !== 'message') return null
      return {
        edits: [
          { start: ev.stmt.sourceSpan.start, end: ev.stmt.sourceSpan.end, text: ev.stmt.target },
          { start: ev.stmt.targetSpan.start, end: ev.stmt.targetSpan.end, text: ev.stmt.source },
        ],
      }
    }

    case 'seq.setEventText': {
      const ev = findEvent(graph, op.eventId)
      if (!ev) return null
      const text = ` ${op.text.trim().replace(/[;]/g, '')}`
      const span = ev.kind === 'message' ? ev.stmt.textSpan : ev.stmt.textSpan
      return { edits: [{ start: span.start, end: span.end, text }] }
    }

    case 'seq.deleteEvent': {
      const ev = findEvent(graph, op.eventId)
      if (!ev) return null
      return { edits: [deleteLine(ctx, ev.lineIndex)] }
    }

    case 'seq.moveEvent': {
      const ev = findEvent(graph, op.eventId)
      if (!ev || op.afterEvent === op.eventId) return null
      const anchor = eventAnchor(ctx, op.afterEvent)
      // dropping right above/below its current position is a no-op
      if (anchor.lineIndex === ev.lineIndex || anchor.lineIndex === ev.lineIndex - 1) return { edits: [] }
      const line = ctx.lines[ev.lineIndex]
      const moved = `${anchor.indent}${line.text.trim()}`
      const newLineIndex = anchor.lineIndex < ev.lineIndex ? anchor.lineIndex + 1 : anchor.lineIndex
      return {
        edits: [deleteLine(ctx, ev.lineIndex), insertAfterLine(ctx, anchor.lineIndex, [moved])],
        created: [`event:${newLineIndex}`],
      }
    }

    case 'seq.wrapInFragment': {
      const ev = findEvent(graph, op.eventId)
      if (!ev) return null
      const line = lines[ev.lineIndex]
      const indent = line.indent
      const body = line.text.trim()
      const text = `${indent}${FRAGMENT_HEADERS[op.kind]}\n${indent}  ${body}\n${indent}end`
      return {
        edits: [{ start: line.start, end: line.end, text }],
        created: [`event:${ev.lineIndex + 1}`],
      }
    }

    case 'seq.toggleAutonumber': {
      if (graph.autonumber.enabled && graph.autonumber.lineIndex !== null) {
        return { edits: [deleteLine(ctx, graph.autonumber.lineIndex)] }
      }
      return { edits: [insertAfterLine(ctx, graph.headerLine, [`${bodyIndent(ctx)}autonumber`])] }
    }
  }
}
