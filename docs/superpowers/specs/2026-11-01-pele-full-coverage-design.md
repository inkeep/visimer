# Pele full-coverage wave — design

Date: 2026-11-01
Status: awaiting approval
Builds on: `docs/superpowers/specs/2026-11-01-pele-renderer-poc-design.md` (approved, implemented on branch `pele-renderer-poc`)

## Intent

The PoC proved the renderer seam and the correlator pattern on flowchart. This
wave makes **every diagram type that is editable under Mermaid editable under
Pele**: sequence, state, class, ER, pie, gantt, and the 15 line-item types.
zenuml stays impossible (external Mermaid plugin; Pele supports no external
diagram types — upstream limitation).

## Why

The user's goal is Obsidian Pele charts being WYSIWYG-editable with Visimer.
The PoC's flowchart-only coverage was scope, not architecture — correlators
are per-diagram-family work, and Mermaid's 22-type coverage represents the
correlator work Visimer already paid against Mermaid's DOM. Pele's documented
`data-id`/`pele-*` contract makes the remaining families tractable, and the
flowchart correlator (`packages/dom/src/correlate.pele.ts`) established the
pattern this wave applies: data-id first, count-checked zips,
ambiguity-guarded leftovers, invisible/unrendered entities never claimable,
degrade-never-mis-pair.

## Goals

1. Under `renderer.id === 'pele'`, all 22 editable types correlate and
   support the full editing loop (select, rename where the type supports it,
   popovers, delete, shared undo) — parity with the mermaid column of the
   README's support table
2. Each family's correlator ships with real-pele-render fixtures including
   at least one adversarial case that would mis-pair under naive matching
3. Existing suites stay green; the mermaid path stays untouched
4. Playground notice updated: all types editable under Pele except zenuml
5. TESTING.md updated: the pele correlator tests cover, per family, the seam
   its map lists as uncovered

## Non-goals

- zenuml (impossible upstream)
- Changes to core (entity ids, graphs, ops are the anchor — if a family's
  core graph proves insufficient mid-wave, stop and rule; a core change is a
  new decision, not an implementation detail)
- New renderer adapters or API changes (the seam from the PoC is final)
- Obsidian integration (separate future project)

## Anti-goals

- Mis-pairing: any ambiguous match degrades BOTH sides to view-only. The
  flowchart Critical (invisible edge + phantom bucket) and the label-pass
  sibling must not get new relatives.
- Scraping pele internals beyond the documented CSS-targeting surface
  (`pele-*` classes, `data-id`) — with one honest caveat below (sequence
  index ids) and its mitigation.
- Duplicating the gesture/popover/ops layers — they key off `data-mw-entity`
  and entity-id prefixes and stay untouched.

## Constraints (from the pele@1.13.0 audit; verify at implementation time)

