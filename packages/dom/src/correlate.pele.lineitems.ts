import type { LineItem, LineItemsGraph } from '@visimer/core'
import type { Correlation } from './correlate'
import { decodeEntities } from './correlate.pele'

/**
 * Per-type match surface, pinned by probing pele@1.13.0 with the playground
 * sample strings (probe preserved alongside the task brief). Each type lists
 * the class-filtered candidate groups a line item may anchor to; pele reuses
 * class names across semantic layers, so a bare `[data-id]` sweep is never
 * safe (gantt lesson).
 *
 * Match strategy per item: first-class `data-id` compare (with
 * `decodeEntities`) where pele stamps a meaningful id; a text fallback against
 * the group's OWN label texts for groups whose data-id is a generated or
 * unrelated id (kanban card ids, packet bit ranges, timeline events, radar
 * legends, c4 display names, ...); optionally standalone text elements
 * (diagram titles, which pele renders outside any candidate group).
 */
interface TypeSurface {
  /** candidate anchor groups, class-filtered */
  selectors: string[]
  /** also allow title-like text elements outside any candidate group */
  standaloneText?: boolean
  /** derive an extra data-id key from the source line (sankey `A->B` links) */
  linkKeys?: 'sankey'
}

const SURFACES: Record<string, TypeSurface> = {
  // cards g.pele-node.pele-card[data-id=<cardId|label>], columns
  // g.pele-cluster.pele-column[data-id] — card labels wrap across several
  // text.pele-label elements; column labels are text.pele-cluster-label (card
  // labels nest inside the column group)
  kanban: { selectors: ['g.pele-node.pele-card', 'g.pele-cluster.pele-column'] },
  // commits g.pele-commit.pele-commit-<kind>[data-id=<commitId|generated>],
  // branches g.pele-branch[data-id] — commit circles also show their id as text
  gitgraph: { selectors: ['g.pele-commit', 'g.pele-branch'] },
  // tasks g.pele-node.pele-task[data-id=<taskText>], sections
  // g.pele-cluster.pele-section[data-id], title text.pele-title (no data-id,
  // outside any group)
  journey: { selectors: ['g.pele-node.pele-task', 'g.pele-cluster.pele-section'], standaloneText: true },
  // periods g.pele-node.pele-period[data-id=<periodText>]; events carry NO
  // data-id (their label text is the only surface) and nest inside periods
  timeline: { selectors: ['g.pele-node.pele-period', 'g.pele-node.pele-event'], standaloneText: true },
  // links path.pele-sankey-link[data-id=<A>-><B>]; node rects/labels are node
  // scenery a link line must not claim (its matchText is only the source name)
  sankey: { selectors: ['path.pele-sankey-link'], linkKeys: 'sankey' },
  // nodes g.pele-node[data-id=<nodeText>], except the root: pele stamps
  // data-id="root" and the label text carries the actual root label
  mindmap: { selectors: ['g.pele-node'] },
  // sections/leaves g.pele-node.pele-section|pele-leaf[data-id=<name>]
  treemap: { selectors: ['g.pele-node'] },
  // fields g.pele-node[data-id=<bit range>] with the field name as label text
  packet: { selectors: ['g.pele-node'] },
  // axis labels g.pele-axis-label[data-id=<axisId>] (text = axis name), curve
  // legends g.pele-legend-item[data-id=<curveId>] (text = curve name); curve
  // paths carry data-id only, never a match text — not matchable
  radar: { selectors: ['g.pele-axis-label', 'g.pele-legend-item'] },
  // only the title line has a matchable surface: text.pele-title, standalone
  xychart: { selectors: [], standaloneText: true },
  // services g.pele-node.pele-service[data-id=<serviceId>] (label text = display
  // name), groups g.pele-cluster[data-id=<groupId>] (label text = display name)
  architecture: { selectors: ['g.pele-node.pele-service', 'g.pele-cluster'] },
  // requirements/elements g.pele-node.pele-requirement|pele-element[data-id=<name>]
  requirement: { selectors: ['g.pele-node'] },
  // c4 nodes g.pele-node[data-id=<actorId>] with the display name as label text;
  // Rel labels are not item surfaces (duplicate texts degrade anyway)
  c4: { selectors: ['g.pele-node'] },
  // blocks g.pele-node[data-id=<blockId>] (shaped blocks show their label text),
  // container blocks g.pele-cluster[data-id]
  block: { selectors: ['g.pele-node', 'g.pele-cluster'] },
  // points circle.pele-point[data-id=<pointText>]; quadrant tiles are scenery
  quadrant: { selectors: ['circle.pele-point'] },
}

/**
 * Collapse ascii whitespace and trim it from the ends — with an ASCII-only
 * charset, because NBSP is CONTENT here: block diagram labels are `&nbsp;`
 * runs, and a bare `.trim()` would strip them (it treats \u00a0 as whitespace).
 */
function norm(s: string): string {
  return s.replace(/[\t\n\f\r ]+/g, ' ').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
}

