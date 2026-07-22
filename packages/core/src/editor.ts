import type { Diagnostic, DiagramTypeInfo, LineInfo, Origin, Span, TextEdit } from './types'
import { applyEdits, classifyLines, diffText, scanLines } from './text'
import { detectDiagramType } from './registry'
import { buildFlowGraph, entityAtOffset, entitySpans, type FlowGraph } from './flowchart/graph'
import { compileFlowchartOp, type FlowchartOp, type OpResult } from './flowchart/ops'
import {
  buildSequenceGraph,
  sequenceEntityAt,
  sequenceEntitySpans,
  type SequenceGraph,
} from './sequence/graph'
import { compileSequenceOp, type SequenceOp } from './sequence/ops'
import { buildStateGraph, stateEntityAt, stateEntitySpans, type StateGraph } from './state/graph'
import { compileStateOp, type StateOp } from './state/ops'
import { buildClassGraph, classEntityAt, classEntitySpans, type ClassGraph } from './class/graph'
import { compileClassOp, type ClassOp } from './class/ops'
import { buildErGraph, erEntityAt, erEntitySpans, type ErGraph } from './er/graph'
import { compileErOp, type ErOp } from './er/ops'
import { buildPieGraph, compilePieOp, pieEntityAt, pieEntitySpans, type PieGraph, type PieOp } from './pie/index'
import { buildGanttGraph, compileGanttOp, ganttEntityAt, ganttEntitySpans, type GanttGraph, type GanttOp } from './gantt/index'
import { buildLineItemsGraph, compileLineItemOp, lineItemAt, lineItemSpans, LINE_ITEM_CONFIGS, type LineItemsGraph, type LineItemOp } from './lineitems/index'

export type EditorOp = FlowchartOp | SequenceOp | StateOp | ClassOp | ErOp | PieOp | GanttOp | LineItemOp

export interface ParseResult {
  code: string
  lines: LineInfo[]
  headerIndex: number
  typeInfo: DiagramTypeInfo | null
  /** present when typeInfo.id === 'flowchart' */
  flowchart: FlowGraph | null
  /** present when typeInfo.id === 'sequence' */
  sequence: SequenceGraph | null
  /** present when typeInfo.id === 'state' */
  state: StateGraph | null
  /** present when typeInfo.id === 'class' */
  classGraph: ClassGraph | null
  /** present when typeInfo.id === 'er' */
  er: ErGraph | null
  /** present when typeInfo.id === 'pie' */
  pie: PieGraph | null
  /** present when typeInfo.id === 'gantt' */
  gantt: GanttGraph | null
  /** present for line-item chart types (journey, timeline, kanban, …) */
  lineItems: LineItemsGraph | null
}

export function parse(code: string): ParseResult {
  const lines = scanLines(code)
  const { headerIndex } = classifyLines(lines)
  const typeInfo = headerIndex >= 0 ? detectDiagramType(lines[headerIndex].text) : null
  let flowchart: FlowGraph | null = null
  let sequence: SequenceGraph | null = null
  let state: StateGraph | null = null
  let classGraph: ClassGraph | null = null
  let er: ErGraph | null = null
  let pie: PieGraph | null = null
  let gantt: GanttGraph | null = null
  let lineItems: LineItemsGraph | null = null
  try {
    if (typeInfo?.id === 'flowchart') flowchart = buildFlowGraph(lines, headerIndex)
    else if (typeInfo?.id === 'sequence') sequence = buildSequenceGraph(lines, headerIndex)
    else if (typeInfo?.id === 'state') state = buildStateGraph(lines, headerIndex)
    else if (typeInfo?.id === 'class') classGraph = buildClassGraph(lines, headerIndex)
    else if (typeInfo?.id === 'er') er = buildErGraph(lines, headerIndex)
    else if (typeInfo?.id === 'pie') pie = buildPieGraph(lines, headerIndex)
    else if (typeInfo?.id === 'gantt') gantt = buildGanttGraph(lines, headerIndex)
    else if (typeInfo && LINE_ITEM_CONFIGS[typeInfo.id]) lineItems = buildLineItemsGraph(lines, headerIndex, typeInfo.id)
  } catch {
    // a failed projection degrades that diagram to render-only
  }
  return { code, lines, headerIndex, typeInfo, flowchart, sequence, state, classGraph, er, pie, gantt, lineItems }
}

export interface Transaction {
  edits: TextEdit[]
  inverse: TextEdit[]
  origin: Origin
  selectionBefore: string[]
  selectionAfter: string[]
  time: number
}

