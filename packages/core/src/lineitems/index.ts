import type { LineInfo, Span, TextEdit } from '../types'

/**
 * Generic line-item editing for the long tail of chart-style diagram types.
 * Every statement line becomes an editable item; a per-type extractor derives
 * the text used to find the item's rendered element on the canvas.
 */

export interface LineItem {
  /** entity id: `item:<lineIndex>` */
  entityId: string
  /** trimmed source line — the unit of editing */
  text: string
  /** rendered label used to correlate against SVG text (null = code-only) */
  matchText: string | null
  lineIndex: number
}

export interface LineItemsGraph {
  typeId: string
  headerLine: number
  items: LineItem[]
  lastContentLine: number
  /** template inserted by `li.addItem` */
  addTemplate: string
}

const firstQuoted = (t: string): string | null => /"([^"]+)"/.exec(t)?.[1] ?? null
const firstBracketed = (t: string): string | null => {
  const m = /\[([^\]]+)\]|\(\(([^)]+)\)\)|\(([^)]+)\)|\{\{([^}]+)\}\}/.exec(t)
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4])?.replace(/^"|"$/g, '') ?? null : null
}
const beforeColon = (t: string): string | null => {
  const i = t.indexOf(':')
  return i > 0 ? t.slice(0, i).trim() : null
}
const afterKeyword = (t: string, re: RegExp): string | null => {
  const m = re.exec(t)
  return m ? t.slice(m[0].length).trim() || null : null
}

interface LineTypeConfig {
  match(trimmed: string): string | null
  addTemplate: string
}

export const LINE_ITEM_CONFIGS: Record<string, LineTypeConfig> = {
  journey: {
    match: (t) =>
      afterKeyword(t, /^(title|section)\s+/) ?? beforeColon(t),
    addTemplate: 'New task: 3: Me',
  },
  timeline: {
    match: (t) => {
      const kw = afterKeyword(t, /^title\s+/)
      if (kw) return kw
      const parts = t.split(':').map((s) => s.trim()).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : null
    },
    addTemplate: '2030 : New event',
  },
  quadrant: {
    match: (t) => (/^(title|x-axis|y-axis|quadrant-\d)/.test(t) ? null : beforeColon(t)),
    addTemplate: 'New point: [0.5, 0.5]',
  },
  kanban: {
    match: (t) => firstBracketed(t) ?? (/^\S/.test(t) ? t : null),
    addTemplate: '  [New card]',
  },
  mindmap: {
    match: (t) => firstBracketed(t) ?? (t.replace(/^::icon.*$/, '') || null),
    addTemplate: '    New idea',
  },
  treemap: {
    match: (t) => firstQuoted(t),
    addTemplate: '"New item": 10',
  },
  packet: {
    match: (t) => firstQuoted(t),
    addTemplate: '96-127: "New Field"',
  },
  sankey: {
    match: (t) => t.split(',')[0]?.trim().replace(/^"|"$/g, '') || null,
    addTemplate: 'Source,Target,10',
  },
  radar: {
    match: (t) => firstQuoted(t),
    addTemplate: 'curve new["New"]{50, 50, 50}',
  },
  gitgraph: {
    match: (t) =>
      firstQuoted(t) ?? afterKeyword(t, /^(branch|checkout|merge)\s+/),
    addTemplate: 'commit',
  },
  xychart: {
    match: (t) => (/^title\b/.test(t) ? firstQuoted(t) : null),
    addTemplate: 'bar [10, 20, 30]',
  },
  architecture: {
    match: (t) => firstBracketed(t),
    addTemplate: 'service new1(server)[New Service]',
  },
  requirement: {
    match: (t) => /^(requirement|element|functionalRequirement|interface|performanceRequirement|physicalRequirement|designConstraint)\s+(\w+)/.exec(t)?.[2] ?? null,
    addTemplate: 'element new_element {',
  },
  c4: {
    match: (t) => firstQuoted(t),
    addTemplate: 'Person(newPerson, "New Person", "Description")',
  },
  block: {
    match: (t) => firstBracketed(t) ?? (/^[\w]+$/.test(t) ? t : null),
    addTemplate: 'newBlock["New Block"]',
  },
}

export function buildLineItemsGraph(
  lines: LineInfo[],
  headerIndex: number,
  typeId: string,
): LineItemsGraph | null {
  const config = LINE_ITEM_CONFIGS[typeId]
  if (!config) return null
  const items: LineItem[] = []
  let lastContentLine = headerIndex
  for (const line of lines) {
    if (line.kind !== 'statement' || line.index === headerIndex) {
      if (line.index === headerIndex) lastContentLine = line.index
      continue
    }
    lastContentLine = line.index
    const t = line.text.trim()
    if (t === '}' || t === 'end') continue
    items.push({
      entityId: `item:${line.index}`,
      text: t,
      matchText: config.match(t),
      lineIndex: line.index,
    })
  }
  return { typeId, headerLine: headerIndex, items, lastContentLine, addTemplate: config.addTemplate }
}

export type LineItemOp =
  | { type: 'li.setLine'; itemId: string; text: string }
  | { type: 'li.addItem'; text?: string }
  | { type: 'li.deleteItem'; itemId: string }

export interface LiOpContext {
  code: string
  lines: LineInfo[]
  graph: LineItemsGraph
}

export function compileLineItemOp(
  ctx: LiOpContext,
  op: LineItemOp,
): { edits: TextEdit[]; created?: string[] } | null {
  const { graph, lines } = ctx
  const find = (id: string) => graph.items.find((i) => i.entityId === id) ?? null

  switch (op.type) {
    case 'li.setLine': {
      const item = find(op.itemId)
      if (!item) return null
      const text = op.text.replace(/\n/g, ' ').trim()
      const line = lines[item.lineIndex]
      if (!text) {
        if (line.end < ctx.code.length) return { edits: [{ start: line.start, end: line.end + 1, text: '' }] }
        return { edits: [{ start: Math.max(0, line.start - 1), end: line.end, text: '' }] }
      }
      return { edits: [{ start: line.start, end: line.end, text: `${line.indent}${text}` }] }
    }
    case 'li.addItem': {
      const anchorIndex = graph.items.length
        ? graph.items[graph.items.length - 1].lineIndex
        : graph.lastContentLine
      const anchor = lines[anchorIndex]
      const indent = graph.items.length ? anchor.indent : '  '
      const text = (op.text ?? graph.addTemplate).replace(/\n/g, ' ')
      return {
        edits: [{ start: anchor.end, end: anchor.end, text: `\n${indent}${text.trim()}` }],
        created: [`item:${anchorIndex + 1}`],
      }
    }
    case 'li.deleteItem': {
      const item = find(op.itemId)
      if (!item) return null
      const line = lines[item.lineIndex]
      if (line.end < ctx.code.length) return { edits: [{ start: line.start, end: line.end + 1, text: '' }] }
      return { edits: [{ start: Math.max(0, line.start - 1), end: line.end, text: '' }] }
    }
  }
}

export function lineItemSpans(graph: LineItemsGraph, lines: LineInfo[], entityId: string): Span[] {
  const item = graph.items.find((i) => i.entityId === entityId)
  if (!item) return []
  const line = lines[item.lineIndex]
  return [{ start: line.start + line.indent.length, end: line.end }]
}

export function lineItemAt(graph: LineItemsGraph, lines: LineInfo[], offset: number): string | null {
  for (const item of graph.items) {
    const line = lines[item.lineIndex]
    if (offset >= line.start && offset <= line.end) return item.entityId
  }
  return null
}
