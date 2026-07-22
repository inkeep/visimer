import type { LineInfo, Span } from '../types'
import { parseStateStatement, type StDeclStmt, type StStmt, type StTransitionStmt } from './parse'

export interface StState {
  /** entity id: `state:<id>` (the `[*]` pseudo-states are excluded) */
  entityId: string
  id: string
  label: string
  /** declaration that owns the label, if any */
  decl: StDeclStmt | null
  /** every declaration line for this state */
  declLines: number[]
  /** line indexes of transitions referencing this state */
  refLines: number[]
  /** first line referencing the state (for label insertion) */
  firstRefLine: number
  parent: string | null
  isComposite: boolean
  /** `<<choice>>` / `<<fork>>` / `<<join>>` stereotype, if declared */
  stereotype: string | null
  /** line of the `state X …` declaration carrying the stereotype, if any */
  typeDeclLine: number | null
}

export interface StTransition {
  /** entity id: `trans:<src>-><tgt>#<n>` */
  entityId: string
  source: string
  target: string
  lineIndex: number
  stmt: StTransitionStmt
  label: string | null
  /** document order (== mermaid render order) */
  order: number
}

export interface StateGraph {
  headerLine: number
  states: StState[]
  stateById: Map<string, StState>
  transitions: StTransition[]
  statements: Map<number, StStmt>
  direction: { value: string; lineIndex: number } | null
  lastContentLine: number
}

export function buildStateGraph(lines: LineInfo[], headerIndex: number): StateGraph {
  const states = new Map<string, StState>()
  const transitions: StTransition[] = []
  const statements = new Map<number, StStmt>()
  const blockStack: string[] = []
  const occurrence = new Map<string, number>()
  let direction: StateGraph['direction'] = null
  let lastContentLine = headerIndex
  let inNoteBlock = false

  const touch = (id: string, lineIndex: number): StState | null => {
    if (id === '[*]') return null
    let s = states.get(id)
    if (!s) {
      s = {
        entityId: `state:${id}`,
        id,
        label: id,
        decl: null,
        declLines: [],
        refLines: [],
        firstRefLine: lineIndex,
        parent: blockStack.length ? blockStack[blockStack.length - 1] : null,
        isComposite: false,
        stereotype: null,
        typeDeclLine: null,
      }
      states.set(id, s)
    }
    return s
  }

  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    if (inNoteBlock) {
      const maybeEnd = parseStateStatement(line)
      if (maybeEnd.kind === 'noteBlockEnd') inNoteBlock = false
      statements.set(line.index, { kind: 'unknown', lineIndex: line.index, parts: [] })
      lastContentLine = line.index
      continue
    }
    const stmt = parseStateStatement(line)
    statements.set(line.index, stmt)
    lastContentLine = line.index

    switch (stmt.kind) {
      case 'noteBlockOpen':
        inNoteBlock = true
        break
      case 'decl': {
        const s = touch(stmt.id, stmt.lineIndex)
        if (s) {
          s.declLines.push(stmt.lineIndex)
          if (stmt.label !== null) {
            s.decl = stmt
            s.label = stmt.label
          }
          if (stmt.form === 'state') {
            s.typeDeclLine = stmt.lineIndex
            if (stmt.stereotype) s.stereotype = stmt.stereotype.replace(/[<>]/g, '')
          }
          if (stmt.opensBlock) {
            s.isComposite = true
            blockStack.push(stmt.id)
          }
        }
        break
      }
      case 'blockClose':
        blockStack.pop()
        break
      case 'transition': {
        const src = touch(stmt.source, stmt.lineIndex)
        const tgt = touch(stmt.target, stmt.lineIndex)
        src?.refLines.push(stmt.lineIndex)
        tgt?.refLines.push(stmt.lineIndex)
        const key = `${stmt.source}->${stmt.target}`
        const occ = occurrence.get(key) ?? 0
        occurrence.set(key, occ + 1)
        transitions.push({
          entityId: `trans:${key}#${occ}`,
          source: stmt.source,
          target: stmt.target,
          lineIndex: stmt.lineIndex,
          stmt,
          label: stmt.label,
          order: transitions.length,
        })
        break
      }
      case 'direction':
        direction = { value: stmt.parts[0], lineIndex: stmt.lineIndex }
        break
      default:
        break
    }
  }

  return {
    headerLine: headerIndex,
    states: [...states.values()],
    stateById: states,
    transitions,
    statements,
    direction,
    lastContentLine,
  }
}

export function stateEntitySpans(graph: StateGraph, lines: LineInfo[], entityId: string): Span[] {
  if (entityId.startsWith('state:')) {
    const s = graph.stateById.get(entityId.slice(6))
    if (!s) return []
    const spans: Span[] = []
    for (const li of s.declLines) {
      const line = lines[li]
      spans.push({ start: line.start + line.indent.length, end: line.end })
    }
    for (const t of graph.transitions) {
      if (t.source === s.id) spans.push(t.stmt.sourceSpan)
      if (t.target === s.id) spans.push(t.stmt.targetSpan)
    }
    return spans
  }
  if (entityId.startsWith('trans:')) {
    const t = graph.transitions.find((tr) => tr.entityId === entityId)
    if (!t) return []
    const line = lines[t.lineIndex]
    return [{ start: line.start + line.indent.length, end: line.end }]
  }
  return []
}

export function stateEntityAt(graph: StateGraph, lines: LineInfo[], offset: number): string | null {
  for (const t of graph.transitions) {
    const line = lines[t.lineIndex]
    if (offset >= line.start && offset <= line.end) {
      if (offset >= t.stmt.sourceSpan.start && offset <= t.stmt.sourceSpan.end && t.source !== '[*]') {
        return `state:${t.source}`
      }
      if (offset >= t.stmt.targetSpan.start && offset <= t.stmt.targetSpan.end && t.target !== '[*]') {
        return `state:${t.target}`
      }
      return t.entityId
    }
  }
  for (const s of graph.states) {
    for (const li of s.declLines) {
      const line = lines[li]
      if (offset >= line.start && offset <= line.end) return s.entityId
    }
  }
  return null
}
