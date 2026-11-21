import type { FlowEdge, FlowGraph } from '@visimer/core'
import { addEdgeHitOverlay, type Correlation } from './correlate'

/**
 * Decode the entity encodings pele bakes into `data-id` values (`&quot;`,
 * `&#65;`, ...). The DOM has already decoded the attribute by the time we read
 * it, so the graph id may still be encoded while the attribute is not — decode
 * the graph side for comparison. Unknown entities pass through untouched.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (raw) => {
    switch (raw) {
      case '&amp;':
        return '&'
      case '&lt;':
        return '<'
      case '&gt;':
        return '>'
      case '&quot;':
        return '"'
      case '&apos;':
        return "'"
    }
    const body = raw.slice(2, -1)
    const code = body[0] === 'x' || body[0] === 'X' ? parseInt(body.slice(1), 16) : parseInt(body, 10)
    // String.fromCodePoint throws above 0x10FFFF — leave invalid codes as-is
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
  })
}

/**
 * Pele edge ids are `L_<src>_<tgt>_<count>` where count is per-pair and
 * non-contiguous (first 0, then count+1: 2, 3, ...) — NOT an occurrence index.
 * Parse from the right so underscore-bearing ids split at the right segments:
 * `L_a_b_c_0` yields source `a_b`, target `c`. That can be a PHANTOM pair —
 * the document's real edge may be `a -> b_c`, which pele encodes with the
 * identical string — so callers must treat the parse as a hint, never proof.
 * Ids not following the scheme (user-defined edge ids) return null and stay
 * unclaimed.
 */
function parseEdgeId(dataId: string | null): { source: string; target: string } | null {
  if (!dataId?.startsWith('L_')) return null
  const body = dataId.slice(2)
  const last = body.lastIndexOf('_')
  if (last === -1 || !/^\d+$/.test(body.slice(last + 1))) return null
  const rest = body.slice(0, last)
  const second = rest.lastIndexOf('_')
  if (second <= 0) return null
  return { source: rest.slice(0, second), target: rest.slice(second + 1) }
}

/**
 * Correlate pele's rendered flowchart SVG with the semantic graph.
 * Strategy: pele's `data-id` attributes first, then count-checked per-pair
 * zips, then an ambiguity-guarded leftover pass (underscore ids parse to
 * phantom pairs). Invisible edges never claim a group, and any ambiguous
 * match degrades BOTH sides — never mis-pairs.
 */
