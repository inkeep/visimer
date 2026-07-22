import type { LineInfo, TextEdit } from '../types'
import type { ClassGraph, ClRelation } from './graph'
import type { RelationOp } from './parse'

export type ClassOp =
  | { type: 'cl.addClass'; name?: string }
  | { type: 'cl.connect'; source: string; target: string; op?: RelationOp; label?: string }
  | { type: 'cl.renameClass'; id: string; name: string }
  | { type: 'cl.setRelationType'; relId: string; op: RelationOp }
  | { type: 'cl.setRelationLabel'; relId: string; label: string }
  | { type: 'cl.reverseRelation'; relId: string }
  | { type: 'cl.addMember'; id: string; text?: string }
  | { type: 'cl.setMemberText'; id: string; memberLine: number; text: string }
  | { type: 'cl.deleteMember'; id: string; memberLine: number }
  | { type: 'cl.deleteClass'; id: string }
  | { type: 'cl.deleteRelation'; relId: string }
  | { type: 'cl.setDirection'; direction: string }
  | { type: 'cl.setAnnotation'; id: string; annotation: string | null }
  | { type: 'cl.addNoteFor'; id: string; text?: string }
  | { type: 'cl.setCardinality'; relId: string; side: 'source' | 'target'; value: string | null }

export interface ClOpContext {
  code: string
  lines: LineInfo[]
  graph: ClassGraph
}

export interface ClOpResult {
  edits: TextEdit[]
  created?: string[]
}

function bodyIndent(ctx: ClOpContext): string {
  for (const line of ctx.lines) {
    if (line.kind === 'statement' && line.index !== ctx.graph.headerLine && line.text.trim() !== '') {
      return line.indent
    }
  }
  return '  '
}

function insertAfterLine(ctx: ClOpContext, lineIndex: number, texts: string[]): TextEdit {
  const line = ctx.lines[lineIndex]
  return { start: line.end, end: line.end, text: texts.map((t) => `\n${t}`).join('') }
}

function deleteLine(ctx: ClOpContext, lineIndex: number): TextEdit {
  const line = ctx.lines[lineIndex]
  if (line.end < ctx.code.length) return { start: line.start, end: line.end + 1, text: '' }
  if (line.start > 0) return { start: line.start - 1, end: line.end, text: '' }
  return { start: line.start, end: line.end, text: '' }
}

function findRelation(graph: ClassGraph, relId: string): ClRelation | null {
  return graph.relations.find((r) => r.entityId === relId) ?? null
}

function generateClassName(graph: ClassGraph, preferred?: string): string {
  const existing = new Set(graph.classes.map((c) => c.id))
  if (preferred && !existing.has(preferred)) return preferred
  let i = 1
  while (existing.has(`Class${i}`)) i++
  return `Class${i}`
}

function cleanText(text: string): string {
  return text.trim().replace(/[{}]/g, '')
}

