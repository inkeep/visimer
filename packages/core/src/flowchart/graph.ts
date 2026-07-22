import type { LineInfo, Span } from '../types'
import {
  parseFlowStatement,
  parseFlowHeader,
  type ChainStmt,
  type EdgeSeg,
  type FlowStmt,
  type NodeRef,
  type ShapeId,
} from './parse'

export interface NodeRefSite {
  lineIndex: number
  ref: NodeRef
}

export interface FlowNode {
  /** entity id: `node:<mermaidId>` */
  entityId: string
  id: string
  /** display label (falls back to id) */
  label: string
  shape: ShapeId
  refs: NodeRefSite[]
  /** the ref whose shape/label "wins" (last shaped ref) */
  primary: NodeRefSite | null
  classes: string[]
  subgraph: string | null
}

export interface FlowEdge {
  /** entity id: `edge:<src>-><tgt>#<n>` */
  entityId: string
  source: string
  target: string
  lineIndex: number
  /** index into chain.edges */
  segIndex: number
  seg: EdgeSeg
  sourceRef: NodeRef
  targetRef: NodeRef
  label: string | null
  /** order in document (== mermaid render order) */
  order: number
}

export interface FlowSubgraph {
  entityId: string
  id: string
  title: string | null
  titleSpan: Span | null
  openLine: number
  endLine: number
  parent: string | null
}

export interface FlowGraph {
  keyword: string
  direction: string | null
  directionSpan: Span | null
  headerLine: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  subgraphs: FlowSubgraph[]
  nodeById: Map<string, FlowNode>
  statements: Map<number, FlowStmt>
  /** index of last non-blank content line */
  lastContentLine: number
}

export function buildFlowGraph(lines: LineInfo[], headerIndex: number): FlowGraph {
  const header = parseFlowHeader(lines[headerIndex])
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  const subgraphs: FlowSubgraph[] = []
  const statements = new Map<number, FlowStmt>()
  const sgStack: FlowSubgraph[] = []
  const edgeOccurrence = new Map<string, number>()
  let lastContentLine = headerIndex

  const getNode = (ref: NodeRef, lineIndex: number): FlowNode => {
    let n = nodes.get(ref.id)
    if (!n) {
      n = {
        entityId: `node:${ref.id}`,
        id: ref.id,
        label: ref.id,
        shape: 'rect',
        refs: [],
        primary: null,
        classes: [],
        subgraph: sgStack.length ? sgStack[sgStack.length - 1].id : null,
      }
      nodes.set(ref.id, n)
    }
    n.refs.push({ lineIndex, ref })
    if (ref.shape) {
      n.primary = { lineIndex, ref }
      n.shape = ref.shape
      if (ref.label !== null) n.label = ref.label
    }
    for (const c of ref.classNames) if (!n.classes.includes(c)) n.classes.push(c)
    return n
  }

  for (const line of lines) {
    if (line.index === headerIndex) {
      lastContentLine = line.index
      continue
    }
    if (line.kind !== 'statement') continue
    const stmt = parseFlowStatement(line)
    statements.set(line.index, stmt)
    lastContentLine = line.index

    if (stmt.kind === 'subgraphOpen') {
      const sg: FlowSubgraph = {
        entityId: `subgraph:${stmt.id}`,
        id: stmt.id,
        title: stmt.title,
        titleSpan: stmt.titleSpan,
        openLine: stmt.lineIndex,
        endLine: -1,
        parent: sgStack.length ? sgStack[sgStack.length - 1].id : null,
      }
      subgraphs.push(sg)
      sgStack.push(sg)
    } else if (stmt.kind === 'end') {
      const sg = sgStack.pop()
      if (sg) sg.endLine = stmt.lineIndex
    } else if (stmt.kind === 'chain') {
      for (const group of stmt.groups) {
        for (const ref of group) getNode(ref, stmt.lineIndex)
      }
      stmt.edges.forEach((seg, i) => {
        for (const a of stmt.groups[i]) {
          for (const b of stmt.groups[i + 1]) {
            const key = `${a.id}->${b.id}`
            const occ = edgeOccurrence.get(key) ?? 0
            edgeOccurrence.set(key, occ + 1)
            edges.push({
              entityId: `edge:${key}#${occ}`,
              source: a.id,
              target: b.id,
              lineIndex: stmt.lineIndex,
              segIndex: i,
              seg,
              sourceRef: a,
              targetRef: b,
              label: seg.label,
              order: edges.length,
            })
          }
        }
      })
    } else if (stmt.kind === 'classAssign') {
      const cls = /\s([A-Za-z0-9_-]+)\s*;?\s*$/.exec(line.text)?.[1]
      if (cls) {
        for (const id of stmt.ids) {
          const n = nodes.get(id)
          if (n && !n.classes.includes(cls)) n.classes.push(cls)
        }
      }
    }
  }

  return {
    keyword: header.keyword,
    direction: header.direction,
    directionSpan: header.directionSpan,
    headerLine: headerIndex,
    nodes: [...nodes.values()],
    edges,
    subgraphs,
    nodeById: nodes,
    statements,
    lastContentLine,
  }
}

/** All spans in the document that "belong" to an entity (for code highlighting). */
export function entitySpans(graph: FlowGraph, lines: LineInfo[], entityId: string): Span[] {
  if (entityId.startsWith('node:')) {
    const node = graph.nodeById.get(entityId.slice(5))
    if (!node) return []
    return node.refs.map((r) => r.ref.span)
  }
  if (entityId.startsWith('edge:')) {
    const edge = graph.edges.find((e) => e.entityId === entityId)
    if (!edge) return []
    return [{ start: edge.sourceRef.span.start, end: edge.targetRef.span.end }]
  }
  if (entityId.startsWith('subgraph:')) {
    const sg = graph.subgraphs.find((s) => s.entityId === entityId)
    if (!sg) return []
    const line = lines[sg.openLine]
    return [{ start: line.start + line.indent.length, end: line.end }]
  }
  return []
}

/** Find the entity whose span contains the given text offset (nodes win over edges). */
export function entityAtOffset(graph: FlowGraph, offset: number): string | null {
  for (const node of graph.nodes) {
    for (const r of node.refs) {
      if (offset >= r.ref.span.start && offset <= r.ref.span.end) return node.entityId
    }
  }
  for (const edge of graph.edges) {
    if (offset >= edge.seg.span.start && offset <= edge.seg.span.end) return edge.entityId
    if (offset >= edge.sourceRef.span.start && offset <= edge.targetRef.span.end) return edge.entityId
  }
  return null
}