export function correlatePeleFlowchart(svg: SVGSVGElement, graph: FlowGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const dataId = (el: Element) => el.getAttribute('data-id')

  // --- nodes: pele stamps the node's entity-decoded id in data-id
  const nodeEls = [...svg.querySelectorAll<SVGGElement>('g.pele-node')]
  const claimed = new Set<Element>()
  for (const node of graph.nodes) {
    const el = nodeEls.find(
      (e) => !claimed.has(e) && (dataId(e) === node.id || dataId(e) === decodeEntities(node.id)),
    )
    if (el) {
      claimed.add(el)
      nodes.set(node.entityId, el)
      el.setAttribute('data-mw-entity', node.entityId)
    }
  }
  // leftovers on both sides: equal counts → zip in DOM order, else degrade
  const unmatchedNodes = graph.nodes.filter((n) => !nodes.has(n.entityId))
  const unclaimedNodeEls = nodeEls.filter((e) => !claimed.has(e))
  if (unmatchedNodes.length === unclaimedNodeEls.length) {
    unmatchedNodes.forEach((n, i) => {
      nodes.set(n.entityId, unclaimedNodeEls[i])
      unclaimedNodeEls[i].setAttribute('data-mw-entity', n.entityId)
    })
  } else {
    for (const n of unmatchedNodes) failed.push(n.entityId)
  }

  // --- clusters: subgraphs render as g.pele-cluster. Struck titles render in
  // a top-level g.pele-cluster-titles OUTSIDE their cluster — tag them too,
  // but don't store them: selection styling queries the live DOM.
  for (const sg of graph.subgraphs) {
    const cluster = [...svg.querySelectorAll<SVGGElement>('g.pele-cluster')].find(
      (el) => dataId(el) === sg.id || dataId(el) === decodeEntities(sg.id),
    )
    if (cluster) {
      cluster.setAttribute('data-mw-entity', sg.entityId)
      nodes.set(sg.entityId, cluster)
    }
    for (const title of svg.querySelectorAll<SVGGElement>('g.pele-cluster-title')) {
      const id = dataId(title)
      if (id === sg.id || id === decodeEntities(sg.id)) {
        title.setAttribute('data-mw-entity', sg.entityId)
      }
    }
  }

  // --- edges: bucket both sides by `source->target`, zip per pair only when
  // the pair's counts agree, store the group's inner <path>. Invisible (`~~~`)
  // core edges are excluded up front: pele never renders them, so they can
  // never claim a group — and counted in, one once let its phantom bucket
  // (L_a_b_c_0 parses as a_b->c) swallow the group rendered for a visible
  // `a --> b_c` and mis-tag that path with the invisible edge.
  const domEdges = [...svg.querySelectorAll<SVGGElement>('g.pele-edge')]
  const claimedEdges = new Set<Element>()
  const domEdgeBuckets = new Map<string, Element[]>()
  for (const el of domEdges) {
    const parsed = parseEdgeId(dataId(el))
    if (!parsed) continue
    const key = `${parsed.source}->${parsed.target}`
    const list = domEdgeBuckets.get(key) ?? []
    list.push(el)
    domEdgeBuckets.set(key, list)
  }
  // core edges bucketed in declaration order (== edges-array order)
  const coreEdgeBuckets = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    if (edge.seg.line === 'invisible') {
      failed.push(edge.entityId)
      continue
    }
    const key = `${edge.source}->${edge.target}`
    const list = coreEdgeBuckets.get(key) ?? []
    list.push(edge)
    coreEdgeBuckets.set(key, list)
  }
  const unmatchedEdges: FlowEdge[] = []
  const claimEdge = (el: Element, edge: FlowEdge): boolean => {
    const path = el.querySelector('path')
    if (!path) return false
    claimedEdges.add(el)
    edges.set(edge.entityId, path)
    path.setAttribute('data-mw-entity', edge.entityId)
    addEdgeHitOverlay(path, edge.entityId)
    return true
  }
  for (const [key, coreList] of coreEdgeBuckets) {
    const domList = domEdgeBuckets.get(key) ?? []
    if (coreList.length === domList.length) {
      coreList.forEach((edge, i) => {
        if (!claimEdge(domList[i], edge)) unmatchedEdges.push(edge)
      })
    } else {
      // a pair whose counts disagree can't be zipped — degrade the pair
      unmatchedEdges.push(...coreList)
    }
  }
  // leftover reconciliation: an underscore id like L_a_b_c_0 right-parses to
  // `a_b -> c`, a phantom bucket, so its group can leave the pair pass
  // unclaimed while its real edge (`a -> b_c`) sits unmatched. Pair the two
  // only when the assignment is unambiguous — the group's data-id starts
  // with `L_<src>_<tgt>_` for that edge, it is the ONLY unclaimed group that
  // fits, and it fits no other unmatched edge. Otherwise degrade both sides:
  // an ambiguous match must never become a wrong pairing.
  const unclaimedEdgeEls = domEdges.filter((e) => !claimedEdges.has(e))
  for (const edge of unmatchedEdges) {
    const fits = unclaimedEdgeEls.filter((el) =>
      (dataId(el) ?? '').startsWith(`L_${edge.source}_${edge.target}_`),
    )
    const unambiguous =
      fits.length === 1 &&
      unmatchedEdges.every(
        (other) => other === edge || !(dataId(fits[0]) ?? '').startsWith(`L_${other.source}_${other.target}_`),
      )
    // a claimed-but-pathless group degrades the edge instead of dropping it
    if (!(unambiguous && claimEdge(fits[0], edge))) failed.push(edge.entityId)
  }

  // --- edge labels: same pairing over g.pele-edge-label, against the pair's
  // labeled core edges. Label misses degrade silently (unmapped) — the edge
  // entity itself may still correlate; mermaid's correlator treats labels the
  // same way.
  const labelEls = [...svg.querySelectorAll<SVGGElement>('g.pele-edge-label')]
  const claimedLabels = new Set<Element>()
  const domLabelBuckets = new Map<string, Element[]>()
  for (const el of labelEls) {
    const parsed = parseEdgeId(dataId(el))
    if (!parsed) continue
    const key = `${parsed.source}->${parsed.target}`
    const list = domLabelBuckets.get(key) ?? []
    list.push(el)
    domLabelBuckets.set(key, list)
  }
  const coreLabelBuckets = new Map<string, FlowEdge[]>()
  for (const edge of graph.edges) {
    if (edge.label === null || edge.label === '') continue
    // invisible edges are view-only under pele — their labels never claim a
    // group, even though pele still renders them (label misses degrade
    // silently, like every other label miss)
    if (edge.seg.line === 'invisible') continue
    const key = `${edge.source}->${edge.target}`
    const list = coreLabelBuckets.get(key) ?? []
    list.push(edge)
    coreLabelBuckets.set(key, list)
  }
  const unmatchedLabelEdges: FlowEdge[] = []
  const claimLabel = (el: Element, edge: FlowEdge): void => {
    if (!el) return
    claimedLabels.add(el)
    edgeLabels.set(edge.entityId, el as SVGGElement)
    el.setAttribute('data-mw-entity', edge.entityId)
  }
  for (const [key, coreList] of coreLabelBuckets) {
    const domList = domLabelBuckets.get(key) ?? []
    if (coreList.length === domList.length) {
      coreList.forEach((edge, i) => claimLabel(domList[i], edge))
    } else {
      unmatchedLabelEdges.push(...coreList)
    }
  }
  // same ambiguity guard as the edge leftovers above, applied to labels
  const unclaimedLabelEls = labelEls.filter((e) => !claimedLabels.has(e))
  for (const edge of unmatchedLabelEdges) {
    const fits = unclaimedLabelEls.filter((el) =>
      (dataId(el) ?? '').startsWith(`L_${edge.source}_${edge.target}_`),
    )
    const unambiguous =
      fits.length === 1 &&
      unmatchedLabelEdges.every(
        (other) => other === edge || !(dataId(fits[0]) ?? '').startsWith(`L_${other.source}_${other.target}_`),
      )
    if (unambiguous) claimLabel(fits[0], edge)
  }

  return { nodes, edges, edgeLabels, failed }
}
