import type { LineInfo, TextEdit } from '../types'
import type { ErGraph, ErRelation } from './graph'

export type ErCardinality = 'zero-or-one' | 'exactly-one' | 'zero-or-more' | 'one-or-more'

const LEFT_GLYPHS: Record<ErCardinality, string> = {
  'zero-or-one': '|o',
  'exactly-one': '||',
  'zero-or-more': '}o',
  'one-or-more': '}|',
}
const RIGHT_GLYPHS: Record<ErCardinality, string> = {
  'zero-or-one': 'o|',
  'exactly-one': '||',
  'zero-or-more': 'o{',
  'one-or-more': '|{',
}

export function cardinalityFromGlyph(glyph: string): ErCardinality {
  for (const [k, v] of Object.entries(LEFT_GLYPHS)) if (v === glyph) return k as ErCardinality
  for (const [k, v] of Object.entries(RIGHT_GLYPHS)) if (v === glyph) return k as ErCardinality
  return 'exactly-one'
}

export type ErOp =
  | { type: 'er.addEntity'; name?: string }
  | { type: 'er.connect'; source: string; target: string; label?: string }
  | { type: 'er.renameEntity'; id: string; name: string }
  | { type: 'er.setCardinality'; relId: string; side: 'left' | 'right'; card: ErCardinality }
  | { type: 'er.setIdentifying'; relId: string; identifying: boolean }
  | { type: 'er.setRelationLabel'; relId: string; label: string }
  | { type: 'er.addAttribute'; id: string; text?: string }
  | { type: 'er.setAttributeText'; id: string; attrLine: number; text: string }
  | { type: 'er.deleteEntity'; id: string }
  | { type: 'er.deleteRelation'; relId: string }

export interface ErOpContext {
  code: string
  lines: LineInfo[]
  graph: ErGraph
}

export interface ErOpResult {
  edits: TextEdit[]
  created?: string[]
}

function bodyIndent(ctx: ErOpContext): string {
  for (const line of ctx.lines) {
    if (line.kind === 'statement' && line.index !== ctx.graph.headerLine && line.text.trim() !== '') {
      return line.indent
    }
  }
  return '  '
}

function insertAfterLine(ctx: ErOpContext, lineIndex: number, texts: string[]): TextEdit {
  const line = ctx.lines[lineIndex]
  return { start: line.end, end: line.end, text: texts.map((t) => `\n${t}`).join('') }
}

function deleteLine(ctx: ErOpContext, lineIndex: number): TextEdit {
  const line = ctx.lines[lineIndex]
  if (line.end < ctx.code.length) return { start: line.start, end: line.end + 1, text: '' }
  if (line.start > 0) return { start: line.start - 1, end: line.end, text: '' }
  return { start: line.start, end: line.end, text: '' }
}

function findRelation(graph: ErGraph, relId: string): ErRelation | null {
  return graph.relations.find((r) => r.entityId === relId) ?? null
}

