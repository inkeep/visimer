import type { SequenceGraph } from '@visimer/core'
import { addEdgeHitOverlay, type SequenceCorrelation } from './correlate'
import { decodeEntities } from './correlate.pele'

/**
 * Correlate pele's rendered sequence-diagram SVG with the semantic graph.
 *
 * Surface (probed against pele@1.13.0, see the test file's sample strings):
 * - actors are `g.pele-node.pele-actor.pele-actor-<kind>[data-id=<id>]` —
 *   TWO groups per participant (a top box and a bottom twin carrying the
 *   extra `pele-actor-footer` class), stamped with the participant's id
 * - lifelines are `path.pele-lifeline[data-id=<id>]`, keyed by their own
 *   data-id (unlike mermaid, which stamps nothing and must match by geometry)
 * - messages are `g.pele-edge.pele-message[data-id=i<N>]` with their labels
 *   in `g.pele-edge-label[data-id=<same i<N>]`; notes are
 *   `g.pele-note[data-id=i<N>]` with their text inside the group
 *
 * The `i<N>` counter is GLOBAL across messages, notes and activations and is
 * non-contiguous per kind (e.g. messages i0, i2, i6 around note i4), so the
 * ids are HINTS ONLY and are never used as event match keys — events zip by
 * document order, count-checked, mirroring mermaid's correlateSequence.
 *
 * Pele renders messages and notes in two separate DOM layers (all messages
 * before all notes, whatever their source interleaving), so a cross-kind
 * document merge can never reproduce core's event order. The machinery
 * therefore mirrors correlateSequence exactly: messages zip against message
 * groups and notes against note groups, each count-checked — a kind whose
 * counts disagree degrades entirely rather than risk a shifted pairing.
 *
 * Lifelines are matched by data-id but only when the svg is laid out, the
 * same guard mermaid's correlator enforces: on a hidden mount every
 * `getBoundingClientRect` is zero, so the view's visibility retry contract
 * (empty lifelines ⇒ re-correlate on reveal) stays intact.
 *
 * Scenery (which core has no entity for) is never tagged: `rect.pele-activation`
 * (which shares the participant's data-id!), destroy marks and `g.pele-frame`
 * fragments — clicking them selects nothing.
 */
