import type { LineInfo, TextEdit } from '../types'
import type { FlowGraph, FlowEdge, FlowNode } from './graph'
import { SHAPE_DELIMS, type ChainStmt, type EdgeArrow, type EdgeLine, type NodeRef, type ShapeId } from './parse'

export type FlowchartOp =
  | { type: 'addNode'; shape?: ShapeId; label?: string; id?: string }
  | { type: 'connect'; source: string; target: string; line?: EdgeLine; arrowEnd?: EdgeArrow; label?: string }
  | { type: 'renameNode'; id: string; label: string }
  | { type: 'setNodeShape'; id: string; shape: ShapeId }
  | { type: 'setEdgeLabel'; edgeId: string; label: string }
  | { type: 'setEdgeStyle'; edgeId: string; line?: EdgeLine; arrowEnd?: EdgeArrow }
  | { type: 'setDirection'; direction: string }
  | { type: 'deleteNode'; id: string }
  | { type: 'deleteEdge'; edgeId: string }
  | { type: 'renameSubgraph'; id: string; title: string }
  | { type: 'setNodeColor'; id: string; prop: 'fill' | 'stroke' | 'color'; value: string | null }
  | { type: 'setEdgeColor'; edgeId: string; value: string | null }
  | { type: 'reverseEdge'; edgeId: string }
  | { type: 'duplicateNode'; id: string }

export interface OpResult {
  edits: TextEdit[]
  /** entity ids created by this op (e.g. the new node) */
  created?: string[]
}

export interface FlowOpContext {
  code: string
  lines: LineInfo[]
  graph: FlowGraph
}

// ---------- helpers ----------

const NEEDS_QUOTE = /[[\]{}()|<>\\/&%#;]|^\s|\s$/

function printLabel(label: string, forceQuote: boolean): string {
  const clean = label.replace(/"/g, "'")
  if (forceQuote || NEEDS_QUOTE.test(clean)) return `"${clean}"`
  return clean
}

function edgeOpString(line: EdgeLine, arrowEnd: EdgeArrow): string {
  const end = arrowEnd === 'arrow' ? '>' : arrowEnd === 'cross' ? 'x' : arrowEnd === 'circle' ? 'o' : ''
  switch (line) {
    case 'thick':
      return end ? `==${end}` : '==='
    case 'dotted':
      return end ? `-.-${end}` : '-.-'
    case 'invisible':
      return '~~~'
    default:
      return end ? `--${end}` : '---'
  }
}

function bodyIndent(ctx: FlowOpContext): string {
  for (const line of ctx.lines) {
    if (line.kind === 'statement' && line.index !== ctx.graph.headerLine && line.text.trim() !== '') {
      return line.indent
    }
  }
  return '  '
}

function insertLinesAfter(ctx: FlowOpContext, lineIndex: number, texts: string[]): TextEdit {
  const line = ctx.lines[lineIndex]
  return { start: line.end, end: line.end, text: texts.map((t) => `\n${t}`).join('') }
}

function deleteLineEdit(ctx: FlowOpContext, lineIndex: number): TextEdit {
  const line = ctx.lines[lineIndex]
  if (line.end < ctx.code.length) return { start: line.start, end: line.end + 1, text: '' }
  if (line.start > 0) return { start: line.start - 1, end: line.end, text: '' }
  return { start: line.start, end: line.end, text: '' }
}

function replaceLineEdit(ctx: FlowOpContext, lineIndex: number, texts: string[]): TextEdit {
  if (texts.length === 0) return deleteLineEdit(ctx, lineIndex)
  const line = ctx.lines[lineIndex]
  return { start: line.start, end: line.end, text: texts.join('\n') }
}

function slice(ctx: FlowOpContext, span: { start: number; end: number }): string {
  return ctx.code.slice(span.start, span.end)
}

function generateNodeId(graph: FlowGraph, preferred?: string): string {
  const existing = new Set(graph.nodes.map((n) => n.id))
  if (preferred && !existing.has(preferred)) return preferred
  const allLetters = graph.nodes.length > 0 && graph.nodes.every((n) => /^[A-Z]$/.test(n.id))
  if (allLetters) {
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i)
      if (!existing.has(c)) return c
    }
  }
  let i = 1
  while (existing.has(`n${i}`)) i++
  return `n${i}`
}