- **Sequence**: actors carry `data-id` = source participant id (stable);
  lifelines also carry the participant's `data-id` (builder-verified);
  messages/notes/activations are index-based (`i0, i1…` — an internal
  convention, NOT in pele's CSS docs). **Activation rects and destroy
  marks also carry the participant's `data-id`** — they are message-scoped
  scenery core has no entity for, so the correlator must NOT sweep them
  into the participant maps (see §2). Pele draws actor boxes top AND bottom
  (twins), lifelines, activation bars, message arrows, notes, fragment
  bands (fragments ARE parsed by pele). Core's `SequenceGraph`
  (participants + events in declaration order) is the anchor: index zips
  against declaration order are exact WHEN counts match.
- **State**: `pele-state` groups with `data-id` (plus semantic variants
  start/end/choice/fork/join); transitions rendered through the same layered
  engine as flowchart edges (probe their id scheme — likely `L_`-family or
  per-state; count-checked zips either way).
- **Class**: `pele-class[data-id]` groups; relations also carry `data-id`
  (builder-verified); members render as label rows inside the class box —
  pele groups attributes first, then methods, with `pele-attribute`/
  `pele-method` kind classes (builder-verified) — so the correlator mirrors
  mermaid's attribute/method reorder, not raw declaration order.
- **ER**: entities carry `data-id` **keyed by display label** (not source
  id; core's alias syntax makes duplicate labels genuinely producible —
  builder-verified — so the adversarial fixture is buildable); relationship
  lines positional.
- **Pie**: slices `data-id` keyed by label; legend rows text-keyed; core's
  pie graph has slices with label/value. (Builder-verified.)
- **Gantt**: tasks `pele-task[data-id]` (builder-verified present; probe
  whether the id is task name or index), plus `pele-<done|active|crit|
  milestone>` classes; sections positional. **Gridlines can share task
  `data-id`s — the task sweep must class-filter to `pele-task`.**
- **Line-item types** (journey, timeline, quadrant, kanban, mindmap,
  treemap, packet, sankey, radar, gitgraph, xychart, architecture,
  requirement, c4, block): mixed. First-class `data-id` where pele stamps it
  (kanban cards/columns, git commits, sankey nodes/links, mindmap nodes,
  treemap blocks); label/text-keyed elsewhere (journey tasks, timeline
  periods, quadrant points). The mermaid generic correlator
  (`correlateLineItems`) matches core's `item.matchText` against leaf text
  elements — the pele port keeps that approach with pele's class names as
  the leaf filter.
- All families: `decodeEntities` comparison where data-ids may be
  entity-encoded (helper exists in correlate.pele.ts); per-pair/per-group
  count checks before any order zip; leftover passes guarded by
  prefix/text-compatibility + unambiguity, exactly as the flowchart
  correlator does.

## Approaches

One sensible way (the PoC settled it): per-family correlators in dom on the
established pattern, selected by a pele mirror of `bindSvg`'s existing
chain. Considered and rejected: a single generic text-only correlator for
all types (loses edges/structure — most types need node+edge pairing, not
just item text; would recreate mis-pairing risk). A separate
`@visimer/pele` package (parked in the PoC's approaches section for exactly
this moment): still premature — the correlator set belongs beside the
mermaid ones until a third renderer exists.

## The design

### 1. Module layout

- `packages/dom/src/correlate.pele.ts` — keep flowchart (exists); the wave
  adds the other families either in the same module or sibling files
  (`correlate.pele.sequence.ts`, etc.) — implementer's call by size, but
  the `Correlation`/`SequenceCorrelation` contracts are fixed.
- Sequence must return the existing `SequenceCorrelation` shape
  (correlate.ts:464-474: `participants: Map<string, Element[]>` with
  top+bottom twins, `lifelines`, `events`, `eventTexts`) so the view's
  sequence machinery (lifeline UI, visibility retry, message drag) works
  unchanged.

### 2. Per-family correlators

Each follows: probe pele's real output first (the flowchart wave's
probes beat its docs twice); then data-id-first matching with
`decodeEntities`; count-checked zips; guarded leftovers; degrade both
sides on ambiguity. Per family:

- **sequence**: participants = the actor box groups only (`g.pele-actor
  [data-id]`, top+bottom twins both stored, as mermaid does) — activation
  rects, destroy marks, and lifelines are **excluded from the participant
  sweep by class filter** (they carry the same `data-id` but are
  message-scoped scenery core has no entity for; sweeping them would make
  clicking an activation bar select the participant and mis-anchor
  popovers — they stay view-only); lifelines go in the `lifelines` slot
  matched by their own `data-id` (fall back to x-geometry if the probe
  shows gaps); events: zip core's declaration order against
  `pele-message` document order, count-checked — never trust `i0/i1` ids
  beyond using them as a consistency hint; notes positional/data-id per
  the probe. No core change.
- **state**: states by data-id (decode-entities); transitions by the
  probed id scheme with per-pair count checks; choice/fork/join shapes
  are plain states to core.
