import type { StateGraph } from '@visimer/core'
import { addEdgeHitOverlay, type Correlation } from './correlate'
import { decodeEntities } from './correlate.pele'

/**
 * Correlate pele's rendered state-diagram SVG with the semantic graph.
 * Strategy: pele's `data-id` attributes first (states, the composite cluster,
 * and transition labels via their edge group's data-id), then count-checked
 * zips in document order for transitions. `[*]` pseudo-states render as
 * `pele-state-start`/`pele-state-end` scenery that core excludes from its
 * graph — those elements are never tagged. Any ambiguous or count-mismatched
 * match degrades to view-only instead of pairing a wrong element.
 */
export function correlatePeleState(svg: SVGSVGElement, graph: StateGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const dataId = (el: Element) => el.getAttribute('data-id')
  // pele entity-encodes data-id values (`&quot;`, `&#65;`, ...) — compare the
  // decoded graph id against the DOM-decoded attribute (and the raw one)
  const matchesId = (el: Element, id: string) => {
    const dom = dataId(el)
    return dom === id || dom === decodeEntities(id)
  }

  // --- states: pele stamps the state's id in data-id on g.pele-node.pele-state.
  // The `[*]` pseudo-states render with the pele-state-start/-end classes (no
  // plain `pele-state` class) — filtered out here so scenery can never be
  // claimed, not even by the leftover zip.
  const stateEls = [...svg.querySelectorAll<SVGGElement>('g.pele-node.pele-state')].filter(
    (el) => !el.classList.contains('pele-state-start') && !el.classList.contains('pele-state-end'),
  )
  const claimed = new Set<Element>()
  /** state entityId → the pele-state group pele rendered for it, if any */
  const stateElByEntity = new Map<string, SVGGElement>()
  for (const state of graph.states) {
    const el = stateEls.find((e) => !claimed.has(e) && matchesId(e, state.id))
    if (el) {
      claimed.add(el)
      stateElByEntity.set(state.entityId, el)
      el.setAttribute('data-mw-entity', state.entityId)
    }
  }

  // simple states store their pele-state group directly
  for (const state of graph.states) {
    if (!state.isComposite) {
      const el = stateElByEntity.get(state.entityId)
      if (el) nodes.set(state.entityId, el)
    }
  }

  // --- composites: pele draws the composite as a g.pele-cluster with a
  // .pele-cluster-label inside. The cluster is the composite state's primary
  // element (selection styling paints the whole box); a pele-state group pele
  // may also render stays tagged from the pass above as a click target.
  for (const state of graph.states) {
    if (!state.isComposite) continue
    const cluster = [...svg.querySelectorAll<SVGGElement>('g.pele-cluster.pele-state-composite')].find(
      (el) => !claimed.has(el) && matchesId(el, state.id),
    )
    if (cluster) {
      claimed.add(cluster)
      nodes.set(state.entityId, cluster)
      cluster.setAttribute('data-mw-entity', state.entityId)
      const label = cluster.querySelector('.pele-cluster-label')
      if (label) label.setAttribute('data-mw-entity', state.entityId)
    } else {
      // no cluster: fall back to the pele-state group, if pele rendered one
      const el = stateElByEntity.get(state.entityId)
      if (el) nodes.set(state.entityId, el)
      // neither rendered: unresolved — handled by the degrade pass below
    }
  }

  // leftovers on both sides: equal counts → zip in DOM order, else degrade
  const unmatchedStates = graph.states.filter((s) => !nodes.has(s.entityId))
  const unclaimedStateEls = stateEls.filter((e) => !claimed.has(e))
  if (unmatchedStates.length === unclaimedStateEls.length) {
    unmatchedStates.forEach((s, i) => {
      nodes.set(s.entityId, unclaimedStateEls[i])
      unclaimedStateEls[i].setAttribute('data-mw-entity', s.entityId)
    })
  } else {
    for (const s of unmatchedStates) failed.push(s.entityId)
  }

  // --- transitions: pele renders one g.pele-edge.pele-transition per
  // transition, in document order (core's transitions array order). Note
  // edges (pele-note-edge) and the `[*]` scenery sit outside this set. A
  // count disagreement means the zip could shift pairings — degrade every
  // transition rather than risk mis-zipping.
  const domEdges = [...svg.querySelectorAll<SVGGElement>('g.pele-edge.pele-transition')]
  if (domEdges.length === graph.transitions.length) {
    graph.transitions.forEach((t, i) => {
      const path = visiblePath(domEdges[i])
      if (!path) {
        failed.push(t.entityId)
        return
      }
      edges.set(t.entityId, path)
      path.setAttribute('data-mw-entity', t.entityId)
      addEdgeHitOverlay(path, t.entityId)
    })
  } else {
    for (const t of graph.transitions) failed.push(t.entityId)
  }

  // --- edge labels: pele only renders label groups for labeled transitions,
  // with the same data-id as their edge group. Match through the transition's
  // claimed edge group; a count disagreement degrades every label (unmapped)
  // instead of shifting them onto the wrong transition — the edge entity
  // itself may still correlate.
  const labelEls = [...svg.querySelectorAll<SVGGElement>('g.pele-edge-label')]
  const labeledTransitions = graph.transitions.filter(
    (t) => t.label !== null && t.label !== '' && edges.has(t.entityId),
  )
  if (labelEls.length === labeledTransitions.length && labelEls.length > 0) {
    const byEdgeDataId = new Map<string, SVGGElement>()
    let unique = true
    for (const el of labelEls) {
      const id = dataId(el)
      if (!id || byEdgeDataId.has(id)) {
        unique = false
        break
      }
      byEdgeDataId.set(id, el)
    }
    if (unique) {
      for (const t of labeledTransitions) {
        const edgeId = edges.get(t.entityId)!.closest('g.pele-edge')?.getAttribute('data-id') ?? null
        const label = edgeId ? byEdgeDataId.get(edgeId) : undefined
        if (label) {
          edgeLabels.set(t.entityId, label)
          label.setAttribute('data-mw-entity', t.entityId)
        }
      }
    }
  }

  return { nodes, edges, edgeLabels, failed }
}

/** a pele-transition group's visible line path (never the pele-marker arrowhead) */
function visiblePath(group: SVGGElement): SVGPathElement | null {
  return group.querySelector('path:not(.pele-marker)')
}
