import type { ClassGraph } from '@visimer/core'
import { addEdgeHitOverlay, type Correlation } from './correlate'
import { decodeEntities } from './correlate.pele'

/**
 * Correlate pele's rendered class-diagram SVG with the semantic graph.
 * Strategy: pele's `data-id` attributes first (class boxes and relation labels
 * via their edge group's data-id), then count-checked zips in document order
 * for leftover classes. Member rows carry no data-id — pele groups ALL
 * attributes before ALL methods (mirroring mermaid's display order), so rows
 * are zipped count-checked per class under mermaid's supplementary tag
 * contract. Relations render as `id_<Src>_<Tgt>_<N>` where N is pele's
 * document-wide counter — the same underscore ambiguity as flowchart's `L_`
 * scheme, so they match by prefix with an unambiguity guard and degrade when
 * the prefix fits more than one relation. Anything ambiguous or
 * count-mismatched degrades to view-only instead of pairing a wrong element.
 */
export function correlatePeleClass(svg: SVGSVGElement, graph: ClassGraph): Correlation {
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

  // --- classes: pele stamps the class's id in data-id on g.pele-node.pele-class.
  // Lollipop interface endpoints render as `pele-interface` scenery core has no
  // entity for — outside this selector, so they can never be claimed, not even
  // by the leftover zip.
  const classEls = [...svg.querySelectorAll<SVGGElement>('g.pele-node.pele-class')]
  const claimed = new Set<Element>()
  for (const cls of graph.classes) {
    const el = classEls.find((e) => !claimed.has(e) && matchesId(e, cls.id))
    if (el) {
      claimed.add(el)
      nodes.set(cls.entityId, el)
      el.setAttribute('data-mw-entity', cls.entityId)
    }
  }

  // leftovers on both sides: equal counts → zip in DOM order, else degrade
  const unmatchedClasses = graph.classes.filter((c) => !nodes.has(c.entityId))
  const unclaimedClassEls = classEls.filter((e) => !claimed.has(e))
  if (unmatchedClasses.length === unclaimedClassEls.length) {
    unmatchedClasses.forEach((c, i) => {
      nodes.set(c.entityId, unclaimedClassEls[i])
      unclaimedClassEls[i].setAttribute('data-mw-entity', c.entityId)
    })
  } else {
    for (const c of unmatchedClasses) failed.push(c.entityId)
  }

  // --- member rows: pele renders member texts without data-id, ALL attributes
  // first then ALL methods — mermaid's display order (correlate.ts tags
  // `.nodeLabel`s in the same attribute-then-method arrangement). Zip
  // count-checked per class against the same split mermaid's correlator uses
  // (`(` marks a method): any disagreement means the row→member mapping could
  // shift onto the wrong line, so the rows degrade — untagged, view-only —
  // while the class box itself stays correlated and selectable.
  //
  // The invariant relied on: pele@1.13.0 classifies a member as method only
  // for balanced parens, so pele-method ⊆ our-method; positional pairing
  // within kind is safe under that invariant — if a pele release changes
  // member classification, the count check degrades here rather than
  // mis-pairs.
  for (const cls of graph.classes) {
    const el = nodes.get(cls.entityId)
    if (!el) continue
    const attrs = cls.members.filter((m) => !m.text.includes('('))
    const methods = cls.members.filter((m) => m.text.includes('('))
    const attrEls = [...el.querySelectorAll('text.pele-member.pele-attribute')]
    const methodEls = [...el.querySelectorAll('text.pele-member.pele-method')]
    if (attrEls.length !== attrs.length || methodEls.length !== methods.length) continue
    attrs.forEach((m, i) => {
      attrEls[i].setAttribute('data-mw-member-class', cls.id)
      attrEls[i].setAttribute('data-mw-member-line', String(m.lineIndex))
    })
    methods.forEach((m, i) => {
      methodEls[i].setAttribute('data-mw-member-class', cls.id)
      methodEls[i].setAttribute('data-mw-member-line', String(m.lineIndex))
    })
  }

  // --- relations: pele renders one g.pele-edge.pele-relation per relation,
  // with data-id `id_<Src>_<Tgt>_<N>` (N is pele's document-wide relation
  // counter, not an occurrence index, and underscore-bearing ids right-parse
  // to phantom pairs — `id_A_B_C_1` may be `A -> B_C` or `A_B -> C`). Match by
  // `id_<src>_<tgt>_` prefix with the flowchart leftover guard: claim a group
  // only when it is the ONLY unclaimed group fitting that relation and it
  // fits no other relation. An ambiguous prefix (duplicate pairs, phantom
  // splits) degrades BOTH sides — never mis-pairs. pele's note edges render
  // as pele-note-edge (outside this selector) and cardinality texts live in a
  // separate positional g.pele-cardinalities group that is never tagged.
  const domEdges = [...svg.querySelectorAll<SVGGElement>('g.pele-edge.pele-relation')]
  const claimedEdges = new Set<Element>()
  const claimEdge = (el: SVGGElement, rel: { entityId: string }): boolean => {
    // the first <path> is the visible line; the pele-marker paths are the
    // arrowhead/diamond/lollipop ornaments
    const path = el.querySelector<SVGPathElement>('path:not(.pele-marker)')
    if (!path) return false
    claimedEdges.add(el)
    edges.set(rel.entityId, path)
    path.setAttribute('data-mw-entity', rel.entityId)
    addEdgeHitOverlay(path, rel.entityId)
    return true
  }
  const fitsRelation = (el: Element, source: string, target: string) =>
    (dataId(el) ?? '').startsWith(`id_${source}_${target}_`)
  for (const rel of graph.relations) {
    const fits = domEdges.filter(
      (e) => !claimedEdges.has(e) && fitsRelation(e, rel.source, rel.target),
    )
    const unambiguous =
      fits.length === 1 &&
      graph.relations.every(
        (other) => other === rel || !fitsRelation(fits[0], other.source, other.target),
      )
    // a claimed-but-pathless group degrades the relation instead of dropping it
    if (!(unambiguous && claimEdge(fits[0], rel))) failed.push(rel.entityId)
  }

  // --- edge labels: pele only renders label groups for labeled relations,
  // with the same data-id as their edge group. Match through the relation's
  // claimed edge group; a count disagreement degrades every label (unmapped)
  // instead of shifting them onto the wrong relation — the relation entity
  // itself may still correlate.
  const labelEls = [...svg.querySelectorAll<SVGGElement>('g.pele-edge-label')]
  const labeledRelations = graph.relations.filter(
    (r) => r.label !== null && r.label !== '' && edges.has(r.entityId),
  )
  if (labelEls.length === labeledRelations.length && labelEls.length > 0) {
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
      for (const rel of labeledRelations) {
        const edgeId = edges.get(rel.entityId)!.closest('g.pele-edge')?.getAttribute('data-id') ?? null
        const label = edgeId ? byEdgeDataId.get(edgeId) : undefined
        if (label) {
          edgeLabels.set(rel.entityId, label)
          label.setAttribute('data-mw-entity', rel.entityId)
        }
      }
    }
  }

  return { nodes, edges, edgeLabels, failed }
}
