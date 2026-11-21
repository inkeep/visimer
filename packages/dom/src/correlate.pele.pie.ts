import type { PieGraph } from '@visimer/core'
import type { Correlation } from './correlate'
import { decodeEntities } from './correlate.pele'

/**
 * Correlate pele's rendered pie SVG with the semantic graph.
 * Strategy: data-id matching only, no order dependence — pele sorts slices by
 * value before drawing, but BOTH the slices (`path.pele-slice[data-id=<label>]`)
 * and the legend rows (`g.pele-legend-item[data-id=<label>]`) are keyed by the
 * slice's DISPLAY LABEL, so the same entity id pairs both sides. pele keeps
 * one slice per label, so two core slices sharing a display label can never be
 * distinguished: they degrade up front, along with their legend rows, instead
 * of the first one claiming pele's single rendered slice. A slice whose label
 * fits no (or more than one) unclaimed path degrades to view-only rather than
 * pairing a wrong element. A missing legend row degrades silently — the slice
 * path is the interaction target and stays correlated.
 */
export function correlatePelePie(svg: SVGSVGElement, graph: PieGraph): Correlation {
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

  const sliceEls = [...svg.querySelectorAll<SVGGElement>('path.pele-slice')]
  const legendEls = [...svg.querySelectorAll<SVGGElement>('g.pele-legend-item')]
  const claimedLegends = new Set<Element>()

  // duplicate display labels are ambiguous by construction (pele renders one
  // slice per label) — count them up front so colliding slices degrade
  // instead of the first claiming pele's shared path
  const labelCount = new Map<string, number>()
  for (const s of graph.slices) {
    const label = decodeEntities(s.label)
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1)
  }

  for (const slice of graph.slices) {
    if ((labelCount.get(decodeEntities(slice.label)) ?? 0) > 1) {
      // duplicate display label — degrade, never pair
      failed.push(slice.entityId)
      continue
    }
    const fits = sliceEls.filter((el) => matchesLabel(el, slice.label))
    if (fits.length === 1) {
      const el = fits[0]
      nodes.set(slice.entityId, el)
      el.setAttribute('data-mw-entity', slice.entityId)
      // legend rows share the slice's data-id — tag them with the same
      // entity id; a legend miss degrades silently (unmapped)
      for (const legend of legendEls) {
        if (!claimedLegends.has(legend) && matchesLabel(legend, slice.label)) {
          claimedLegends.add(legend)
          legend.setAttribute('data-mw-entity', slice.entityId)
        }
      }
    } else {
      // 0 = pele didn't render the slice (zero-value slices render nothing);
      // >1 = pele rendered the label more than once (ambiguous) — both
      // degrade rather than risk a wrong pairing
      failed.push(slice.entityId)
    }
  }

  return { nodes, edges, edgeLabels, failed }
}
