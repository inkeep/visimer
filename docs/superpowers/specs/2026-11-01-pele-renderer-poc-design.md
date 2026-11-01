# Pele renderer PoC — design

Date: 2026-11-01
Status: awaiting approval

## Intent

Visimer's canvas renders through a user-supplied `mermaid` instance and
correlates the rendered SVG back to core's lossless CST to provide WYSIWYG
point editing. **Pele** (github.com/obsidianmd/pele, v1.x) is Obsidian's
from-scratch Mermaid renderer: it consumes the same Mermaid source syntax,
has zero runtime dependencies, is ~230 kB gzipped vs Mermaid's 1.6 MB,
renders synchronously in well under a millisecond, themes via CSS variables
instead of initialize-config, and was recently integrated into Obsidian.

End goal (not this PoC): Visimer editing on top of Pele charts inside
Obsidian. This PoC proves the foundation standalone inside Visimer: that
the renderer is genuinely swappable behind one seam, with the full editing
loop working over a Pele-rendered flowchart, demonstrated side-by-side with
Mermaid in the playground.

## Why it's plausible

An audit of both codebases shows the Mermaid-specific surface of
`@visimer/dom` is small and well-fenced:

- `MermaidLike` (packages/dom/src/view.ts:141) — 3 methods, the only
  mermaid API the view consumes
- The 8 correlator bodies in packages/dom/src/correlate.ts — the only
  mermaid-DOM conventions
- Scattered conventions: per-render re-initialize (mermaid's config is
  module-global), `d${id}` error-element cleanup, font-settle re-render,
  HTML-label in-place editing

Everything downstream — gestures, popovers, selection, hit-testing — keys
off Visimer's own `data-mw-entity` tagging and core's entity-id scheme,
never mermaid's DOM. And Pele's SVG is friendlier to correlate than
Mermaid's: every entity carries a documented `data-id`.

## Goals

1. `@visimer/dom` renders and edits over a user-supplied Pele instance:
   `ViewOptions` gains an optional `renderer` (additive; the `mermaid` path
   is unchanged)
2. Full editing loop over a Pele-rendered flowchart: select, double-click
   rename (overlay editor), drag-to-connect, add/delete nodes and edges,
   popovers, one undo stack shared with the CodeMirror pane
3. Playground shows a Mermaid ⇄ Pele renderer toggle over the same source
   and code pane
4. Correlator tests run against real Pele render output in jsdom (Pele's
   text measurement has a no-DOM fallback) — closing, for the pele family,
   the correlator-seam coverage gap TESTING.md documents
5. Existing mermaid behavior byte-identical: all current suites green
   without modification

## Non-goals

- Obsidian integration (separate design after the PoC)
- Pele correlators beyond flowchart (state/class/ER/sequence are the next
  wave)
- In-place contenteditable editing over SVG text (PoC uses the overlay
  editor; SVG-text in-place is a later UX upgrade)
- Pele hard dependency in any Visimer package (apps add it; packages treat
  it as an optional peer, mirroring mermaid)
- Any change to core's parsing/ops behavior — one exception, below:
  widening `Diagnostic.source`

## Anti-goals

- Duplicating `MermaidCanvasView` or any of the gesture/popover layer for
  Pele — failure even if the demo works
- Correlating against undocumented Pele internals — `data-id` and the
  `pele-*` classes are the documented contract (pele.run/theming);
  scraping undocumented structure would recreate the "highest-risk seam"
  the mermaid correlators already suffer from (TESTING.md:17)
- Breaking or reordering the mermaid path's behavior (its render/config/
  error conventions are load-bearing for existing consumers)

## Constraints

Facts from the Pele v1.13.0 source audit that shape the design:

- `render(source, options?) → { svg, width, height, links }` is
  **synchronous** and **throws** `PeleError { code, type, line, column,
  snippet }` on any syntax/semantic error — there is no partial render.
  Keep-last-good (already the view's behavior: error badge + diagnostics +
  prior SVG stays) covers mid-keystroke typing.