- **class**: classes by data-id; member rows tagged positionally per class
  (attribute/method order is core's declaration order), count-checked
  against core's member list; member misses degrade the member, not the
  class.
- **ER**: entities by data-id == `decodeEntities(label)`; on duplicate
  labels, count-check the label group and degrade the ambiguity;
  attributes positional per entity (count-checked); relationship lines
  order-zipped against core's erel list.
- **pie**: slices by label-keyed data-id (decode-entities), count-checked
  against core's slice list; legend rows text-matched to the same
  entities.
- **gantt**: tasks by probed id scheme + order zip with count-check;
  sections/milestones follow core's task list.
- **lineItems (15 types)**: port `correlateLineItems` — match
  `item.matchText` against pele's leaf text elements (`.pele-label` and
  per-type text classes), re-enable pointer-events on hit elements as the
  mermaid version does; where a type stamps first-class `data-id`
  (kanban cards, git commits, sankey nodes), prefer it with text as
  fallback; ambiguous text matches (duplicate labels within a type)
  count-check and degrade. Class-filter every data-id sweep (the gantt
  gridline lesson generalizes: pele reuses ids across semantic layers).

### 3. View wiring

`bindSvg`'s pele branch becomes a full mirror of the mermaid chain: for
each slot (sequence/state/classGraph/er/pie/gantt/lineItems) call the
pele correlator for that slot; `null` only for types pele genuinely cannot
render (zenuml — renders nothing; error badge already covers it). The
sequence path reuses `seqCorrelation` + `armVisibilityRetry` (geometry
retry applies to pele lifelines as well — keep it enabled under pele once
sequence correlates).

### 4. Tests

Per family: `packages/dom/test/correlate-pele-<family>.test.ts` with the
established harness (real pele render via the metrics fallback, real core
parse, `correlate()` helper). Each family pins:

1. **Render smoke**: the family's representative sample renders under pele
   without `PeleError` — this is what makes the "all types editable"
   notice honest, and catches any type pele genuinely cannot render
   (beyond zenuml) as a loud stop-and-rule instead of an overclaim.
2. Full correlation on a representative sample.
3. At least one adversarial case that would mis-pair under naive matching
   (sequence: message insertion shifts index ids — assert order zip, not
   id trust; ER: duplicate entity labels via alias syntax; class:
   member-count mismatch; gantt: gridline/task data-id sharing; lineItems:
   duplicate item text within one type) and degrade-not-mis-pair outcomes.
4. **Style-op spot-check where the family has a style-picking action**: emit
   one representative style op, re-render, assert the change is visible in
   the SVG (the flowchart wave proved colors/shapes/arrows/thickness
   round-trip; anything that does NOT round-trip is a stop-and-rule — gate
   it like the animation picker, never ship a silent no-op).

Sequence also pins the twins + lifeline matching and that activation bars
stay untagged (clicking them selects nothing). The acceptance bar per
family is correlation parity + the render smoke + the style spot-check —
NOT a per-action audit of all 22 types; surprises become stop-and-rule
moments, exactly as the flowchart wave handled the animation picker.

### 5. Playground + docs

- Notice copy: "All diagram types are editable under Pele; zenuml is not
  supported."
- TESTING.md: add the pele correlator rung to the seam map.
- README: one line under Architecture that the canvas is
  renderer-swappable (Mermaid or Pele).

### 6. Sequencing for the plan (order is risk-then-volume)

1. state → class → ER (compound-layout families closest to the flowchart
   pattern; probes first)
2. pie + gantt (simple, high fixture value)
3. lineItems (15 types, repetitive; one correlator + per-type fixtures)
4. sequence (most machinery: twins, lifelines, fragments; last, with all
   lessons applied)
5. view dispatch completion + playground notice + TESTING.md/README

Each family = one implementer + one reviewer seat; one commit per family
plus a final wiring/docs commit.

## What's left to the builder

- Per-family probe results (id schemes for state transitions, gantt tasks,
  sequence notes/activations) — probes before code, fixtures pin what the
  probe shows
- Sibling-file vs single-module layout for the new correlators
- Lifeline matching (geometry vs data-id) per the probe
- Per-type lineItem selector lists
