import type { LineInfo, TextEdit } from '../types'
import type { StateGraph, StTransition } from './graph'

export type StateType = 'state' | 'choice' | 'fork' | 'join'

export type StateOp =
  | { type: 'st.addState'; label?: string; id?: string }
  | { type: 'st.setStateType'; id: string; stype: StateType }
  | { type: 'st.addStateNote'; id: string; side: 'left' | 'right'; text?: string }
  | { type: 'st.reverseTransition'; transId: string }
  | { type: 'st.moveToComposite'; id: string; name?: string }
  | { type: 'st.connect'; source: string; target: string; label?: string }
  | { type: 'st.setStateLabel'; id: string; label: string }
  | { type: 'st.setTransitionLabel'; transId: string; label: string }
  | { type: 'st.deleteState'; id: string }
  | { type: 'st.deleteTransition'; transId: string }
  | { type: 'st.setDirection'; direction: string }

export interface StOpContext {
  code: string
  lines: LineInfo[]
  graph: StateGraph
}

export interface StOpResult {
  edits: TextEdit[]
  created?: string[]
}

function bodyIndent(ctx: StOpContext): string {
  for (const line of ctx.lines) {
    if (line.kind === 'statement' && line.index !== ctx.graph.headerLine && line.text.trim() !== '') {
      return line.indent
    }
  }
  return '  '
}

function insertAfterLine(ctx: StOpContext, lineIndex: number, texts: string[]): TextEdit {
  const line = ctx.lines[lineIndex]
  return { start: line.end, end: line.end, text: texts.map((t) => `\n${t}`).join('') }
}

function deleteLine(ctx: StOpContext, lineIndex: number): TextEdit {
  const line = ctx.lines[lineIndex]
  if (line.end < ctx.code.length) return { start: line.start, end: line.end + 1, text: '' }
  if (line.start > 0) return { start: line.start - 1, end: line.end, text: '' }
  return { start: line.start, end: line.end, text: '' }
}

function findTransition(graph: StateGraph, transId: string): StTransition | null {
  return graph.transitions.find((t) => t.entityId === transId) ?? null
}

function generateStateId(graph: StateGraph, preferred?: string): string {
  const existing = new Set(graph.states.map((s) => s.id))
  if (preferred && !existing.has(preferred)) return preferred
  let i = 1
  while (existing.has(`s${i}`)) i++
  return `s${i}`
}

function cleanLabel(label: string): string {
  return label.trim().replace(/[:{}]/g, '')
}