export interface ChangeEvent {
  code: string
  edits: TextEdit[]
  origin: Origin
  result: ParseResult
}

export interface SelectionEvent {
  entityIds: string[]
  spans: Span[]
  origin: Origin
}

type EventMap = {
  change: ChangeEvent
  selectionChange: SelectionEvent
  diagnostics: Diagnostic[]
}

type Listener<T> = (payload: T) => void

export interface EditorOptions {
  code?: string
  /** coalesce window for merging consecutive code-typing undo entries, ms */
  coalesceMs?: number
}

/**
 * Headless bidirectional Mermaid editor.
 * Text is the single source of truth; every mutation funnels through text edits.
 */
export class MermaidWysiwygEditor {
  private _code: string
  private _result: ParseResult
  private _selection: string[] = []
  private undoStack: Transaction[] = []
  private redoStack: Transaction[] = []
  private listeners: { [K in keyof EventMap]: Set<Listener<EventMap[K]>> } = {
    change: new Set(),
    selectionChange: new Set(),
    diagnostics: new Set(),
  }
  private coalesceMs: number
  private _diagnostics: Diagnostic[] = []

  constructor(options: EditorOptions = {}) {
    this._code = options.code ?? 'flowchart TD\n  A[Start] --> B[End]'
    this.coalesceMs = options.coalesceMs ?? 750
    this._result = parse(this._code)
  }

  get code(): string {
    return this._code
  }

  get result(): ParseResult {
    return this._result
  }

  get selection(): string[] {
    return this._selection
  }

