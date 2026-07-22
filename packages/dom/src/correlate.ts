import type {
  ClassGraph,
  ErGraph,
  FlowGraph,
  GanttGraph,
  LineItemsGraph,
  PieGraph,
  SequenceGraph,
  StateGraph,
} from '@visimer/core'

export interface Correlation {
  nodes: Map<string, SVGGElement>
  edges: Map<string, SVGElement>
  edgeLabels: Map<string, SVGGElement>
  /** entity ids that failed to correlate (degraded to view-only) */
  failed: string[]
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Correlate mermaid's rendered flowchart SVG with the semantic graph.
 * Strategy: id conventions first (`flowchart-<id>-N`, `L_<src>_<tgt>_N`),
 * then order matching as a fallback. Anything unmatched degrades to view-only.
 */
export function correlateFlowchart(svg: SVGSVGElement, graph: FlowGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g.node')]
  const claimed = new Set<Element>()

  for (const node of graph.nodes) {
    const re = new RegExp(`[-_]${esc(node.id)}[-_]\\d+$`)
    const el = nodeEls.find((e) => !claimed.has(e) && re.test(e.id))
    if (el) {
      nodes.set(node.entityId, el)
      claimed.add(el)
      el.setAttribute('data-mw-entity', node.entityId)
    }
  }
  // fallback: order matching for any leftovers
  const unmatchedNodes = graph.nodes.filter((n) => !nodes.has(n.entityId))
  const unclaimedEls = nodeEls.filter((e) => !claimed.has(e))
  if (unmatchedNodes.length === unclaimedEls.length) {
    unmatchedNodes.forEach((n, i) => {
      nodes.set(n.entityId, unclaimedEls[i])
      unclaimedEls[i].setAttribute('data-mw-entity', n.entityId)
    })
  } else {
    for (const n of unmatchedNodes) failed.push(n.entityId)
  }

  const edgeEls = [...svg.querySelectorAll<SVGElement>('.edgePaths > path, path.flowchart-link')]
  const claimedEdges = new Set<Element>()
  for (const edge of graph.edges) {
    const re = new RegExp(`^L[-_]${esc(edge.source)}[-_]${esc(edge.target)}[-_]\\d+`)
    const el = edgeEls.find((e) => !claimedEdges.has(e) && re.test(e.id))
    if (el) {
      edges.set(edge.entityId, el)
      claimedEdges.add(el)
      el.setAttribute('data-mw-entity', edge.entityId)
    }
  }
  const unmatchedEdges = graph.edges.filter((e) => !edges.has(e.entityId))
  const unclaimedEdgeEls = edgeEls.filter((e) => !claimedEdges.has(e))
  if (unmatchedEdges.length === unclaimedEdgeEls.length) {
    unmatchedEdges.forEach((e, i) => {
      edges.set(e.entityId, unclaimedEdgeEls[i])
      unclaimedEdgeEls[i].setAttribute('data-mw-entity', e.entityId)
    })
  } else {
    for (const e of unmatchedEdges) failed.push(e.entityId)
  }

  // subgraphs render as clusters; their ids embed the subgraph id
  for (const sg of graph.subgraphs) {
    const cluster = [...svg.querySelectorAll<SVGGElement>('g.cluster')].find(
      (el) => el.id === sg.id || el.id.includes(sg.id) || el.querySelector('.cluster-label')?.textContent?.trim() === (sg.title ?? sg.id),
    )
    if (cluster && !cluster.hasAttribute('data-mw-entity')) {
      cluster.setAttribute('data-mw-entity', sg.entityId)
      nodes.set(sg.entityId, cluster)
    }
  }

  // edge labels render in edge order; mermaid emits one .edgeLabel per edge
  const labelEls = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
  if (labelEls.length === graph.edges.length) {
    graph.edges.forEach((e, i) => {
      edgeLabels.set(e.entityId, labelEls[i])
      labelEls[i].setAttribute('data-mw-entity', e.entityId)
    })
  } else {
    const labeled = graph.edges.filter((e) => e.label !== null && e.label !== '')
    if (labelEls.length === labeled.length) {
      labeled.forEach((e, i) => {
        edgeLabels.set(e.entityId, labelEls[i])
        labelEls[i].setAttribute('data-mw-entity', e.entityId)
      })
    }
  }

  return { nodes, edges, edgeLabels, failed }
}

/**
 * Correlate mermaid's state-diagram SVG (v2 renders through the same
 * dagre wrapper as flowcharts). Returns the flowchart-shaped Correlation so
 * the same canvas interactions apply; `[*]` pseudo-states stay view-only.
 */
export function correlateState(svg: SVGSVGElement, graph: StateGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g.node')].filter(
    (el) => !/root_start|root_end/.test(el.id),
  )
  const claimed = new Set<Element>()
  for (const state of graph.states) {
    const re = new RegExp(`[-_]${esc(state.id)}[-_]\\d+$`)
    const el = nodeEls.find((e) => !claimed.has(e) && re.test(e.id))
    if (el) {
      nodes.set(state.entityId, el)
      claimed.add(el)
      el.setAttribute('data-mw-entity', state.entityId)
    }
  }
  const unmatched = graph.states.filter((s) => !nodes.has(s.entityId))
  const unclaimed = nodeEls.filter((e) => !claimed.has(e))
  if (unmatched.length === unclaimed.length) {
    unmatched.forEach((s, i) => {
      nodes.set(s.entityId, unclaimed[i])
      unclaimed[i].setAttribute('data-mw-entity', s.entityId)
    })
  } else {
    for (const s of unmatched) failed.push(s.entityId)
  }