function lastRefLine(graph: FlowGraph, ids: string[]): number {
  let last = graph.lastContentLine
  let found = -1
  for (const id of ids) {
    const n = graph.nodeById.get(id)
    if (!n) continue
    for (const r of n.refs) found = Math.max(found, r.lineIndex)
  }
  return found === -1 ? last : found
}

/**
 * Rebuild a chain statement without a node and/or without one specific edge.
 * Returns replacement line texts ([] = drop the line). Preserves the exact
 * source text of surviving refs and edge segments.
 */
function rebuildChain(
  ctx: FlowOpContext,
  lineIndex: number,
  chain: ChainStmt,
  opts: { dropNodeId?: string; dropEdge?: { segIndex: number; source: string; target: string } },
): string[] {
  const line = ctx.lines[lineIndex]
  const indent = line.indent

  interface Expanded {
    a: NodeRef
    b: NodeRef
    segIndex: number
  }
  const expanded: Expanded[] = []
  chain.edges.forEach((_, i) => {
    for (const a of chain.groups[i]) {
      for (const b of chain.groups[i + 1]) {
        expanded.push({ a, b, segIndex: i })
      }
    }
  })

  const kept = expanded.filter((e) => {
    if (opts.dropNodeId && (e.a.id === opts.dropNodeId || e.b.id === opts.dropNodeId)) return false
    if (
      opts.dropEdge &&
      e.segIndex === opts.dropEdge.segIndex &&
      e.a.id === opts.dropEdge.source &&
      e.b.id === opts.dropEdge.target
    ) {
      return false
    }
    return true
  })

  if (kept.length === expanded.length && !opts.dropNodeId) return [line.text]

  const survivors = new Set<NodeRef>()
  for (const e of kept) {
    survivors.add(e.a)
    survivors.add(e.b)
  }

  // re-chain greedily: A-->B-->C stays one line where the refs connect
  const out: string[] = []
  let current = ''
  let lastB: NodeRef | null = null
  for (const e of kept) {
    const segText = slice(ctx, chain.edges[e.segIndex].span)
    if (lastB === e.a && current) {
      current += ` ${segText} ${slice(ctx, e.b.span)}`
    } else {
      if (current) out.push(indent + current)
      current = `${slice(ctx, e.a.span)} ${segText} ${slice(ctx, e.b.span)}`
    }
    lastB = e.b
  }
  if (current) out.push(indent + current)

  // preserve standalone declarations for refs that lost all their edges on this
  // line but carry information (a shape/label) or are defined nowhere else
  for (const group of chain.groups) {
    for (const ref of group) {
      if (ref.id === opts.dropNodeId) continue
      if (survivors.has(ref)) continue
      const node = ctx.graph.nodeById.get(ref.id)
      if (!node) continue
      const shapedElsewhere = node.refs.some((r) => r.ref !== ref && r.ref.shape)
      const referencedElsewhere = node.refs.some((r) => r.lineIndex !== lineIndex || (r.ref !== ref && survivors.has(r.ref)))
      if (ref.shape && !shapedElsewhere) {
        out.push(indent + slice(ctx, ref.span))
      } else if (!referencedElsewhere && !ref.shape) {
        out.push(indent + slice(ctx, ref.span))
      }
    }
  }

  return out
}

function findEdge(graph: FlowGraph, edgeId: string): FlowEdge | null {
  return graph.edges.find((e) => e.entityId === edgeId) ?? null
}

/**
 * `linkStyle <n>` addresses edges by render order, so structural ops that
 * change edge order must renumber (or drop) the affected statements.
 * `map` returns the new index for an old one, or null to delete the line.
 */