export function compileErOp(ctx: ErOpContext, op: ErOp): ErOpResult | null {
  const { graph, lines } = ctx

  switch (op.type) {
    case 'er.addEntity': {
      const existing = new Set(graph.entities.map((e) => e.id))
      let id = op.name?.replace(/[^\w-]/g, '') || ''
      if (!id || existing.has(id)) {
        let i = 1
        while (existing.has(`ENTITY${i}`)) i++
        id = `ENTITY${i}`
      }
      const indent = bodyIndent(ctx)
      return {
        edits: [insertAfterLine(ctx, graph.lastContentLine, [`${indent}${id} {`, `${indent}  string id`, `${indent}}`])],
        created: [`entity:${id}`],
      }
    }

    case 'er.connect': {
      if (!graph.entityById.has(op.source) || !graph.entityById.has(op.target)) return null
      let after = graph.lastContentLine
      let found = -1
      for (const id of [op.source, op.target]) {
        const e = graph.entityById.get(id)
        if (!e) continue
        for (const li of e.refLines) found = Math.max(found, e.block && li === e.block.open ? e.block.close : li)
      }
      if (found >= 0) after = found
      const indent = lines[after].kind === 'statement' ? lines[after].indent : bodyIndent(ctx)
      const label = (op.label ?? 'relates').replace(/[:{}]/g, '').trim() || 'relates'
      const occ = graph.relations.filter((r) => r.source === op.source && r.target === op.target).length
      return {
        edits: [insertAfterLine(ctx, after, [`${indent}${op.source} ||--o{ ${op.target} : ${label}`])],
        created: [`erel:${op.source}->${op.target}#${occ}`],
      }
    }

    case 'er.renameEntity': {
      const e = graph.entityById.get(op.id)
      if (!e) return null
      const name = op.name.trim().replace(/[^\w-]/g, '')
      if (!name || graph.entityById.has(name)) return null
      const edits: TextEdit[] = []
      if (e.decl) edits.push({ start: e.decl.idSpan.start, end: e.decl.idSpan.end, text: name })
      for (const r of graph.relations) {
        if (r.source === op.id) edits.push({ start: r.stmt.sourceSpan.start, end: r.stmt.sourceSpan.end, text: name })
        if (r.target === op.id) edits.push({ start: r.stmt.targetSpan.start, end: r.stmt.targetSpan.end, text: name })
      }
      return { edits }
    }

    case 'er.setCardinality': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      if (op.side === 'left') {
        return {
          edits: [{ start: r.stmt.leftCardSpan.start, end: r.stmt.leftCardSpan.end, text: LEFT_GLYPHS[op.card] }],
        }
      }
      return {
        edits: [{ start: r.stmt.rightCardSpan.start, end: r.stmt.rightCardSpan.end, text: RIGHT_GLYPHS[op.card] }],
      }
    }

    case 'er.setIdentifying': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      return {
        edits: [{ start: r.stmt.lineSpan.start, end: r.stmt.lineSpan.end, text: op.identifying ? '--' : '..' }],
      }
    }

    case 'er.setRelationLabel': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      const label = op.label.replace(/[:{}]/g, '').trim() || 'relates'
      return { edits: [{ start: r.stmt.labelSpan.start, end: r.stmt.labelSpan.end, text: ` ${label}` }] }
    }

    case 'er.addAttribute': {
      const e = graph.entityById.get(op.id)
      if (!e) return null
      const text = (op.text ?? 'string attribute').replace(/[{}]/g, '').trim()
      if (e.block && e.block.close >= 0) {
        const openLine = lines[e.block.open]
        const indent = e.attributes.length
          ? lines[e.attributes[e.attributes.length - 1].lineIndex].indent
          : `${openLine.indent}  `
        const anchor = e.attributes.length ? e.attributes[e.attributes.length - 1].lineIndex : e.block.open
        return { edits: [insertAfterLine(ctx, anchor, [`${indent}${text}`])] }
      }
      // no block yet — create one at the entity's first reference
      const line = lines[e.firstRefLine]
      return {
        edits: [insertAfterLine(ctx, e.firstRefLine, [`${line.indent}${e.id} {`, `${line.indent}  ${text}`, `${line.indent}}`])],
      }
    }

    case 'er.setAttributeText': {
      const e = graph.entityById.get(op.id)
      if (!e) return null
      const attr = e.attributes.find((a) => a.lineIndex === op.attrLine)
      if (!attr) return null
      const text = op.text.replace(/[{}]/g, '').trim()
      if (!text) return { edits: [deleteLine(ctx, attr.lineIndex)] }
      const line = lines[attr.lineIndex]
      return { edits: [{ start: line.start, end: line.end, text: `${line.indent}${text}` }] }
    }

    case 'er.deleteEntity': {
      const e = graph.entityById.get(op.id)
      if (!e) return null
      const doomed = new Set<number>()
      if (e.decl) doomed.add(e.decl.lineIndex)
      if (e.block && e.block.close >= 0) {
        for (let li = e.block.open; li <= e.block.close; li++) doomed.add(li)
      }
      for (const r of graph.relations) {
        if (r.source === e.id || r.target === e.id) doomed.add(r.lineIndex)
      }
      return { edits: [...doomed].map((li) => deleteLine(ctx, li)) }
    }

    case 'er.deleteRelation': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      return { edits: [deleteLine(ctx, r.lineIndex)] }
    }
  }
}
