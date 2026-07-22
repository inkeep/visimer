import type { LineInfo, Span, TextEdit } from '../types'

export interface PieSlice {
  /** entity id: `slice:<lineIndex>` */
  entityId: string
  label: string
  value: number
  lineIndex: number
  labelSpan: Span
  valueSpan: Span
}

export interface PieGraph {
  headerLine: number
  showData: boolean
  slices: PieSlice[]
  lastContentLine: number
}

const SLICE_RE = /^"([^"]*)"\s*:\s*([\d.]+)\s*$/

export function buildPieGraph(lines: LineInfo[], headerIndex: number): PieGraph {
  const slices: PieSlice[] = []
  let lastContentLine = headerIndex
  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    lastContentLine = line.index
    const m = SLICE_RE.exec(line.text.trim())
    if (!m) continue
    const labelStart = line.start + line.text.indexOf('"') + 1
    const valueStart = line.start + line.text.lastIndexOf(m[2])
    slices.push({
      entityId: `slice:${line.index}`,
      label: m[1],
      value: Number(m[2]),
      lineIndex: line.index,
      labelSpan: { start: labelStart, end: labelStart + m[1].length },
      valueSpan: { start: valueStart, end: valueStart + m[2].length },
    })
  }
  return {
    headerLine: headerIndex,
    showData: /\bshowData\b/.test(lines[headerIndex]?.text ?? ''),
    slices,
    lastContentLine,
  }
}

export type PieOp =
  | { type: 'pie.setValue'; sliceId: string; value: number }
  | { type: 'pie.setLabel'; sliceId: string; label: string }
  | { type: 'pie.addSlice'; label?: string; value?: number }
  | { type: 'pie.deleteSlice'; sliceId: string }

export interface PieOpContext {
  code: string
  lines: LineInfo[]
  graph: PieGraph
}

export function compilePieOp(ctx: PieOpContext, op: PieOp): { edits: TextEdit[]; created?: string[] } | null {
  const { graph, lines } = ctx
  const find = (id: string) => graph.slices.find((s) => s.entityId === id) ?? null

  switch (op.type) {
    case 'pie.setValue': {
      const s = find(op.sliceId)
      if (!s || !Number.isFinite(op.value) || op.value < 0) return null
      return { edits: [{ start: s.valueSpan.start, end: s.valueSpan.end, text: String(op.value) }] }
    }
    case 'pie.setLabel': {
      const s = find(op.sliceId)
      if (!s) return null
      return { edits: [{ start: s.labelSpan.start, end: s.labelSpan.end, text: op.label.replace(/"/g, "'") }] }
    }
    case 'pie.addSlice': {
      const anchorIndex = graph.slices.length ? graph.slices[graph.slices.length - 1].lineIndex : graph.lastContentLine
      const anchor = lines[anchorIndex]
      const indent = graph.slices.length ? anchor.indent : '  '
      const label = (op.label ?? 'New slice').replace(/"/g, "'")
      const text = `${indent}"${label}" : ${op.value ?? 10}`
      return {
        edits: [{ start: anchor.end, end: anchor.end, text: `\n${text}` }],
        created: [`slice:${anchorIndex + 1}`],
      }
    }
    case 'pie.deleteSlice': {
      const s = find(op.sliceId)
      if (!s) return null
      const line = lines[s.lineIndex]
      if (line.end < ctx.code.length) return { edits: [{ start: line.start, end: line.end + 1, text: '' }] }
      return { edits: [{ start: Math.max(0, line.start - 1), end: line.end, text: '' }] }
    }
  }
}

export function pieEntitySpans(graph: PieGraph, lines: LineInfo[], entityId: string): Span[] {
  const s = graph.slices.find((sl) => sl.entityId === entityId)
  if (!s) return []
  const line = lines[s.lineIndex]
  return [{ start: line.start + line.indent.length, end: line.end }]
}

export function pieEntityAt(graph: PieGraph, lines: LineInfo[], offset: number): string | null {
  for (const s of graph.slices) {
    const line = lines[s.lineIndex]
    if (offset >= line.start && offset <= line.end) return s.entityId
  }
  return null
}