  // composite states render as clusters
  for (const state of graph.states.filter((s) => s.isComposite)) {
    const cluster = [...svg.querySelectorAll<SVGGElement>('g.cluster')].find(
      (el) => el.id.includes(state.id) || el.querySelector('.cluster-label, .label-container + *')?.textContent?.trim() === state.label,
    )
    if (cluster && !cluster.hasAttribute('data-mw-entity')) {
      cluster.setAttribute('data-mw-entity', state.entityId)
      nodes.set(state.entityId, cluster)
    }
  }

  // transitions render in document order
  const edgeEls = [...svg.querySelectorAll<SVGElement>('.edgePaths > path, path.transition')]
  if (edgeEls.length === graph.transitions.length) {
    graph.transitions.forEach((t, i) => {
      edges.set(t.entityId, edgeEls[i])
      edgeEls[i].setAttribute('data-mw-entity', t.entityId)
    })
  } else {
    for (const t of graph.transitions) failed.push(t.entityId)
  }

  const labelEls = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
  if (labelEls.length === graph.transitions.length) {
    graph.transitions.forEach((t, i) => {
      edgeLabels.set(t.entityId, labelEls[i])
      labelEls[i].setAttribute('data-mw-entity', t.entityId)
    })
  } else {
    const labeled = graph.transitions.filter((t) => t.label)
    if (labelEls.length === labeled.length) {
      labeled.forEach((t, i) => {
        edgeLabels.set(t.entityId, labelEls[i])
        labelEls[i].setAttribute('data-mw-entity', t.entityId)
      })
    }
  }

  return { nodes, edges, edgeLabels, failed }
}