function renumberLinkStyles(ctx: FlowOpContext, map: (index: number) => number | null): TextEdit[] {
  const edits: TextEdit[] = []
  for (const [lineIndex, stmt] of ctx.graph.statements) {
    if (stmt.kind !== 'linkStyle') continue
    const line = ctx.lines[lineIndex]
    const m = /^(\s*linkStyle\s+)(\d+)\b/.exec(line.text)
    if (!m) continue
    const oldIndex = Number(m[2])
    const newIndex = map(oldIndex)
    if (newIndex === null) {
      edits.push(deleteLineEdit(ctx, lineIndex))
    } else if (newIndex !== oldIndex) {
      const numStart = line.start + m[1].length
      edits.push({ start: numStart, end: numStart + m[2].length, text: String(newIndex) })
    }
  }
  return edits
}

function nodeOf(graph: FlowGraph, id: string): FlowNode | null {
  return graph.nodeById.get(id) ?? null
}

// ---------- compiler ----------

export function compileFlowchartOp(ctx: FlowOpContext, op: FlowchartOp): OpResult | null {
  const { graph } = ctx

  switch (op.type) {
    case 'addNode': {
      const id = generateNodeId(graph, op.id)
      const shape = op.shape ?? 'rect'
      const label = op.label ?? id
      const { open, close } = SHAPE_DELIMS[shape]
      const text = `${bodyIndent(ctx)}${id}${open}${printLabel(label, false)}${close}`
      const edit = insertLinesAfter(ctx, graph.lastContentLine, [text])
      return { edits: [edit], created: [`node:${id}`] }
    }

    case 'connect': {
      const src = nodeOf(graph, op.source)
      const tgt = nodeOf(graph, op.target)
      if (!src || !tgt) return null
      const opStr = edgeOpString(op.line ?? 'solid', op.arrowEnd ?? 'arrow')
      const label = op.label ? `|${op.label.replace(/\|/g, '')}|` : ''
      const after = lastRefLine(graph, [op.source, op.target])
      const indent = ctx.lines[after].kind === 'statement' ? ctx.lines[after].indent : bodyIndent(ctx)
      const text = `${indent}${op.source} ${opStr}${label} ${op.target}`
      const occ = graph.edges.filter((e) => e.source === op.source && e.target === op.target).length
      // the new edge takes the order index of the first edge on a later line
      const newOrder = graph.edges.filter((e) => e.lineIndex <= after).length
      return {
        edits: [
          insertLinesAfter(ctx, after, [text]),
          ...renumberLinkStyles(ctx, (i) => (i >= newOrder ? i + 1 : i)),
        ],
        created: [`edge:${op.source}->${op.target}#${occ}`],
      }
    }

    case 'renameNode': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      if (node.primary && node.primary.ref.labelSpan) {
        const ref = node.primary.ref
        const span = ref.labelSpan!
        if (ref.quoted) {
          return { edits: [{ start: span.start, end: span.end, text: op.label.replace(/"/g, "'") }] }
        }
        return { edits: [{ start: span.start, end: span.end, text: printLabel(op.label, false) }] }
      }
      // implicit node: attach a rect declaration at its first reference
      const first = node.refs[0]
      if (!first) return null
      const at = first.ref.idSpan.end
      return { edits: [{ start: at, end: at, text: `[${printLabel(op.label, false)}]` }] }
    }

    case 'setNodeShape': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      const { open, close } = SHAPE_DELIMS[op.shape]
      if (node.primary && node.primary.ref.labelSpan) {
        const ref = node.primary.ref
        const oldDelims = SHAPE_DELIMS[ref.shape!]
        const q = ref.quoted ? 1 : 0
        const openStart = ref.idSpan.end
        const openEnd = ref.labelSpan!.start - q
        const closeStart = ref.labelSpan!.end + q
        const closeEnd = closeStart + oldDelims.close.length
        return {
          edits: [
            { start: openStart, end: openEnd, text: open },
            { start: closeStart, end: closeEnd, text: close },
          ],
        }
      }
      const first = node.refs[0]
      if (!first) return null
      const at = first.ref.idSpan.end
      return { edits: [{ start: at, end: at, text: `${open}${printLabel(node.label, false)}${close}` }] }
    }

    case 'setEdgeLabel': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const label = op.label.replace(/\|/g, '')
      if (edge.seg.labelSpan) {
        if (label === '') {
          // remove the label entirely by rewriting the operator
          const opStr = edgeOpString(edge.seg.line, edge.seg.arrowEnd)
          return { edits: [{ start: edge.seg.span.start, end: edge.seg.span.end, text: opStr }] }
        }
        return { edits: [{ start: edge.seg.labelSpan.start, end: edge.seg.labelSpan.end, text: label }] }
      }
      if (label === '') return { edits: [] }
      return { edits: [{ start: edge.seg.span.end, end: edge.seg.span.end, text: `|${label}|` }] }
    }

    case 'setEdgeStyle': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const line = op.line ?? edge.seg.line
      const arrowEnd = op.arrowEnd ?? edge.seg.arrowEnd
      const opStr = edgeOpString(line, arrowEnd)
      const label = edge.seg.label !== null ? `|${edge.seg.label.replace(/\|/g, '')}|` : ''
      return { edits: [{ start: edge.seg.span.start, end: edge.seg.span.end, text: `${opStr}${label}` }] }
    }

    case 'setDirection': {
      if (graph.directionSpan) {
        return { edits: [{ start: graph.directionSpan.start, end: graph.directionSpan.end, text: op.direction }] }
      }
      const header = ctx.lines[graph.headerLine]
      const kwEnd = header.start + header.indent.length + graph.keyword.length
      return { edits: [{ start: kwEnd, end: kwEnd, text: ` ${op.direction}` }] }
    }

    case 'deleteEdge': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const stmt = graph.statements.get(edge.lineIndex)
      if (!stmt || stmt.kind !== 'chain') return null
      const texts = rebuildChain(ctx, edge.lineIndex, stmt, {
        dropEdge: { segIndex: edge.segIndex, source: edge.source, target: edge.target },
      })
      const removed = edge.order
      return {
        edits: [
          replaceLineEdit(ctx, edge.lineIndex, texts),
          ...renumberLinkStyles(ctx, (i) => (i === removed ? null : i > removed ? i - 1 : i)),
        ],
      }
    }

    case 'deleteNode': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      const edits: TextEdit[] = []
      const chainLines = new Set<number>()
      for (const r of node.refs) chainLines.add(r.lineIndex)
      for (const lineIndex of chainLines) {
        const stmt = graph.statements.get(lineIndex)
        if (!stmt || stmt.kind !== 'chain') continue
        const texts = rebuildChain(ctx, lineIndex, stmt, { dropNodeId: op.id })
        edits.push(replaceLineEdit(ctx, lineIndex, texts))
      }
      // clean up class/style/click statements that reference the node
      for (const [lineIndex, stmt] of graph.statements) {
        if (stmt.kind === 'classAssign' && stmt.ids.includes(op.id) && stmt.idsSpan) {
          const remaining = stmt.ids.filter((i) => i !== op.id)
          if (remaining.length === 0) edits.push(deleteLineEdit(ctx, lineIndex))
          else edits.push({ start: stmt.idsSpan.start, end: stmt.idsSpan.end, text: remaining.join(',') })
        } else if ((stmt.kind === 'style' || stmt.kind === 'click') && stmt.ids[0] === op.id) {
          edits.push(deleteLineEdit(ctx, lineIndex))
        }
      }
      const removedOrders = graph.edges
        .filter((e) => e.source === op.id || e.target === op.id)
        .map((e) => e.order)
        .sort((a, b) => a - b)
      edits.push(
        ...renumberLinkStyles(ctx, (i) => {
          if (removedOrders.includes(i)) return null
          return i - removedOrders.filter((r) => r < i).length
        }),
      )
      return { edits }
    }

    case 'duplicateNode': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      const newId = generateNodeId(graph)
      const { open, close } = SHAPE_DELIMS[node.shape]
      const classes = node.classes.length ? `:::${node.classes[0]}` : ''
      const anchor = node.primary?.lineIndex ?? node.refs[0]?.lineIndex ?? graph.lastContentLine
      const indent = ctx.lines[anchor].kind === 'statement' ? ctx.lines[anchor].indent : bodyIndent(ctx)
      const text = `${indent}${newId}${open}${printLabel(node.label, false)}${close}${classes}`
      return {
        edits: [insertLinesAfter(ctx, anchor, [text])],
        created: [`node:${newId}`],
      }
    }

    case 'reverseEdge': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      const stmt = graph.statements.get(edge.lineIndex)
      // only safe on a simple `A --> B` statement — in chains/fans, swapping
      // the two refs would silently rewire the neighbors
      if (!stmt || stmt.kind !== 'chain' || stmt.groups.length !== 2) return null
      if (stmt.groups[0].length !== 1 || stmt.groups[1].length !== 1) return null
      const srcRaw = slice(ctx, edge.sourceRef.span)
      const tgtRaw = slice(ctx, edge.targetRef.span)
      return {
        edits: [
          { start: edge.sourceRef.span.start, end: edge.sourceRef.span.end, text: tgtRaw },
          { start: edge.targetRef.span.start, end: edge.targetRef.span.end, text: srcRaw },
        ],
      }
    }

    case 'setNodeColor': {
      const node = nodeOf(graph, op.id)
      if (!node) return null
      // manage a `style <id> k:v,k:v` statement for this node
      let styleLine = -1
      for (const [lineIndex, stmt] of graph.statements) {
        if (stmt.kind === 'style' && stmt.ids[0] === op.id) {
          styleLine = lineIndex
          break
        }
      }
      const props = new Map<string, string>()
      if (styleLine >= 0) {
        const rest = ctx.lines[styleLine].text.trim().replace(new RegExp(`^style\\s+${op.id}\\s*`), '')
        for (const pair of rest.split(',')) {
          const i = pair.indexOf(':')
          if (i > 0) props.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
        }
      }
      if (op.value === null) props.delete(op.prop)
      else props.set(op.prop, op.value)
      // a readable stroke needs some width; keep mermaid's default otherwise
      if (props.has('stroke') && !props.has('stroke-width')) props.set('stroke-width', '2px')
      if (!props.has('stroke')) props.delete('stroke-width')

      const text = `${styleLine >= 0 ? ctx.lines[styleLine].indent : bodyIndent(ctx)}style ${op.id} ${[...props].map(([k, v]) => `${k}:${v}`).join(',')}`
      if (styleLine >= 0) {
        return { edits: [props.size === 0 ? deleteLineEdit(ctx, styleLine) : replaceLineEdit(ctx, styleLine, [text])] }
      }
      if (props.size === 0) return { edits: [] }
      return { edits: [insertLinesAfter(ctx, graph.lastContentLine, [text])] }
    }

    case 'setEdgeColor': {
      const edge = findEdge(graph, op.edgeId)
      if (!edge) return null
      // linkStyle addresses edges by render index (== document order)
      let linkLine = -1
      for (const [lineIndex, stmt] of graph.statements) {
        if (stmt.kind !== 'linkStyle') continue
        const m = /^linkStyle\s+(\d+)\b/.exec(ctx.lines[lineIndex].text.trim())
        if (m && Number(m[1]) === edge.order) {
          linkLine = lineIndex
          break
        }
      }
      if (op.value === null) {
        if (linkLine === -1) return { edits: [] }
        return { edits: [deleteLineEdit(ctx, linkLine)] }
      }
      const indent = linkLine >= 0 ? ctx.lines[linkLine].indent : bodyIndent(ctx)
      const text = `${indent}linkStyle ${edge.order} stroke:${op.value},stroke-width:2px`
      if (linkLine >= 0) return { edits: [replaceLineEdit(ctx, linkLine, [text])] }
      return { edits: [insertLinesAfter(ctx, graph.lastContentLine, [text])] }
    }

    case 'renameSubgraph': {
      const sg = graph.subgraphs.find((s) => s.id === op.id)
      if (!sg) return null
      if (sg.titleSpan) {
        return { edits: [{ start: sg.titleSpan.start, end: sg.titleSpan.end, text: op.title.replace(/[\]"]/g, '') }] }
      }
      const line = ctx.lines[sg.openLine]
      return { edits: [{ start: line.end, end: line.end, text: ` [${op.title.replace(/[\]"]/g, '')}]` }] }
    }
  }
}