/** normalized DOM attribute / text — the parser has already decoded entities */
function domKey(s: string | null): string | null {
  return s === null ? null : norm(s)
}

/** normalized graph-side key — pele bakes entity encodings into source ids */
function graphKey(s: string): string {
  // `&nbsp;` is a real character in labels (block diagram `&nbsp;` runs), but
  // the shared decodeEntities pins it as pass-through (its data-id contract is
  // tested) — decode it here first. `&amp;nbsp;` is unaffected: the replace
  // never matches it and the shared decoder restores the literal.
  return norm(decodeEntities(s.replace(/&nbsp;/g, '\u00a0')))
}

/**
 * Parse the first two CSV fields of a sankey-beta line into pele's link
 * data-id `<A>-><B>`. Handles double-quoted fields (commas inside quotes);
 * single-quoted names stay verbatim — pele keeps them in the data-id too.
 */
function sankeyLinkKey(text: string): string | null {
  const fields: string[] = []
  let i = 0
  while (i < text.length && fields.length < 2) {
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1)
      if (end === -1) return null
      fields.push(text.slice(i + 1, end))
      const comma = text.indexOf(',', end)
      if (comma === -1) break
      i = comma + 1
    } else {
      const end = text.indexOf(',', i)
      if (end === -1) {
        fields.push(text.slice(i))
        break
      }
      fields.push(text.slice(i, end))
      i = end + 1
    }
  }
  const [src, tgt] = fields
  return src && tgt ? `${norm(src)}->${norm(tgt)}` : null
}

interface Candidate {
  el: Element
  dataId: string | null
  /** normalized label text (per label class, joined for wrapped labels) → a representative text element */
  textKeys: Map<string, Element>
}

/**
 * pele wraps long labels two ways: as sibling text elements (kanban cards)
 * and as tspans inside one text element (c4 nodes — where the wrap point
 * swallows the space: "Banking" | "System" concatenates to "BankingSystem").
 * Re-insert the separator on both wrap kinds, then normalize.
 */
function textElementContent(t: Element): string {
  const tspans = t.querySelectorAll('tspan')
  return tspans.length ? [...tspans].map((ts) => ts.textContent ?? '').join(' ') : (t.textContent ?? '')
}

/**
 * Collect a candidate group's OWN label keys: descendant `text` elements whose
 * closest candidate ancestor is the group itself. Card labels nest inside
 * kanban columns and event texts inside timeline periods — the innermost group
 * owns its texts, so a container can never claim a nested item's label.
 * Wrapped labels (same-class text siblings, or tspans within one text) are
 * re-joined per class with spaces.
 */
function textKeysOf(el: Element, allSelectors: string): Map<string, Element> {
  const byClass = new Map<string, Element[]>()
  for (const t of el.querySelectorAll('text')) {
    if (t.closest(allSelectors) !== el) continue
    const cls = t.getAttribute('class') ?? ''
    const list = byClass.get(cls) ?? []
    list.push(t)
    byClass.set(cls, list)
  }
  const keys = new Map<string, Element>()
  for (const [cls, texts] of byClass) {
    const joined = norm(texts.map(textElementContent).join(' '))
    if (joined) keys.set(joined, texts[0])
  }
  return keys
}

/**
 * Tag a hit and re-enable pointer events exactly like mermaid's
 * correlateLineItems: an explicit 'auto' wins over an ancestor 'none'.
 */
function claim(el: Element, entityId: string, textEl: Element | null): void {
  el.setAttribute('data-mw-entity', entityId)
  if (textEl && textEl !== el) textEl.setAttribute('data-mw-entity', entityId)
  for (const target of new Set([el, textEl].filter((t): t is Element => t !== null))) {
    const style = (target as HTMLElement | SVGElement).style
    if (style) style.pointerEvents = 'auto'
  }
}

/**
 * Correlate pele's rendered line-item SVGs (the long tail of chart-style
 * diagram types) with the semantic graph. Mermaid's generic correlator matches
 * `item.matchText` against leaf text elements and re-enables pointer-events on
 * hits; this port keeps that approach but prefers pele's first-class
 * `data-id` stamps and degrades instead of mis-pairing:
 *
 * - an item whose match key is shared by several items degrades (duplicate
 *   item text is unverifiable against the DOM — both sides go view-only);
 * - an item whose key matches several unclaimed candidates is ambiguous and
 *   degrades;
 * - a candidate already claimed by another item can never be claimed twice.
 */