- Flowchart SVG structure (src/diagrams/flowchart/render.ts): role groups
  `g.pele-clusters`, `g.pele-edges`, `g.pele-cluster-titles`,
  `g.pele-edge-labels`, `g.pele-nodes`. Nodes: `g.pele-node
  pele-shape-<shape>` with `data-id="<source id>"` (escaped) and
  `transform="translate(x,y)"`, shapes centered on the group origin.
  Clusters: `g.pele-cluster[data-id="<id>"]`. Edges: `g.pele-edge[data-id]`
  where data-id is the user's `@id` when given, else generated
  `L_<src>_<tgt>_<count>`. Edge labels: `g.pele-edge-label[data-id]` with
  the same id scheme.
- Node/cluster data-ids are source ids (stable); edge data-ids are
  count-based (unstable when a duplicate edge is inserted).
- **Pele does not render invisible (`~~~`) edges at all** (the
  `g.pele-edge` group is gated on `thickness !== 'invisible'`; a labeled
  invisible edge still gets its `g.pele-edge-label`). Mermaid renders
  invisible edges as real clickable paths, so under pele they are
  genuinely view-only — and a naive order-match would pair the wrong core
  edge with a rendered path (mis-correlation that edits the wrong line).
- **Pele filters style declarations through a fixed allowlist**
  (`SHAPE_PROPS`/`TEXT_PROPS`, src/svg/theme.ts): `animation-*`
  declarations are silently dropped, so the edge-animation popover action
  is a silent no-op under pele.
- **Subgraph titles crossed by edges are drawn outside their cluster**,
  in a top-level `g.pele-cluster-titles` as
  `g.pele-cluster-title[data-id="<id>"]`.
- **Core cannot parse edge-id syntax today** (`A e1@--> B` fails at `e1@`
  and the line degrades to unknown, for both renderers equally) — so edge
  `@id` matching is not implementable without a core parse change, which
  the non-goals exclude. Pre-existing limitation, out of PoC scope.
- Labels are plain SVG `<text class="pele-label">` — no foreignObject
  HTML. The view's `editInPlace` already returns false when no HTMLElement
  label is found and falls back to the overlay editor (view.ts:1403) — no
  code change needed for the PoC editing UX.
- Pele's text measurement falls back to a baked-in metrics table when no
  canvas exists, so `render()` works under jsdom — correlator tests get
  real output.
- Pele targets Mermaid 12.1.0 syntax; Visimer apps pin mermaid ^11.16.1
  and core tracks v11 grammar. The flowchart grammar subset in scope is
  stable across both (core already preserves `@{ shape: ... }` attrs raw,
  flowchart/parse.ts:222). If a source uses syntax core can't project, it
  degrades to view-only exactly as today (editor.ts:69-71).
- `Diagnostic.source` in core is `'core' | 'mermaid'`
  (core/src/types.ts:55); a pele render error needs an honest source.
  **Widen the union to `'core' | 'mermaid' | 'pele'`** — the single core
  change, type-only, additive.

## Approaches

Three were considered (agreed in conversation):

1. **Renderer adapter inside `@visimer/dom`** ✅ picked — generalize the
   seam, add a Pele correlator set next to the existing eight, selected by
   adapter id. Proves the exact swappable-seam property the Obsidian goal
   needs, least scaffolding, no new packages. Cost: dom carries a second
   correlator family.
2. **Separate `@visimer/pele` package** — extraction + injection hooks
   before anything renders; premature packaging before the adapter shape is
   proven; revisit for the next wave (sequence/state/class/ER correlators)
   once the seam settles.
3. **Playground-only hack** — proves nothing that carries toward Obsidian;
   dropped.

## The design

### 1. Renderer seam (packages/dom/src/renderer.ts, new file)

`MermaidLike` stays exported for compatibility. New, minimal,
renderer-agnostic adapter:

```ts
export interface RendererAdapter {
  /** correlator family + capability selector */
  readonly id: 'mermaid' | 'pele'
  /** render source to a full SVG document string */
  render(code: string): Promise<{ svg: string }>
  /** validate source; null when no diagnostic */
  validate?(code: string): Promise<{ message: string } | null>
}
```