export function compileStateOp(ctx: StOpContext, op: StateOp): StOpResult | null {
  const { graph, lines } = ctx

  switch (op.type) {
    case 'st.addState': {
      const id = generateStateId(graph, op.id)
      const label = op.label ? cleanLabel(op.label) : null
      const text = label ? `${bodyIndent(ctx)}${id}: ${label}` : `${bodyIndent(ctx)}state ${id}`
      return {
        edits: [insertAfterLine(ctx, graph.lastContentLine, [text])],
        created: [`state:${id}`],
      }
    }

    case 'st.connect': {
      if (op.source !== '[*]' && !graph.stateById.has(op.source)) return null
      if (op.target !== '[*]' && !graph.stateById.has(op.target)) return null
      // insert after the last line referencing either endpoint, keeping its indent
      let after = graph.lastContentLine
      let found = -1
      for (const id of [op.source, op.target]) {
        const s = graph.stateById.get(id)
        if (!s) continue
        for (const li of [...s.declLines, ...s.refLines]) found = Math.max(found, li)
      }
      if (found >= 0) after = found
      const indent = lines[after].kind === 'statement' ? lines[after].indent : bodyIndent(ctx)
      const label = op.label ? `: ${cleanLabel(op.label)}` : ''
      const occ = graph.transitions.filter((t) => t.source === op.source && t.target === op.target).length
      return {
        edits: [insertAfterLine(ctx, after, [`${indent}${op.source} --> ${op.target}${label}`])],
        created: [`trans:${op.source}->${op.target}#${occ}`],
      }
    }

    case 'st.setStateType': {
      const s = graph.stateById.get(op.id)
      if (!s || s.isComposite) return null
      const suffix = op.stype === 'state' ? '' : ` <<${op.stype}>>`
      if (s.typeDeclLine !== null) {
        const line = lines[s.typeDeclLine]
        return { edits: [{ start: line.start, end: line.end, text: `${line.indent}state ${s.id}${suffix}` }] }
      }
      if (op.stype === 'state') return { edits: [] }
      // stereotypes must be declared before first use
      return { edits: [insertAfterLine(ctx, graph.headerLine, [`${bodyIndent(ctx)}state ${s.id}${suffix}`])] }
    }

    case 'st.addStateNote': {
      const s = graph.stateById.get(op.id)
      if (!s) return null
      const line = lines[s.firstRefLine]
      const text = `${line.indent}note ${op.side} of ${s.id}: ${cleanLabel(op.text ?? 'note')}`
      return { edits: [insertAfterLine(ctx, s.firstRefLine, [text])] }
    }

    case 'st.reverseTransition': {
      const t = findTransition(graph, op.transId)
      if (!t) return null
      return {
        edits: [
          { start: t.stmt.sourceSpan.start, end: t.stmt.sourceSpan.end, text: t.target },
          { start: t.stmt.targetSpan.start, end: t.stmt.targetSpan.end, text: t.source },
        ],
      }
    }

    case 'st.moveToComposite': {
      const s = graph.stateById.get(op.id)
      if (!s || s.isComposite || s.parent) return null
      const existing = new Set(graph.states.map((st) => st.id))
      let name = op.name?.replace(/[^\w-]/g, '') || ''
      if (!name || existing.has(name)) {
        let i = 1
        while (existing.has(`Composite${i}`)) i++
        name = `Composite${i}`
      }
      // membership is positional: declaring the state inside the block nests it
      const indent = bodyIndent(ctx)
      return {
        edits: [
          insertAfterLine(ctx, graph.headerLine, [`${indent}state ${name} {`, `${indent}  ${s.id}`, `${indent}}`]),
        ],
        created: [`state:${name}`],
      }
    }

    case 'st.setStateLabel': {
      const s = graph.stateById.get(op.id)
      if (!s) return null
      const label = cleanLabel(op.label)
      if (!label) return null
      if (s.decl?.labelSpan) {
        const text = s.decl.form === 'quoted' ? label.replace(/"/g, "'") : ` ${label}`
        return { edits: [{ start: s.decl.labelSpan.start, end: s.decl.labelSpan.end, text }] }
      }
      // no description yet — declare one right after the first reference
      const line = lines[s.firstRefLine]
      return { edits: [insertAfterLine(ctx, s.firstRefLine, [`${line.indent}${s.id}: ${label}`])] }
    }

    case 'st.setTransitionLabel': {
      const t = findTransition(graph, op.transId)
      if (!t) return null
      const label = cleanLabel(op.label)
      if (t.stmt.labelSpan) {
        if (!label) {
          // remove the `: label` tail entirely
          return { edits: [{ start: t.stmt.targetSpan.end, end: lines[t.lineIndex].end, text: '' }] }
        }
        return { edits: [{ start: t.stmt.labelSpan.start, end: t.stmt.labelSpan.end, text: ` ${label}` }] }
      }
      if (!label) return { edits: [] }
      return { edits: [{ start: t.stmt.targetSpan.end, end: t.stmt.targetSpan.end, text: `: ${label}` }] }
    }

    case 'st.deleteTransition': {
      const t = findTransition(graph, op.transId)
      if (!t) return null
      return { edits: [deleteLine(ctx, t.lineIndex)] }
    }

    case 'st.deleteState': {
      const s = graph.stateById.get(op.id)
      if (!s) return null
      // composite states own a brace block — deleting them wholesale is unsafe
      if (s.isComposite) return null
      const doomed = new Set<number>(s.declLines)
      for (const t of graph.transitions) {
        if (t.source === s.id || t.target === s.id) doomed.add(t.lineIndex)
      }
      return { edits: [...doomed].map((li) => deleteLine(ctx, li)) }
    }

    case 'st.setDirection': {
      if (graph.direction) {
        const line = lines[graph.direction.lineIndex]
        return { edits: [{ start: line.start, end: line.end, text: `${line.indent}direction ${op.direction}` }] }
      }
      return { edits: [insertAfterLine(ctx, graph.headerLine, [`${bodyIndent(ctx)}direction ${op.direction}`])] }
    }
  }
}