export function correlatePeleLineItems(svg: SVGSVGElement, graph: LineItemsGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  const surface = SURFACES[graph.typeId] ?? { selectors: ['g.pele-node', 'g.pele-cluster'] }

  // --- candidates: one class-filtered sweep per surface selector
  const allSelectors = surface.selectors.join(', ')
  const candidateEls = new Set<Element>()
  for (const sel of surface.selectors) {
    for (const el of svg.querySelectorAll<Element>(sel)) candidateEls.add(el)
  }
  const candidates: Candidate[] = [...candidateEls].map((el) => ({
    el,
    dataId: domKey(el.getAttribute('data-id')),
    textKeys: allSelectors ? textKeysOf(el, allSelectors) : new Map(),
  }))
  const claimed = new Set<Element>()

  // --- per-item keys. matchText drives the data-id and text passes; sankey
  // items additionally derive their exact link key from the source line.
  const itemKeys = new Map<string, string[]>()
  for (const item of graph.items) {
    const keys: string[] = []
    if (surface.linkKeys === 'sankey') {
      const link = sankeyLinkKey(item.text)
      if (link) keys.push(norm(link))
    }
    if (item.matchText) keys.push(graphKey(item.matchText))
    itemKeys.set(item.entityId, keys)
  }

  // items that matched (anchor) or finally degraded; unresolved items still
  // try their keys on the next pass
  const anchors = new Map<string, Element>()
  const resolved = new Set<string>()

  /** key → unresolved items presenting it on this pass */
  const itemsByKey = (presented: (item: LineItem) => string[]): Map<string, LineItem[]> => {
    const map = new Map<string, LineItem[]>()
    for (const item of graph.items) {
      if (resolved.has(item.entityId)) continue
      for (const key of presented(item)) {
        const list = map.get(key) ?? []
        list.push(item)
        map.set(key, list)
      }
    }
    return map
  }

  /**
   * Run one matching pass. `finder` returns the unclaimed candidate hits whose
   * key equals `key`. An item resolves when any of its keys matches uniquely;
   * duplicate-item keys and multi-candidate keys block (degrade) instead of
   * guessing. The key→items snapshot is taken at pass start and does not
   * re-consult `resolved` mid-pass, so an item blocked by a duplicate key can
   * still be rescued by one of its distinct keys later in the same pass
   * (sankey: four lines share the source name "Bio-conversion" but each has a
   * unique `A->B` link key) — the duplicate marking alone never claims
   * anything, so the outcome is order-independent and never mis-pairs.
   */
  const runPass = (
    presented: (item: LineItem) => string[],
    finder: (key: string) => Array<{ el: Element; textEl: Element | null }>,
  ): void => {
    for (const [key, items] of itemsByKey(presented)) {
      if (items.length > 1) {
        // duplicate item text within one type: degrade BOTH sides — zipping
        // identical labels against identical groups is unverifiable
        for (const item of items) resolved.add(item.entityId)
        continue
      }
      const item = items[0]
      const hits = finder(key)
      if (hits.length === 0) continue // key miss — a later pass may still find it
      if (hits.length > 1 || claimed.has(hits[0].el)) {
        // ambiguous surface, or the only matching element is already another
        // item's — never guess, never double-tag
        resolved.add(item.entityId)
        continue
      }
      const hit = hits[0]
      claimed.add(hit.el)
      claim(hit.el, item.entityId, hit.textEl)
      anchors.set(item.entityId, hit.el)
      resolved.add(item.entityId)
    }
  }

  // pass 1: first-class data-id compare (raw or entity-decoded)
  runPass(
    (item) => itemKeys.get(item.entityId) ?? [],
    (key) =>
      candidates
        .filter((c) => !claimed.has(c.el) && (c.dataId === key || c.dataId === graphKey(key)))
        .map((c) => ({ el: c.el, textEl: null })),
  )

  // pass 2: text fallback against the candidates' own label texts
  runPass(
    (item) => (item.matchText ? [graphKey(item.matchText)] : []),
    (key) => {
      const hits: Array<{ el: Element; textEl: Element | null }> = []
      for (const c of candidates) {
        if (claimed.has(c.el)) continue
        const textEl = c.textKeys.get(key)
        if (textEl) hits.push({ el: c.el, textEl })
      }
      return hits
    },
  )

  // pass 3: standalone texts (titles) — text elements outside any candidate
  // group, anchored to a small enclosing group exactly like mermaid's
  // correlateLineItems
  if (surface.standaloneText) {
    const standalone: Array<{ el: Element; anchor: Element; key: string }> = []
    for (const t of svg.querySelectorAll('text')) {
      if (allSelectors && t.closest(allSelectors) !== null) continue
      const key = domKey(textElementContent(t))
      if (!key) continue
      const parent = t.closest('g')
      const anchor =
        parent && parent !== svg && (parent.textContent?.trim().length ?? 0) <= key.length + 24
          ? parent
          : t
      standalone.push({ el: t, anchor, key })
    }
    runPass(
      (item) => (item.matchText ? [graphKey(item.matchText)] : []),
      (key) =>
        standalone
          .filter((s) => !claimed.has(s.anchor) && s.key === key)
          .map((s) => ({ el: s.anchor, textEl: s.el })),
    )
  }

  for (const item of graph.items) {
    const anchor = anchors.get(item.entityId)
    if (anchor) {
      nodes.set(item.entityId, anchor as SVGGElement)
    } else {
      failed.push(item.entityId)
    }
  }

  return { nodes, edges, edgeLabels, failed }
}