- `mermaidAdapter(mermaid: MermaidLike, config?): RendererAdapter` —
  wraps today's exact behavior: initialize-per-render (module-global config
  compensation, comment preserved), id generation `mw-render-N`,
  `parse` → `validate`.
- `peleAdapter(pele: PeleLike, options?): RendererAdapter` — wraps
  `pele.render(code, options)` (sync → resolved promise), `PeleError` →
  `{ message }` including line/column. `PeleLike` is a one-method interface
  (`render(source, options?)`), so dom never imports pele.

View integration (packages/dom/src/view.ts):

- `ViewOptions`: `mermaid` becomes optional; new `renderer?:
  RendererAdapter`. Exactly one must be provided (constructor throws a
  clear error otherwise). When `mermaid` is given, the view wraps it in
  `mermaidAdapter` internally — every existing consumer keeps working
  unchanged, and the internal call sequence for mermaid is byte-identical.
- `render()`: calls `this.renderer.render(code)` instead of
  `this.mermaid.render(id, code)`. The `d${id}`/`${id}` error-element
  cleanup (view.ts:848-850) is mermaid-specific → it moves behind adapter
  identity (`if (this.renderer.id === 'mermaid')`) and must not run for
  pele. Implementer's choice: adapter-identity check in the view or a
  `cleanupErrorDom?(id)` hook on the adapter.
- `bindSvg()`: under `renderer.id === 'pele'`, only the flowchart slot
  correlates (`correlatePeleFlowchart`); every other slot → `null`
  correlation (view-only) until the next wave. The mermaid chain is
  untouched.
- `validate()`: delegates to `this.renderer.validate?.(code)`.
- Diagnostic source: `'mermaid'` when `renderer.id === 'mermaid'` else
  `'pele'`.
- `setMermaidConfig`: under pele it no-ops with a console warning (pele
  theming is CSS variables).
- Font-settle re-render stays unconditional: Pele is also text-measured,
  so re-render-on-fonts-settle is equally desirable.

### 2. Pele flowchart correlator (packages/dom/src/correlate.pele.ts, new file)

