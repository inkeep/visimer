import type { ErGraph } from '@visimer/core'
import { addEdgeHitOverlay, type Correlation } from './correlate'
import { decodeEntities } from './correlate.pele'

/**
 * Correlate pele's rendered er-diagram SVG with the semantic graph.
 * Strategy: pele's `data-id` attributes first for entities (pele keys them by
 * the entity's DISPLAY LABEL, not core's `entity:` id — core's `NAME[alias]`
 * decl syntax re-labels an entity), then a count-checked leftover zip.
 * Duplicate display labels are inherently ambiguous for label-keyed matching,
 * so the colliding entities degrade up front and are excluded from the zip.
 * Relationships match `g.pele-edge.pele-er-*` by document-order count-check
 * against core's `erel` list — pele's `id_entity-…` data-id scheme embeds each
 * entity's label and internal index, so underscore-bearing labels make
 * right-parsing ambiguous and the scheme is treated as a hint, never proof.
 * Attribute rows carry no data-id — pele renders `text.pele-er-*` cells per
 * row, zipped count-checked per entity under mermaid's supplementary tag
 * contract (`data-mw-attr-entity` / `data-mw-attr-line`). Anything ambiguous
 * or count-mismatched degrades to view-only instead of pairing a wrong
 * element.
 */
export function correlatePeleEr(svg: SVGSVGElement, graph: ErGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const dataId = (el: Element) => el.getAttribute('data-id')
  // pele entity-encodes data-id values (`&quot;`, `&#65;`, ...) — compare the
  // decoded label against the DOM-decoded attribute (and the raw one)
  const matchesLabel = (el: Element, label: string) => {
    const dom = dataId(el)
    return dom === label || dom === decodeEntities(label)
  }

  // --- entities: pele stamps the entity's label in data-id on
  // g.pele-node.pele-entity. Core's `NAME[alias]` decl syntax can give TWO
  // entities one display label — label-keyed matching is then ambiguous by
  // construction, so the colliding entities degrade up front and never enter
  // the leftover zip either (zipping entities that display identically could
  // cross-pair them). pele paints the alias as the box text but keeps the
  // NAME in data-id, so a re-labeled entity misses the label pass and is
  // recovered by the count-checked zip below.
  const entityEls = [...svg.querySelectorAll<SVGGElement>('g.pele-node.pele-entity')]
  const labelCount = new Map<string, number>()
  for (const e of graph.entities) {
    const label = decodeEntities(e.label)
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1)
  }
  const claimed = new Set<Element>()
  const unmatched: typeof graph.entities = []
  for (const e of graph.entities) {
    if ((labelCount.get(decodeEntities(e.label)) ?? 0) > 1) {
      // duplicate display label — degrade, never pair
      failed.push(e.entityId)
      continue
    }
    const fits = entityEls.filter((el) => !claimed.has(el) && matchesLabel(el, e.label))
    if (fits.length === 1) {
      claimed.add(fits[0])
      nodes.set(e.entityId, fits[0])
      fits[0].setAttribute('data-mw-entity', e.entityId)
    } else {
      // 0 = pele didn't render the label as-is (alias case); >1 = pele
      // rendered the label more than once (ambiguous) — both go to the zip
      // or degrade below
      unmatched.push(e)
    }
  }

  // leftovers on both sides: equal counts → zip in DOM order, else degrade.
  // Invariant relied on for the positional pairing: pele emits its entity
  // groups in its model's first-mention order, which equals core's
  // entity-array order for the same source (both parsers walk the lines
  // top-down and key entities by first mention) — so the i-th unmatched
  // entity is the i-th unclaimed group. If pele ever reorders its nodes, the
  // label pass still handles the non-aliased case and the count check keeps
  // the zip from firing on partial renders.
  const unclaimedEntityEls = entityEls.filter((el) => !claimed.has(el))
  if (unmatched.length > 0 && unmatched.length === unclaimedEntityEls.length) {
    unmatched.forEach((e, i) => {
      nodes.set(e.entityId, unclaimedEntityEls[i])
      unclaimedEntityEls[i].setAttribute('data-mw-entity', e.entityId)
    })
  } else {
    for (const e of unmatched) failed.push(e.entityId)
  }

  // --- attribute rows: pele renders each attribute as up to four
  // `text.pele-er-*` cells (type, name, keys, comment — empties are skipped)
  // inside g.pele-er-attributes, with NO data-id. All cells of a row share
  // one y, and pele emits rows top-to-bottom in attribute order. Group the
  // texts per row by y, zip count-checked against core's attributes for the
  // same entity under mermaid's supplementary tag contract — data-mw-attr-
  // entity carries the entity's RAW id (mermaid's correlateEr tags
  // `entity.id` and the view's attr-edit routing looks it up in
  // er.entityById), data-mw-attr-line the attribute's line index. Any count
  // disagreement means the row→attribute mapping could shift onto the wrong
  // line, so the rows degrade — untagged, view-only — while the entity box
  // itself stays correlated and selectable. pele's chrome (row stripes in
  // g.pele-er-stripes, the path.pele-er-divider, the pele-label title) sits
  // outside this selector and is never tagged.
  for (const e of graph.entities) {
    const el = nodes.get(e.entityId)
    if (!el || !e.attributes.length) continue
    const rows = new Map<string, SVGTextElement[]>()
    for (const t of el.querySelectorAll<SVGTextElement>('g.pele-er-attributes > text')) {
      const y = t.getAttribute('y') ?? ''
      const row = rows.get(y) ?? []
      row.push(t)
      rows.set(y, row)
    }
    const rowList = [...rows.values()]
    if (rowList.length !== e.attributes.length) continue
    e.attributes.forEach((attr, i) => {
      for (const t of rowList[i]) {
        t.setAttribute('data-mw-attr-entity', e.id)
        t.setAttribute('data-mw-attr-line', String(attr.lineIndex))
      }
    })
  }

  // --- relationships: pele renders one g.pele-edge per relationship, classed
  // pele-er-identifying (`--`) or pele-er-non-identifying (`..`), with data-id
  // `id_entity-<label>-<idx>_entity-<label>-<idx>_<n>`. The scheme embeds each
  // entity's label and internal index, so underscore-bearing labels make
  // right-parsing ambiguous (`id_entity-A_B-0_…` may be `A_B -> C` or
  // `A -> B_C`) — treat the id as a HINT only and match by document-order
  // count-check against core's erel list (order + count is truth). pele emits
  // relationships in source order, which equals core's relation-array order
  // for the same source. A count disagreement means the zip could shift
  // pairings — degrade every relationship rather than risk mis-zipping.
  const domEdges = [
    ...svg.querySelectorAll<SVGGElement>(
      'g.pele-edge.pele-er-identifying, g.pele-edge.pele-er-non-identifying',
    ),
  ]
  if (domEdges.length === graph.relations.length) {
    graph.relations.forEach((r, i) => {
      // the first <path> is the visible line; pele-marker paths/circles are
      // the crow's-foot ornaments
      const path = domEdges[i].querySelector<SVGPathElement>('path:not(.pele-marker)')
      if (!path) {
        failed.push(r.entityId)
        return
      }
      edges.set(r.entityId, path)
      path.setAttribute('data-mw-entity', r.entityId)
      addEdgeHitOverlay(path, r.entityId)
    })
  } else {
    for (const r of graph.relations) failed.push(r.entityId)
  }

  // --- edge labels: pele renders label groups for relationships it draws a
  // role text for, with the same data-id as their edge group. Match through
  // the relationship's claimed edge group (anchored by the document-order
  // zip above, never by parsing the id); a count disagreement degrades every
  // label (unmapped) instead of shifting them onto the wrong relationship —
  // the relationship entity itself may still correlate.
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
      for (const r of labeledRelations) {
        const edgeId = edges.get(r.entityId)!.closest('g.pele-edge')?.getAttribute('data-id') ?? null
        const label = edgeId ? byEdgeDataId.get(edgeId) : undefined
        if (label) {
          edgeLabels.set(r.entityId, label)
          label.setAttribute('data-mw-entity', r.entityId)
        }
      }
    }
  }

  return { nodes, edges, edgeLabels, failed }
}