/** Correlate mermaid's class-diagram SVG (dagre wrapper, like flowcharts). */
export function correlateClass(svg: SVGSVGElement, graph: ClassGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g.node')]
  const claimed = new Set<Element>()
  for (const cls of graph.classes) {
    const re = new RegExp(`[-_]${esc(cls.id)}[-_]\\d+$`)
    const el = nodeEls.find((e) => !claimed.has(e) && re.test(e.id))
    if (el) {
      nodes.set(cls.entityId, el)
      claimed.add(el)
      el.setAttribute('data-mw-entity', cls.entityId)
    }
  }
  const unmatched = graph.classes.filter((c) => !nodes.has(c.entityId))
  const unclaimed = nodeEls.filter((e) => !claimed.has(e))
  if (unmatched.length === unclaimed.length) {
    unmatched.forEach((c, i) => {
      nodes.set(c.entityId, unclaimed[i])
      unclaimed[i].setAttribute('data-mw-entity', c.entityId)
    })
  } else {
    for (const c of unmatched) failed.push(c.entityId)
  }

  // tag member label rows for double-click editing (mermaid displays
  // attributes first, then methods, after the class-name label)
  for (const cls of graph.classes) {
    const el = nodes.get(cls.entityId)
    if (!el) continue
    const labels = [...el.querySelectorAll<HTMLElement>('.nodeLabel')]
    const attrs = cls.members.filter((m) => !m.text.includes('('))
    const methods = cls.members.filter((m) => m.text.includes('('))
    const displayed = [...attrs, ...methods]
    displayed.forEach((m, i) => {
      const lab = labels[i + 1]
      if (lab) {
        lab.setAttribute('data-mw-member-class', cls.id)
        lab.setAttribute('data-mw-member-line', String(m.lineIndex))
      }
    })
  }

  const edgeEls = [...svg.querySelectorAll<SVGElement>('.edgePaths > path, path.relation')]
  if (edgeEls.length === graph.relations.length) {
    graph.relations.forEach((r, i) => {
      edges.set(r.entityId, edgeEls[i])
      edgeEls[i].setAttribute('data-mw-entity', r.entityId)
    })
  } else {
    for (const r of graph.relations) failed.push(r.entityId)
  }

  const labelEls = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
  if (labelEls.length === graph.relations.length) {
    graph.relations.forEach((r, i) => {
      edgeLabels.set(r.entityId, labelEls[i])
      labelEls[i].setAttribute('data-mw-entity', r.entityId)
    })
  }

  return { nodes, edges, edgeLabels, failed }
}

/** Correlate mermaid's ER SVG: entity groups carry `entity-<id>` prefixed ids. */
export function correlateEr(svg: SVGSVGElement, graph: ErGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g[id*="entity"], g.node')]
  const claimed = new Set<Element>()
  for (const entity of graph.entities) {
    const re = new RegExp(`entity-${esc(entity.id)}-|[-_]${esc(entity.id)}[-_]\\d+$`)
    const el = nodeEls.find((e) => !claimed.has(e) && re.test(e.id))
    if (el) {
      nodes.set(entity.entityId, el)
      claimed.add(el)
      el.setAttribute('data-mw-entity', entity.entityId)
    }
  }
  const unmatched = graph.entities.filter((e) => !nodes.has(e.entityId))
  const unclaimed = nodeEls.filter((e) => !claimed.has(e))
  if (unmatched.length && unmatched.length === unclaimed.length) {
    unmatched.forEach((e, i) => {
      nodes.set(e.entityId, unclaimed[i])
      unclaimed[i].setAttribute('data-mw-entity', e.entityId)
    })
  } else {
    for (const e of unmatched) failed.push(e.entityId)
  }

  // tag attribute rows (4 .nodeLabel cells per attribute, after the name label)
  for (const entity of graph.entities) {
    const el = nodes.get(entity.entityId)
    if (!el || !entity.attributes.length) continue
    const labels = [...el.querySelectorAll<HTMLElement>('.nodeLabel')]
    entity.attributes.forEach((attr, i) => {
      for (let cell = 0; cell < 4; cell++) {
        const lab = labels[1 + i * 4 + cell]
        if (lab) {
          lab.setAttribute('data-mw-attr-entity', entity.id)
          lab.setAttribute('data-mw-attr-line', String(attr.lineIndex))
        }
      }
    })
  }

  const edgeEls = [
    ...svg.querySelectorAll<SVGElement>('path.relationshipLine, .er.relationshipLine, .edgePaths > path'),
  ]
  if (edgeEls.length === graph.relations.length) {
    graph.relations.forEach((r, i) => {
      edges.set(r.entityId, edgeEls[i])
      edgeEls[i].setAttribute('data-mw-entity', r.entityId)
    })
  } else {
    for (const r of graph.relations) failed.push(r.entityId)
  }

  const labelEls = [
    ...svg.querySelectorAll<SVGGElement>('.relationshipLabel, .er.relationshipLabel, .edgeLabels > .edgeLabel'),
  ]
  if (labelEls.length === graph.relations.length) {
    graph.relations.forEach((r, i) => {
      edgeLabels.set(r.entityId, labelEls[i])
      labelEls[i].setAttribute('data-mw-entity', r.entityId)
    })
  }

  return { nodes, edges, edgeLabels, failed }
}

