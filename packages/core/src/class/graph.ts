import type { LineInfo, Span } from '../types'
import { parseClassStatement, type ClClassDeclStmt, type ClRelationStmt, type ClStmt } from './parse'

export interface ClMember {
  lineIndex: number
  text: string
  textSpan: Span
}

export interface ClClass {
  /** entity id: `class:<id>` */
  entityId: string
  id: string
  label: string
  decl: ClClassDeclStmt | null
  /** open/close line indexes when declared with a `{ }` block */
  block: { open: number; close: number } | null
  members: ClMember[]
  /** one-liner member/annotation lines outside the block */
  extraLines: number[]
  refLines: number[]
  firstRefLine: number
}

export interface ClRelation {
  /** entity id: `rel:<src>-><tgt>#<n>` */
  entityId: string
  source: string
  target: string
  lineIndex: number
  stmt: ClRelationStmt
  label: string | null
  order: number
}

export interface ClassGraph {
  headerLine: number
  classes: ClClass[]
  classById: Map<string, ClClass>
  relations: ClRelation[]
  statements: Map<number, ClStmt>
  direction: { value: string; lineIndex: number } | null
  lastContentLine: number
}

export function buildClassGraph(lines: LineInfo[], headerIndex: number): ClassGraph {
  const classes = new Map<string, ClClass>()
  const relations: ClRelation[] = []
  const statements = new Map<number, ClStmt>()
  const occurrence = new Map<string, number>()
  let direction: ClassGraph['direction'] = null
  let lastContentLine = headerIndex
  let blockOwner: string | null = null

  const touch = (id: string, lineIndex: number): ClClass => {
    let c = classes.get(id)
    if (!c) {
      c = {
        entityId: `class:${id}`,
        id,
        label: id,
        decl: null,
        block: null,
        members: [],
        extraLines: [],
        refLines: [],
        firstRefLine: lineIndex,
      }
      classes.set(id, c)
    }
    return c
  }

  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    const stmt = parseClassStatement(line, blockOwner)
    statements.set(line.index, stmt)
    lastContentLine = line.index

    switch (stmt.kind) {
      case 'classDecl': {
        const c = touch(stmt.id, stmt.lineIndex)
        c.decl = stmt
        if (stmt.label !== null) c.label = stmt.label
        c.refLines.push(stmt.lineIndex)
        if (stmt.opensBlock) {
          c.block = { open: stmt.lineIndex, close: -1 }
          blockOwner = stmt.id
        }
        break
      }
      case 'blockClose': {
        if (blockOwner) {
          const c = classes.get(blockOwner)
          if (c?.block) c.block.close = stmt.lineIndex
          blockOwner = null
        }
        break
      }
      case 'member': {
        const owner = stmt.classId ?? blockOwner
        if (owner) {
          const c = touch(owner, stmt.lineIndex)
          c.members.push({ lineIndex: stmt.lineIndex, text: stmt.text, textSpan: stmt.textSpan })
          if (stmt.classId) c.extraLines.push(stmt.lineIndex)
        }
        break
      }
      case 'annotation': {
        if (stmt.parts.length === 2) {
          const c = touch(stmt.parts[1], stmt.lineIndex)
          c.extraLines.push(stmt.lineIndex)
        }
        break
      }
      case 'relation': {
        const src = touch(stmt.source, stmt.lineIndex)
        const tgt = touch(stmt.target, stmt.lineIndex)
        src.refLines.push(stmt.lineIndex)
        tgt.refLines.push(stmt.lineIndex)
        const key = `${stmt.source}->${stmt.target}`
        const occ = occurrence.get(key) ?? 0
        occurrence.set(key, occ + 1)
        relations.push({
          entityId: `rel:${key}#${occ}`,
          source: stmt.source,
          target: stmt.target,
          lineIndex: stmt.lineIndex,
          stmt,
          label: stmt.label,
          order: relations.length,
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
    classes: [...classes.values()],
    classById: classes,
    relations,
    statements,
    direction,
    lastContentLine,
  }
}

export function classEntitySpans(graph: ClassGraph, lines: LineInfo[], entityId: string): Span[] {
  if (entityId.startsWith('class:')) {
    const c = graph.classById.get(entityId.slice(6))
    if (!c) return []
    const spans: Span[] = []
    if (c.decl) {
      const line = lines[c.decl.lineIndex]
      spans.push({ start: line.start + line.indent.length, end: line.end })
    }
    for (const r of graph.relations) {
      if (r.source === c.id) spans.push(r.stmt.sourceSpan)
      if (r.target === c.id) spans.push(r.stmt.targetSpan)
    }
    return spans
  }
  if (entityId.startsWith('rel:')) {
    const r = graph.relations.find((rel) => rel.entityId === entityId)
    if (!r) return []
    const line = lines[r.lineIndex]
    return [{ start: line.start + line.indent.length, end: line.end }]
  }
  return []
}

export function classEntityAt(graph: ClassGraph, lines: LineInfo[], offset: number): string | null {
  for (const r of graph.relations) {
    const line = lines[r.lineIndex]
    if (offset >= line.start && offset <= line.end) {
      if (offset >= r.stmt.sourceSpan.start && offset <= r.stmt.sourceSpan.end) return `class:${r.source}`
      if (offset >= r.stmt.targetSpan.start && offset <= r.stmt.targetSpan.end) return `class:${r.target}`
      return r.entityId
    }
  }
  for (const c of graph.classes) {
    const linesToCheck = [
      ...(c.decl ? [c.decl.lineIndex] : []),
      ...c.members.map((m) => m.lineIndex),
      ...c.extraLines,
    ]
    for (const li of linesToCheck) {
      const line = lines[li]
      if (offset >= line.start && offset <= line.end) return c.entityId
    }
  }
  return null
}
