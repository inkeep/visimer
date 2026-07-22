import type { LineInfo, Span } from '../types'
import { parseErStatement, type ErEntityDeclStmt, type ErRelationStmt, type ErStmt } from './parse'

export interface ErEntity {
  /** entity id: `entity:<id>` */
  entityId: string
  id: string
  label: string
  decl: ErEntityDeclStmt | null
  block: { open: number; close: number } | null
  attributes: Array<{ lineIndex: number; text: string; textSpan: Span }>
  refLines: number[]
  firstRefLine: number
}

export interface ErRelation {
  /** entity id: `erel:<src>-><tgt>#<n>` */
  entityId: string
  source: string
  target: string
  lineIndex: number
  stmt: ErRelationStmt
  label: string
  order: number
}

export interface ErGraph {
  headerLine: number
  entities: ErEntity[]
  entityById: Map<string, ErEntity>
  relations: ErRelation[]
  statements: Map<number, ErStmt>
  lastContentLine: number
}

export function buildErGraph(lines: LineInfo[], headerIndex: number): ErGraph {
  const entities = new Map<string, ErEntity>()
  const relations: ErRelation[] = []
  const statements = new Map<number, ErStmt>()
  const occurrence = new Map<string, number>()
  let lastContentLine = headerIndex
  let blockOwner: string | null = null

  const touch = (id: string, lineIndex: number): ErEntity => {
    let e = entities.get(id)
    if (!e) {
      e = {
        entityId: `entity:${id}`,
        id,
        label: id,
        decl: null,
        block: null,
        attributes: [],
        refLines: [],
        firstRefLine: lineIndex,
      }
      entities.set(id, e)
    }
    return e
  }

  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    const stmt = parseErStatement(line, blockOwner !== null)
    statements.set(line.index, stmt)
    lastContentLine = line.index

    switch (stmt.kind) {
      case 'entityDecl': {
        const e = touch(stmt.id, stmt.lineIndex)
        e.decl = stmt
        if (stmt.alias) e.label = stmt.alias
        e.refLines.push(stmt.lineIndex)
        if (stmt.opensBlock) {
          e.block = { open: stmt.lineIndex, close: -1 }
          blockOwner = stmt.id
        }
        break
      }
      case 'blockClose': {
        if (blockOwner) {
          const e = entities.get(blockOwner)
          if (e?.block) e.block.close = stmt.lineIndex
          blockOwner = null
        }
        break
      }
      case 'attribute': {
        if (blockOwner) {
          const e = touch(blockOwner, stmt.lineIndex)
          e.attributes.push({ lineIndex: stmt.lineIndex, text: stmt.text, textSpan: stmt.textSpan })
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
          entityId: `erel:${key}#${occ}`,
          source: stmt.source,
          target: stmt.target,
          lineIndex: stmt.lineIndex,
          stmt,
          label: stmt.label,
          order: relations.length,
        })
        break
      }
      default:
        break
    }
  }

  return {
    headerLine: headerIndex,
    entities: [...entities.values()],
    entityById: entities,
    relations,
    statements,
    lastContentLine,
  }
}

export function erEntitySpans(graph: ErGraph, lines: LineInfo[], entityId: string): Span[] {
  if (entityId.startsWith('entity:')) {
    const e = graph.entityById.get(entityId.slice(7))
    if (!e) return []
    const spans: Span[] = []
    if (e.decl) {
      const line = lines[e.decl.lineIndex]
      spans.push({ start: line.start + line.indent.length, end: line.end })
    }
    for (const r of graph.relations) {
      if (r.source === e.id) spans.push(r.stmt.sourceSpan)
      if (r.target === e.id) spans.push(r.stmt.targetSpan)
    }
    return spans
  }
  if (entityId.startsWith('erel:')) {
    const r = graph.relations.find((rel) => rel.entityId === entityId)
    if (!r) return []
    const line = lines[r.lineIndex]
    return [{ start: line.start + line.indent.length, end: line.end }]
  }
  return []
}

export function erEntityAt(graph: ErGraph, lines: LineInfo[], offset: number): string | null {
  for (const r of graph.relations) {
    const line = lines[r.lineIndex]
    if (offset >= line.start && offset <= line.end) {
      if (offset >= r.stmt.sourceSpan.start && offset <= r.stmt.sourceSpan.end) return `entity:${r.source}`
      if (offset >= r.stmt.targetSpan.start && offset <= r.stmt.targetSpan.end) return `entity:${r.target}`
      return r.entityId
    }
  }
  for (const e of graph.entities) {
    const toCheck = [...(e.decl ? [e.decl.lineIndex] : []), ...e.attributes.map((a) => a.lineIndex)]
    for (const li of toCheck) {
      const line = lines[li]
      if (offset >= line.start && offset <= line.end) return e.entityId
    }
  }
  return null
}