  get diagnostics(): Diagnostic[] {
    return this._diagnostics
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  on<K extends keyof EventMap>(event: K, fn: Listener<EventMap[K]>): () => void {
    this.listeners[event].add(fn as never)
    return () => this.listeners[event].delete(fn as never)
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
    for (const fn of this.listeners[event]) fn(payload)
  }

  setDiagnostics(diags: Diagnostic[]) {
    this._diagnostics = diags
    this.emit('diagnostics', diags)
  }

  /** Apply raw text edits (the only mutation primitive). */
  applyEdits(edits: TextEdit[], origin: Origin = 'api'): void {
    if (edits.length === 0) return
    const { text, inverse } = applyEdits(this._code, edits)
    if (text === this._code) return
    const txn: Transaction = {
      edits,
      inverse,
      origin,
      selectionBefore: [...this._selection],
      selectionAfter: [...this._selection],
      time: Date.now(),
    }
    this.commit(text, txn, origin)
  }

  /** Replace the whole document; computes a minimal diff for history. */
  setCode(newCode: string, origin: Origin = 'code'): void {
    const diff = diffText(this._code, newCode)
    if (!diff) return
    const { text, inverse } = applyEdits(this._code, [diff])
    const now = Date.now()
    // coalesce rapid typing into one undo entry
    const last = this.undoStack[this.undoStack.length - 1]
    if (
      origin === 'code' &&
      last &&
      last.origin === 'code' &&
      now - last.time < this.coalesceMs &&
      this.redoStack.length === 0
    ) {
      // extend previous txn so one undo step reverts the whole typing burst:
      // recompute forward (beforeLast → new) and backward (new → beforeLast).
      const beforeLast = applyEdits(this._code, last.inverse).text
      const forward = diffText(beforeLast, text)
      const back = diffText(text, beforeLast)
      last.edits = forward ? [forward] : []
      last.inverse = back ? [back] : []
      last.time = now
      this._code = text
      this._result = parse(text)
      this.pruneSelection()
      this.emit('change', { code: text, edits: [diff], origin, result: this._result })
      return
    }
    const txn: Transaction = {
      edits: [diff],
      inverse,
      origin,
      selectionBefore: [...this._selection],
      selectionAfter: [...this._selection],
      time: now,
    }
    this.commit(text, txn, origin)
  }

  private commit(text: string, txn: Transaction, origin: Origin) {
    this._code = text
    this._result = parse(text)
    this.undoStack.push(txn)
    this.redoStack = []
    this.pruneSelection()
    txn.selectionAfter = [...this._selection]
    this.emit('change', { code: text, edits: txn.edits, origin, result: this._result })
  }

  undo(): boolean {
    const txn = this.undoStack.pop()
    if (!txn) return false
    // txn.inverse maps after→before; txn.edits stays valid for redo once we're back at "before"
    const { text } = applyEdits(this._code, txn.inverse)
    this.redoStack.push(txn)
    this._code = text
    this._result = parse(text)
    this._selection = txn.selectionBefore.filter((id) => this.entityExists(id))
    this.emit('change', { code: text, edits: txn.inverse, origin: 'history', result: this._result })
    this.emit('selectionChange', { entityIds: this._selection, spans: this.selectionSpans(), origin: 'history' })
    return true
  }

  redo(): boolean {
    const txn = this.redoStack.pop()
    if (!txn) return false
    const { text } = applyEdits(this._code, txn.edits)
    this.undoStack.push(txn)
    this._code = text
    this._result = parse(text)
    this._selection = txn.selectionAfter.filter((id) => this.entityExists(id))
    this.emit('change', { code: text, edits: txn.edits, origin: 'history', result: this._result })
    this.emit('selectionChange', { entityIds: this._selection, spans: this.selectionSpans(), origin: 'history' })
    return true
  }

  /** Dispatch a semantic op (flowchart, sequence, or state). Returns created entity ids. */
  dispatch(op: EditorOp, origin: Origin = 'canvas'): OpResult | null {
    const { flowchart, sequence, state, classGraph, er, pie, gantt, lineItems, lines } = this._result
    let compiled: OpResult | null = null
    if (op.type.startsWith('seq.')) {
      if (!sequence) return null
      compiled = compileSequenceOp({ code: this._code, lines, graph: sequence }, op as SequenceOp)
    } else if (op.type.startsWith('st.')) {
      if (!state) return null
      compiled = compileStateOp({ code: this._code, lines, graph: state }, op as StateOp)
    } else if (op.type.startsWith('cl.')) {
      if (!classGraph) return null
      compiled = compileClassOp({ code: this._code, lines, graph: classGraph }, op as ClassOp)
    } else if (op.type.startsWith('er.')) {
      if (!er) return null
      compiled = compileErOp({ code: this._code, lines, graph: er }, op as ErOp)
    } else if (op.type.startsWith('pie.')) {
      if (!pie) return null
      compiled = compilePieOp({ code: this._code, lines, graph: pie }, op as PieOp)
    } else if (op.type.startsWith('gantt.')) {
      if (!gantt) return null
      compiled = compileGanttOp({ code: this._code, lines, graph: gantt }, op as GanttOp)
    } else if (op.type.startsWith('li.')) {
      if (!lineItems) return null
      compiled = compileLineItemOp({ code: this._code, lines, graph: lineItems }, op as LineItemOp)
    } else {
      if (!flowchart) return null
      compiled = compileFlowchartOp({ code: this._code, lines, graph: flowchart }, op as FlowchartOp)
    }
    if (!compiled || compiled.edits.length === 0) {
      return compiled
    }
    this.applyEdits(compiled.edits, origin)
    if (compiled.created?.length) {
      this.setSelection(compiled.created, origin)
    }
    return compiled
  }

  /** Delete a mixed selection of entities, sequentially and safely. */
  deleteEntities(entityIds: string[], origin: Origin = 'canvas'): void {
    // delete connections/events first (deleting an endpoint may already remove them)
    const order = (id: string) =>
      id.startsWith('edge:') ||
      id.startsWith('event:') ||
      id.startsWith('trans:') ||
      id.startsWith('rel:') ||
      id.startsWith('erel:')
        ? 0
        : 1
    for (const id of [...entityIds].sort((a, b) => order(a) - order(b))) {
      if (!this.entityExists(id)) continue
      if (id.startsWith('edge:')) this.dispatch({ type: 'deleteEdge', edgeId: id }, origin)
      else if (id.startsWith('node:')) this.dispatch({ type: 'deleteNode', id: id.slice(5) }, origin)
      else if (id.startsWith('event:')) this.dispatch({ type: 'seq.deleteEvent', eventId: id }, origin)
      else if (id.startsWith('participant:')) {
        this.dispatch({ type: 'seq.deleteParticipant', id: id.slice(12) }, origin)
      } else if (id.startsWith('trans:')) this.dispatch({ type: 'st.deleteTransition', transId: id }, origin)
      else if (id.startsWith('state:')) this.dispatch({ type: 'st.deleteState', id: id.slice(6) }, origin)
      else if (id.startsWith('rel:')) this.dispatch({ type: 'cl.deleteRelation', relId: id }, origin)
      else if (id.startsWith('class:')) this.dispatch({ type: 'cl.deleteClass', id: id.slice(6) }, origin)
      else if (id.startsWith('erel:')) this.dispatch({ type: 'er.deleteRelation', relId: id }, origin)
      else if (id.startsWith('entity:')) this.dispatch({ type: 'er.deleteEntity', id: id.slice(7) }, origin)
      else if (id.startsWith('slice:')) this.dispatch({ type: 'pie.deleteSlice', sliceId: id }, origin)
      else if (id.startsWith('task:')) this.dispatch({ type: 'gantt.deleteTask', taskId: id }, origin)
      else if (id.startsWith('item:')) this.dispatch({ type: 'li.deleteItem', itemId: id }, origin)
    }
  }

  entityExists(id: string): boolean {
    const fg = this._result.flowchart
    if (fg) {
      if (id.startsWith('node:')) return fg.nodeById.has(id.slice(5))
      if (id.startsWith('edge:')) return fg.edges.some((e) => e.entityId === id)
      if (id.startsWith('subgraph:')) return fg.subgraphs.some((s) => s.entityId === id)
    }
    const sg = this._result.sequence
    if (sg) {
      if (id.startsWith('participant:')) return sg.participantById.has(id.slice(12))
      if (id.startsWith('event:')) return sg.events.some((e) => e.entityId === id)
    }
    const st = this._result.state
    if (st) {
      if (id.startsWith('state:')) return st.stateById.has(id.slice(6))
      if (id.startsWith('trans:')) return st.transitions.some((t) => t.entityId === id)
    }
    const cg = this._result.classGraph
    if (cg) {
      if (id.startsWith('class:')) return cg.classById.has(id.slice(6))
      if (id.startsWith('rel:')) return cg.relations.some((r) => r.entityId === id)
    }
    const er = this._result.er
    if (er) {
      if (id.startsWith('entity:')) return er.entityById.has(id.slice(7))
      if (id.startsWith('erel:')) return er.relations.some((r) => r.entityId === id)
    }
    const pie = this._result.pie
    if (pie && id.startsWith('slice:')) return pie.slices.some((s) => s.entityId === id)
    const gantt = this._result.gantt
    if (gantt && id.startsWith('task:')) return gantt.tasks.some((t) => t.entityId === id)
    const li = this._result.lineItems
    if (li && id.startsWith('item:')) return li.items.some((i) => i.entityId === id)
    return false
  }

  setSelection(entityIds: string[], origin: Origin = 'api'): void {
    const filtered = entityIds.filter((id) => this.entityExists(id))
    const same = filtered.length === this._selection.length && filtered.every((id, i) => id === this._selection[i])
    if (same) return
    this._selection = filtered
    this.emit('selectionChange', { entityIds: filtered, spans: this.selectionSpans(), origin })
  }

  clearSelection(origin: Origin = 'api'): void {
    this.setSelection([], origin)
  }

  private pruneSelection() {
    this._selection = this._selection.filter((id) => this.entityExists(id))
  }

  selectionSpans(): Span[] {
    return this._selection.flatMap((id) => this.entityRanges(id))
  }

  entityRanges(id: string): Span[] {
    const { flowchart, sequence, state, classGraph, er, pie, gantt, lineItems, lines } = this._result
    if (flowchart) return entitySpans(flowchart, lines, id)
    if (sequence) return sequenceEntitySpans(sequence, lines, id)
    if (state) return stateEntitySpans(state, lines, id)
    if (classGraph) return classEntitySpans(classGraph, lines, id)
    if (er) return erEntitySpans(er, lines, id)
    if (pie) return pieEntitySpans(pie, lines, id)
    if (gantt) return ganttEntitySpans(gantt, lines, id)
    if (lineItems) return lineItemSpans(lineItems, lines, id)
    return []
  }

  /** Entity at a text offset (for code-cursor → canvas selection sync). */
  entityAt(offset: number): string | null {
    const { flowchart, sequence, state, classGraph, er, pie, gantt, lineItems, lines } = this._result
    if (flowchart) return entityAtOffset(flowchart, offset)
    if (sequence) return sequenceEntityAt(sequence, lines, offset)
    if (state) return stateEntityAt(state, lines, offset)
    if (classGraph) return classEntityAt(classGraph, lines, offset)
    if (er) return erEntityAt(er, lines, offset)
    if (pie) return pieEntityAt(pie, lines, offset)
    if (gantt) return ganttEntityAt(gantt, lines, offset)
    if (lineItems) return lineItemAt(lineItems, lines, offset)
    return null
  }
}