export function correlatePeleSequence(svg: SVGSVGElement, graph: SequenceGraph): SequenceCorrelation {
  const participants = new Map<string, Element[]>()
  const lifelines = new Map<string, SVGGeometryElement>()
  const events = new Map<string, Element>()
  const eventTexts = new Map<string, Element>()
  const failed: string[] = []

  const dataId = (el: Element) => el.getAttribute('data-id')
  // pele bakes entity encodings (`&quot;`, `&#65;`, ...) into data-id values;
  // the graph side may still be encoded while the attribute is not
  const matchesId = (elId: string | null, id: string) => elId === id || elId === decodeEntities(id)

  // --- participants: sweep ONLY g.pele-node.pele-actor groups (both twins).
  // The sweep must be class-filtered: rect.pele-activation carries the same
  // data-id as its participant but must never be claimed.
  const actorEls = [...svg.querySelectorAll<SVGGElement>('g.pele-node.pele-actor[data-id]')]
  const claimedActors = new Set<Element>()
  const unmatchedParticipants: SequenceGraph['participants'] = []
  for (const p of graph.participants) {
    const els = actorEls.filter((e) => !claimedActors.has(e) && matchesId(dataId(e), p.id))
    if (els.length) {
      for (const el of els) {
        claimedActors.add(el)
        el.setAttribute('data-mw-entity', p.entityId)
      }
      participants.set(p.entityId, els)
    } else {
      unmatchedParticipants.push(p)
    }
  }
  // leftover: pele may stamp generated ids core cannot name. Zip the
  // leftovers only when the unclaimed groups form exactly as many twin
  // buckets as there are unmatched participants — anything else is
  // unverifiable and degrades (never mis-pairs).
  if (unmatchedParticipants.length) {
    const buckets = new Map<string, Element[]>()
    for (const el of actorEls) {
      if (claimedActors.has(el)) continue
      const id = dataId(el) ?? ''
      const list = buckets.get(id) ?? []
      list.push(el)
      buckets.set(id, list)
    }
    const bucketList = [...buckets.values()]
    if (bucketList.length === unmatchedParticipants.length && bucketList.every((b) => b.length === 2)) {
      bucketList.forEach((els, i) => {
        const p = unmatchedParticipants[i]
        for (const el of els) el.setAttribute('data-mw-entity', p.entityId)
        participants.set(p.entityId, els)
      })
    } else {
      for (const p of unmatchedParticipants) failed.push(p.entityId)
    }
  }

  // --- lifelines: by their own data-id, but only once laid out — a hidden
  // mount must leave the slot empty so the view's visibility retry re-runs
  // correlation on reveal (same predicate as correlateSequence's guard)
  if (svg.getBoundingClientRect().width !== 0) {
    const lifelineEls = [...svg.querySelectorAll<SVGPathElement>('path.pele-lifeline[data-id]')]
    for (const p of graph.participants) {
      const el = lifelineEls.find((e) => matchesId(dataId(e), p.id))
      if (el) lifelines.set(p.entityId, el)
    }
  }

  // --- events: per-kind count-checked order zips (see the doc comment for
  // why pele's layered DOM rules out a cross-kind merge)
  type SeqEvent = SequenceGraph['events'][number]
  const coreMessages = graph.events.filter((e) => e.kind === 'message')
  const coreNotes = graph.events.filter((e) => e.kind === 'note')
  const messageEls = [...svg.querySelectorAll<SVGGElement>('g.pele-edge.pele-message')]
  const noteEls = [...svg.querySelectorAll<SVGGElement>('g.pele-note')]

  /** claimed messages in document order, for the label pass below */
  const claimedMessages: Array<{ ev: SeqEvent; el: Element }> = []

  if (messageEls.length === coreMessages.length) {
    coreMessages.forEach((ev, i) => {
      const el = messageEls[i]
      // the first path is the message line; the arrow marker follows
      const line = el.querySelector('path')
      const primary = line ?? el
      events.set(ev.entityId, primary)
      el.setAttribute('data-mw-entity', ev.entityId)
      if (primary !== el) primary.setAttribute('data-mw-entity', ev.entityId)
      if (line) addEdgeHitOverlay(line, ev.entityId)
      claimedMessages.push({ ev, el })
    })
  } else {
    for (const ev of coreMessages) failed.push(ev.entityId)
  }

  if (noteEls.length === coreNotes.length) {
    coreNotes.forEach((ev, i) => {
      const el = noteEls[i]
      const rect = el.querySelector('rect')
      const text = el.querySelector('text')
      const primary = rect ?? el
      events.set(ev.entityId, primary)
      eventTexts.set(ev.entityId, text ?? primary)
      el.setAttribute('data-mw-entity', ev.entityId)
      if (primary !== el) primary.setAttribute('data-mw-entity', ev.entityId)
      if (text && text !== primary) text.setAttribute('data-mw-entity', ev.entityId)
    })
  } else {
    for (const ev of coreNotes) failed.push(ev.entityId)
  }

  // --- message labels: pair each g.pele-edge-label to its message group by
  // equal data-id when unambiguous (exactly one label and exactly one group
  // share the id); the leftovers fall back to a count-checked document-order
  // zip. Label misses degrade silently — the message itself may still have
  // correlated (mermaid's correlator treats label misses the same way).
  const labelEls = [...svg.querySelectorAll<SVGGElement>('g.pele-edge-label')]
  const labelsById = new Map<string, Element[]>()
  for (const el of labelEls) {
    const id = dataId(el)
    if (id === null) continue
    const list = labelsById.get(id) ?? []
    list.push(el)
    labelsById.set(id, list)
  }
  const messagesById = new Map<string, number>()
  for (const { el } of claimedMessages) {
    const id = dataId(el)
    if (id !== null) messagesById.set(id, (messagesById.get(id) ?? 0) + 1)
  }
  const pairLabel = (msg: { ev: SeqEvent; el: Element }, label: Element): void => {
    const text = label.querySelector('text')
    const primary = text ?? label
    eventTexts.set(msg.ev.entityId, primary)
    label.setAttribute('data-mw-entity', msg.ev.entityId)
    if (primary !== label) primary.setAttribute('data-mw-entity', msg.ev.entityId)
  }
  const unpairedMessages: Array<{ ev: SeqEvent; el: Element }> = []
  const claimedLabels = new Set<Element>()
  for (const msg of claimedMessages) {
    const id = dataId(msg.el)
    const labels = id === null ? [] : labelsById.get(id) ?? []
    // unambiguous: no other message group shares the id, and exactly one
    // label carries it
    if (id !== null && (messagesById.get(id) ?? 0) === 1 && labels.length === 1) {
      claimedLabels.add(labels[0])
      pairLabel(msg, labels[0])
    } else {
      unpairedMessages.push(msg)
    }
  }
  const unpairedLabels = labelEls.filter((l) => !claimedLabels.has(l))
  if (unpairedLabels.length === unpairedMessages.length) {
    unpairedMessages.forEach((msg, i) => pairLabel(msg, unpairedLabels[i]))
  }

  return { participants, lifelines, events, eventTexts, failed }
}