/**
 * Correlate mermaid's pie SVG. Mermaid sorts slices by value before drawing,
 * so index matching against the document fails — but the legend rows and the
 * slice paths share d3's draw order, and legend text carries the label.
 */
export function correlatePie(svg: SVGSVGElement, graph: PieGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const paths = [...svg.querySelectorAll<SVGGElement>('.pieCircle')]
  const legends = [...svg.querySelectorAll<SVGGElement>('g.legend')]
  legends.forEach((legend, i) => {
    const text = legend.querySelector('text')?.textContent?.trim() ?? ''
    const slice = graph.slices.find((s) => s.label === text || text.startsWith(`${s.label} `))
    if (!slice) return
    const path = paths[i]
    if (path && !nodes.has(slice.entityId)) {
      nodes.set(slice.entityId, path)
      path.setAttribute('data-mw-entity', slice.entityId)
      legend.setAttribute('data-mw-entity', slice.entityId)
    }
  })
  for (const s of graph.slices) if (!nodes.has(s.entityId)) failed.push(s.entityId)

  return { nodes, edges, edgeLabels, failed }
}

/** Correlate mermaid's gantt SVG: task bars render in document order. */
export function correlateGantt(svg: SVGSVGElement, graph: GanttGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const bars = [...svg.querySelectorAll<SVGGElement>('rect.task')]
  const texts = [...svg.querySelectorAll<SVGGElement>('text.taskText')]
  if (bars.length === graph.tasks.length) {
    graph.tasks.forEach((t, i) => {
      nodes.set(t.entityId, bars[i])
      bars[i].setAttribute('data-mw-entity', t.entityId)
      texts[i]?.setAttribute('data-mw-entity', t.entityId)
    })
  } else {
    for (const t of graph.tasks) failed.push(t.entityId)
  }
  return { nodes, edges, edgeLabels, failed }
}

/**
 * Generic correlation for line-item chart types: match each item's rendered
 * label by text content against the SVG's text-bearing elements. Diagram-type
 * agnostic — items whose label can't be found stay code-only.
 */
export function correlateLineItems(svg: SVGSVGElement, graph: LineItemsGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  // leaf text carriers: svg <text>/<tspan-parents> and html label spans
  const candidates = [...svg.querySelectorAll<Element>('text, span, p, div')].filter(
    (el) => el.children.length === 0 || el.tagName === 'text',
  )
  const claimed = new Set<Element>()

  for (const item of graph.items) {
    if (!item.matchText) {
      failed.push(item.entityId)
      continue
    }
    const target = item.matchText.trim()
    let el =
      candidates.find((c) => !claimed.has(c) && c.textContent?.trim() === target) ??
      candidates.find((c) => !claimed.has(c) && (c.textContent?.trim().startsWith(target) ?? false))
    if (!el) {
      failed.push(item.entityId)
      continue
    }
    claimed.add(el)
    // tag a small ancestor group when available so hit areas include shapes
    let anchor: Element = el
    const parent = el.closest('g') ?? el.parentElement
    if (parent && parent !== svg && (parent.textContent?.trim().length ?? 0) <= target.length + 24) {
      anchor = parent
    }
    anchor.setAttribute('data-mw-entity', item.entityId)
    if (anchor !== el) el.setAttribute('data-mw-entity', item.entityId)
    // several chart renderers disable pointer events on labels — re-enable so
    // the item is clickable (an explicit 'auto' wins over an ancestor 'none')
    for (const target of new Set([anchor, el])) {
      const style = (target as HTMLElement | SVGElement).style
      if (style) style.pointerEvents = 'auto'
    }
    nodes.set(item.entityId, anchor as SVGGElement)
  }

  return { nodes, edges, edgeLabels, failed }
}