export function compileClassOp(ctx: ClOpContext, op: ClassOp): ClOpResult | null {
  const { graph, lines } = ctx

  switch (op.type) {
    case 'cl.addClass': {
      const id = generateClassName(graph, op.name?.replace(/[^\w.~]/g, ''))
      const indent = bodyIndent(ctx)
      return {
        edits: [insertAfterLine(ctx, graph.lastContentLine, [`${indent}class ${id} {`, `${indent}}`])],
        created: [`class:${id}`],
      }
    }

    case 'cl.connect': {
      if (!graph.classById.has(op.source) || !graph.classById.has(op.target)) return null
      let after = graph.lastContentLine
      let found = -1
      for (const id of [op.source, op.target]) {
        const c = graph.classById.get(id)
        if (!c) continue
        // never insert inside a class block — anchor on relations/decl lines only
        for (const li of c.refLines) found = Math.max(found, c.block && li === c.block.open ? c.block.close : li)
      }
      if (found >= 0) after = found
      const indent = lines[after].kind === 'statement' ? lines[after].indent : bodyIndent(ctx)
      const label = op.label ? ` : ${cleanText(op.label)}` : ''
      const occ = graph.relations.filter((r) => r.source === op.source && r.target === op.target).length
      return {
        edits: [insertAfterLine(ctx, after, [`${indent}${op.source} ${op.op ?? '-->'} ${op.target}${label}`])],
        created: [`rel:${op.source}->${op.target}#${occ}`],
      }
    }

    case 'cl.renameClass': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      const name = op.name.trim().replace(/[^\w.~]/g, '')
      if (!name || graph.classById.has(name)) return null
      const edits: TextEdit[] = []
      if (c.decl) edits.push({ start: c.decl.idSpan.start, end: c.decl.idSpan.end, text: name })
      for (const r of graph.relations) {
        if (r.source === op.id) edits.push({ start: r.stmt.sourceSpan.start, end: r.stmt.sourceSpan.end, text: name })
        if (r.target === op.id) edits.push({ start: r.stmt.targetSpan.start, end: r.stmt.targetSpan.end, text: name })
      }
      for (const li of c.extraLines) {
        const line = lines[li]
        const idStart = line.start + line.text.indexOf(op.id)
        if (idStart >= line.start) edits.push({ start: idStart, end: idStart + op.id.length, text: name })
      }
      return { edits }
    }

    case 'cl.setRelationType': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      return { edits: [{ start: r.stmt.opSpan.start, end: r.stmt.opSpan.end, text: op.op }] }
    }

    case 'cl.setRelationLabel': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      const label = cleanText(op.label)
      if (r.stmt.labelSpan) {
        if (!label) {
          return { edits: [{ start: r.stmt.targetSpan.end, end: lines[r.lineIndex].end, text: '' }] }
        }
        return { edits: [{ start: r.stmt.labelSpan.start, end: r.stmt.labelSpan.end, text: ` ${label}` }] }
      }
      if (!label) return { edits: [] }
      return { edits: [{ start: r.stmt.targetSpan.end, end: r.stmt.targetSpan.end, text: ` : ${label}` }] }
    }

    case 'cl.reverseRelation': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      return {
        edits: [
          { start: r.stmt.sourceSpan.start, end: r.stmt.sourceSpan.end, text: r.target },
          { start: r.stmt.targetSpan.start, end: r.stmt.targetSpan.end, text: r.source },
        ],
      }
    }

    case 'cl.addMember': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      const text = cleanText(op.text ?? '+attribute')
      if (c.block && c.block.close >= 0) {
        const openLine = lines[c.block.open]
        const memberIndent = c.members.length
          ? lines[c.members[c.members.length - 1].lineIndex].indent
          : `${openLine.indent}  `
        const anchor = c.members.length ? c.members[c.members.length - 1].lineIndex : c.block.open
        return { edits: [insertAfterLine(ctx, anchor, [`${memberIndent}${text}`])] }
      }
      const anchor = c.decl?.lineIndex ?? c.firstRefLine
      const line = lines[anchor]
      return { edits: [insertAfterLine(ctx, anchor, [`${line.indent}${c.id} : ${text}`])] }
    }

    case 'cl.setMemberText': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      const m = c.members.find((mm) => mm.lineIndex === op.memberLine)
      if (!m) return null
      const text = cleanText(op.text)
      if (!text) return { edits: [deleteLine(ctx, m.lineIndex)] }
      const prefix = ctx.code.slice(m.textSpan.start - 1, m.textSpan.start) === ':' ? ' ' : ''
      return { edits: [{ start: m.textSpan.start, end: m.textSpan.end, text: `${prefix}${text}` }] }
    }

    case 'cl.deleteMember': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      if (!c.members.some((m) => m.lineIndex === op.memberLine)) return null
      return { edits: [deleteLine(ctx, op.memberLine)] }
    }

    case 'cl.deleteClass': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      const doomed = new Set<number>()
      if (c.decl) doomed.add(c.decl.lineIndex)
      if (c.block && c.block.close >= 0) {
        for (let li = c.block.open; li <= c.block.close; li++) doomed.add(li)
      }
      for (const li of c.extraLines) doomed.add(li)
      for (const m of c.members) doomed.add(m.lineIndex)
      for (const r of graph.relations) {
        if (r.source === c.id || r.target === c.id) doomed.add(r.lineIndex)
      }
      return { edits: [...doomed].map((li) => deleteLine(ctx, li)) }
    }

    case 'cl.deleteRelation': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      return { edits: [deleteLine(ctx, r.lineIndex)] }
    }

    case 'cl.setAnnotation': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      const annotation = op.annotation?.replace(/[<>\s]/g, '') ?? null
      // find an existing `<<anno>> Id` line for this class
      let annoLine = -1
      for (const [lineIndex, stmt] of graph.statements) {
        if (stmt.kind === 'annotation' && stmt.parts[1] === op.id) {
          annoLine = lineIndex
          break
        }
      }
      if (annoLine >= 0) {
        if (!annotation) return { edits: [deleteLine(ctx, annoLine)] }
        const line = lines[annoLine]
        return { edits: [{ start: line.start, end: line.end, text: `${line.indent}<<${annotation}>> ${op.id}` }] }
      }
      if (!annotation) return { edits: [] }
      const anchor = c.decl?.lineIndex ?? c.firstRefLine
      const line = lines[anchor]
      return { edits: [insertAfterLine(ctx, anchor, [`${line.indent}<<${annotation}>> ${op.id}`])] }
    }

    case 'cl.addNoteFor': {
      const c = graph.classById.get(op.id)
      if (!c) return null
      const text = (op.text ?? 'note').replace(/"/g, "'")
      return {
        edits: [insertAfterLine(ctx, graph.lastContentLine, [`${bodyIndent(ctx)}note for ${op.id} "${text}"`])],
      }
    }

    case 'cl.setCardinality': {
      const r = findRelation(graph, op.relId)
      if (!r) return null
      const value = op.value?.replace(/"/g, '').trim() ?? null
      const span = op.side === 'source' ? r.stmt.sourceCardSpan : r.stmt.targetCardSpan
      if (span) {
        if (value === null || value === '') {
          // remove the quoted string plus its separating space
          return { edits: [{ start: span.start - 2, end: span.end + 1, text: '' }] }
        }
        return { edits: [{ start: span.start, end: span.end, text: value }] }
      }
      if (value === null || value === '') return { edits: [] }
      if (op.side === 'source') {
        return { edits: [{ start: r.stmt.sourceSpan.end, end: r.stmt.sourceSpan.end, text: ` "${value}"` }] }
      }
      return { edits: [{ start: r.stmt.targetSpan.start, end: r.stmt.targetSpan.start, text: `"${value}" ` }] }
    }

    case 'cl.setDirection': {
      if (graph.direction) {
        const line = lines[graph.direction.lineIndex]
        return { edits: [{ start: line.start, end: line.end, text: `${line.indent}direction ${op.direction}` }] }
      }
      return { edits: [insertAfterLine(ctx, graph.headerLine, [`${bodyIndent(ctx)}direction ${op.direction}`])] }
    }
  }
}