Same return shape as the mermaid family — the existing `Correlation`
(correlate.ts:12-18) — so `data-mw-entity` tagging, hit overlays, popovers,
and gestures work untouched. Strategy: **data-id first, degrade on miss**
(the inverse of mermaid's convention-scraping):

- Nodes: `g.pele-node[data-id="<id>"]` per core node (`node:A` → `A`).
  Pele escapes ids when writing data-id (`escText`); normalize core's id
  with the same rules before matching (port them into the correlator;
  verify against src/diagrams/flowchart/render.ts:220).
- Clusters/subgraphs: `g.pele-cluster[data-id="<id>"]`, with
  `.pele-cluster-label` for the label. Struck titles in
  `g.pele-cluster-titles` (`g.pele-cluster-title[data-id="<id>"]`) also
  correlate to the subgraph entity, so crossed titles stay clickable and
  renamable.
- Edges: core knows (source, target) and declaration order per pair;
  pele never exposes user edge-ids core could use (core can't parse
  `@id` syntax — see constraints). Match **per (source, target) pair,
  count-checked**: group `g.pele-edge[data-id^="L_<src>_<tgt>"]` in DOM
  order against core's per-pair declaration order — but only when the
  pair's rendered count equals the core count. If pele rendered fewer
  elements than core has edges for a pair (e.g. invisible `~~~` edges,
  which pele does not render), degrade that pair to `failed` rather than
  blind-order-match: a mis-paired edge would edit or delete the wrong
  source line, the worst failure mode for an editor. Invisible edges are
  accepted as view-only under pele.
- Edge labels: `g.pele-edge-label[data-id="<same edge id>"]`, with the
  same per-pair count check.
- Everything unmatched lands in `failed` → view-only, same philosophy as
  today. Degrade, never mis-correlate.

### 3. Editing UX over pele (mostly free)

- Double-click rename: `editInPlace` finds no HTMLElement label in a pele
  node → falls back to `openOverlayEditor` (already renderer-agnostic,
  positioned off the entity bbox). Zero changes; the PoC accepts
  overlay-editor UX.
- Drag-to-connect ghost, add-node, delete, popovers, selection styles,
  hit-walking (`data-mw-entity`) — renderer-agnostic already.
- **One popover action is gated under pele**: the edge-animation picker
  emits `linkStyle N animation-*`, which pele's style allowlist silently
  drops — so under `renderer.id === 'pele'` the animation action is
  hidden and `injectAnimationKeyframes` is skipped. Silent feature loss
  is this codebase's documented highest-risk failure mode
  (TESTING.md:17); gate it instead. Node colors, shapes, arrows,
  thickness, and curve all round-trip under pele and stay enabled.
- `addEdgeHitOverlay` clones visible `<path>` elements; pele edges are
  `<path>` children of `g.pele-edge` (stroke set on the group). Verify
  stroke inheritance produces a sane 14px hit overlay; if not, have the
  clone read effective stroke.

### 4. React plumbing (packages/react/src/index.tsx)

- `MermaidWysiwyg` and `MermaidCanvas`: `mermaid` becomes optional, new
  optional `renderer` prop; exactly one required at runtime. Making
  `mermaid` optional is safe for existing callers (they still pass it) —
  the constructor throws a clear error if neither is given.
- View-recreation effect deps gain `renderer` next to `mermaid`.

### 5. Playground demo (apps/playground)

- Toolbar: renderer toggle `Mermaid | Pele` (default Mermaid, persisted in
  localStorage).
- Pele path: `renderer={peleAdapter(pele, { fontFamily: <INK stack> })}`;
  theme via a `--pele-*` CSS-variable block eyeball-matched to INK_THEME
  (pele's theming docs list the variables).
- Same editor, source, CodeMirror pane, and undo stack across the toggle
  (the editor is renderer-independent — core only).
- Under Pele: non-flowchart types render but are view-only (correlator
  returns null); zenuml samples show a "not supported by pele" notice (pele
  supports no external diagrams).

### 6. Tests

- `packages/dom/test/correlate-pele.test.ts` — the big win: jsdom + real
  `pele.render()` output (metrics fallback makes it deterministic in
  Node). Fixtures: standard flowchart, subgraphs (including a title
  struck by an edge), duplicate A→B edges, invisible `~~~` edges
  (asserting degradation, not mis-pairing), special-char ids, and
  multi-line labels. Assert every entity correlates to the right
  element; assert `failed` on a synthetic id mismatch and on
  count-mismatched pairs.
- `packages/dom/test/renderer.test.ts` — adapter contracts:
  `mermaidAdapter` preserves the call sequence (initialize before every
  render); `peleAdapter` maps `PeleError` → diagnostic; view over a fake
  pele renderer: keep-last-good on throw, overlay fallback, toggle
  re-render.
- Existing suites green unmodified.

### 7. Sequencing (implementation order, one commit each)

1. Renderer seam + `mermaidAdapter` (no behavior change; existing tests
   prove it)
2. `correlate.pele.ts` + correlator tests
3. View wiring: bindSvg dispatch, validate, diagnostic source, error-DOM
   gating (+ core `Diagnostic.source` widening)
4. React optional `renderer` prop
5. Playground toggle + theme

## What's left to the builder

- Exact pele id-escape normalization (port `escText` rules; verify
  special-char ids)
- Verify pele emits a pair's `L_src_tgt_*` groups in declaration order
  (the count-checked order-match assumes it)
- Store the inner `<path>`, not the `g.pele-edge` group, in
  `Correlation.edges` — the overlay editor's `SVGPathElement` midpoint
  branch and the hover-CSS sibling rule depend on it
- Whether `addEdgeHitOverlay` needs an effective-stroke fix for pele's
  group-level stroke
- Pele CSS-variable theme values for the playground (eyeball-match INK)
- Memoize the adapter in the playground so the view isn't recreated per
  React render; zenuml/non-flowchart picker behavior details under pele