export interface SequenceCorrelation {
  /** participant entity id → every SVG element belonging to it (top + bottom boxes) */
  participants: Map<string, Element[]>
  /** participant entity id → lifeline <line> element */
  lifelines: Map<string, SVGLineElement>
  /** event entity id → primary element (message line / note rect) */
  events: Map<string, Element>
  /** event entity id → its text element */
  eventTexts: Map<string, Element>
  failed: string[]
}

/**
 * Correlate mermaid's sequence-diagram SVG. Mermaid renders messages, notes and
 * actors in document order, so index matching is reliable; actor elements also
 * carry a `name` attribute we can key on.
 */
export function correlateSequence(svg: SVGSVGElement, graph: SequenceGraph): SequenceCorrelation {
  const participants = new Map<string, Element[]>()
  const lifelines = new Map<string, SVGLineElement>()
  const events = new Map<string, Element>()
  const eventTexts = new Map<string, Element>()
  const failed: string[] = []

  // --- participants: mermaid stamps `name="<id>"` on actor rects/paths/lines
  for (const p of graph.participants) {
    const els = [...svg.querySelectorAll(`[name="${CSS.escape(p.id)}"]`)]
    if (els.length) {
      participants.set(p.entityId, els)
      for (const el of els) el.setAttribute('data-mw-entity', p.entityId)
      // also tag the text label drawn next to each actor element
      for (const el of els) {
        const g = el.parentElement
        if (g && (g as Element).tagName === 'g') (g as Element).setAttribute('data-mw-entity', p.entityId)
      }
    } else {
      failed.push(p.entityId)
    }
  }

  // --- lifelines: match by x proximity to each participant's box (DOM order
  // of `line.actor-line` is NOT guaranteed to follow declaration order)
  const lifelineEls = [...svg.querySelectorAll<SVGLineElement>('line.actor-line, .actor-line')]
  for (const p of graph.participants) {
    const els = participants.get(p.entityId)
    if (!els?.length) continue
    const box = (els[0] as SVGGraphicsElement).getBoundingClientRect()
    const cx = box.left + box.width / 2
    let best: SVGLineElement | null = null
    let bestDist = Infinity
    for (const l of lifelineEls) {
      const r = l.getBoundingClientRect()
      const d = Math.abs(r.left + r.width / 2 - cx)
      if (d < bestDist) {
        bestDist = d
        best = l as SVGLineElement
      }
    }
    if (best && bestDist < 40) lifelines.set(p.entityId, best)
  }

  // --- messages: text.messageText + messageLine paths, both in message order
  const messages = graph.events.filter((e) => e.kind === 'message')
  const msgTexts = [...svg.querySelectorAll('text.messageText')]
  const msgLines = [...svg.querySelectorAll('.messageLine0, .messageLine1')]
  messages.forEach((ev, i) => {
    const line = msgLines[i]
    const text = msgTexts[i]
    if (line) {
      events.set(ev.entityId, line)
      line.setAttribute('data-mw-entity', ev.entityId)
    } else {
      failed.push(ev.entityId)
    }
    if (text) {
      eventTexts.set(ev.entityId, text)
      text.setAttribute('data-mw-entity', ev.entityId)
    }
  })

  // --- notes: rect.note + text.noteText in note order
  const notes = graph.events.filter((e) => e.kind === 'note')
  const noteRects = [...svg.querySelectorAll('.note')]
  const noteTexts = [...svg.querySelectorAll('.noteText')]
  notes.forEach((ev, i) => {
    const rect = noteRects[i]
    const text = noteTexts[i]
    if (rect) {
      events.set(ev.entityId, rect)
      rect.setAttribute('data-mw-entity', ev.entityId)
      const g = rect.parentElement
      if (g && (g as Element).tagName === 'g') (g as Element).setAttribute('data-mw-entity', ev.entityId)
    } else {
      failed.push(ev.entityId)
    }
    if (text) {
      eventTexts.set(ev.entityId, text)
      text.setAttribute('data-mw-entity', ev.entityId)
    }
  })

  return { participants, lifelines, events, eventTexts, failed }
}
