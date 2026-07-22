import type { LineInfo, Span, TextEdit } from '../types'

export interface GanttTask {
  /** entity id: `task:<lineIndex>` */
  entityId: string
  name: string
  /** raw metadata after the colon (ids, flags, dates, durations) */
  meta: string
  lineIndex: number
  nameSpan: Span
  metaSpan: Span
  section: string | null
}

export interface GanttGraph {
  headerLine: number
  tasks: GanttTask[]
  sections: Array<{ name: string; lineIndex: number }>
  lastContentLine: number
}

const KEYWORD_RE = /^(dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|title|weekday|inclusiveEndDates|topAxis)\b/
const SECTION_RE = /^section\s+(.+)$/
const TASK_RE = /^(.+?)\s*:\s*(.+)$/

export function buildGanttGraph(lines: LineInfo[], headerIndex: number): GanttGraph {
  const tasks: GanttTask[] = []
  const sections: GanttGraph['sections'] = []
  let currentSection: string | null = null
  let lastContentLine = headerIndex

  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    lastContentLine = line.index
    const t = line.text.trim()
    if (KEYWORD_RE.test(t)) continue
    const sec = SECTION_RE.exec(t)
    if (sec) {
      currentSection = sec[1].trim()
      sections.push({ name: currentSection, lineIndex: line.index })
      continue
    }
    const task = TASK_RE.exec(t)
    if (task) {
      const nameStart = line.start + line.indent.length
      const colon = line.text.indexOf(':', line.indent.length + task[1].length - 1)
      const metaStart = line.start + colon + 1
      tasks.push({
        entityId: `task:${line.index}`,
        name: task[1].trim(),
        meta: task[2].trim(),
        lineIndex: line.index,
        nameSpan: { start: nameStart, end: nameStart + task[1].trimEnd().length },
        metaSpan: { start: metaStart, end: line.end },
        section: currentSection,
      })
    }
  }
  return { headerLine: headerIndex, tasks, sections, lastContentLine }
}

export type GanttOp =
  | { type: 'gantt.setTaskName'; taskId: string; name: string }
  | { type: 'gantt.setTaskMeta'; taskId: string; meta: string }
  | { type: 'gantt.addTask'; section?: string; name?: string; meta?: string }
  | { type: 'gantt.deleteTask'; taskId: string }

export interface GanttOpContext {
  code: string
  lines: LineInfo[]
  graph: GanttGraph
}

export function compileGanttOp(
  ctx: GanttOpContext,
  op: GanttOp,
): { edits: TextEdit[]; created?: string[] } | null {
  const { graph, lines } = ctx
  const find = (id: string) => graph.tasks.find((t) => t.entityId === id) ?? null

  switch (op.type) {
    case 'gantt.setTaskName': {
      const t = find(op.taskId)
      if (!t) return null
      const name = op.name.trim().replace(/[:#]/g, '')
      if (!name) return null
      return { edits: [{ start: t.nameSpan.start, end: t.nameSpan.end, text: name }] }
    }
    case 'gantt.setTaskMeta': {
      const t = find(op.taskId)
      if (!t) return null
      const meta = op.meta.trim().replace(/:/g, '')
      if (!meta) return null
      return { edits: [{ start: t.metaSpan.start, end: t.metaSpan.end, text: ` ${meta}` }] }
    }
    case 'gantt.addTask': {
      // append after the last task of the requested (or last) section
      const inSection = op.section
        ? graph.tasks.filter((t) => t.section === op.section)
        : graph.tasks
      const anchorIndex = inSection.length
        ? inSection[inSection.length - 1].lineIndex
        : graph.sections.length
          ? graph.sections[graph.sections.length - 1].lineIndex
          : graph.lastContentLine
      const anchor = lines[anchorIndex]
      const indent = inSection.length ? anchor.indent : `${anchor.indent}  `
      const name = (op.name ?? 'New task').replace(/[:#]/g, '')
      const meta = (op.meta ?? '1d').replace(/:/g, '')
      return {
        edits: [{ start: anchor.end, end: anchor.end, text: `\n${indent}${name} :${meta}` }],
        created: [`task:${anchorIndex + 1}`],
      }
    }
    case 'gantt.deleteTask': {
      const t = find(op.taskId)
      if (!t) return null
      const line = lines[t.lineIndex]
      if (line.end < ctx.code.length) return { edits: [{ start: line.start, end: line.end + 1, text: '' }] }
      return { edits: [{ start: Math.max(0, line.start - 1), end: line.end, text: '' }] }
    }
  }
}

export function ganttEntitySpans(graph: GanttGraph, lines: LineInfo[], entityId: string): Span[] {
  const t = graph.tasks.find((tk) => tk.entityId === entityId)
  if (!t) return []
  const line = lines[t.lineIndex]
  return [{ start: line.start + line.indent.length, end: line.end }]
}

export function ganttEntityAt(graph: GanttGraph, lines: LineInfo[], offset: number): string | null {
  for (const t of graph.tasks) {
    const line = lines[t.lineIndex]
    if (offset >= line.start && offset <= line.end) return t.entityId
  }
  return null
}
