# Pele Renderer PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `@visimer/dom` render and fully WYSIWYG-edit flowcharts through Obsidian's Pele renderer (user-supplied instance), behind a generalized renderer seam, demoed by a playground toggle.

**Architecture:** Generalize dom's private `MermaidLike` usage into a `RendererAdapter` (new `renderer.ts`); the view routes render/validate through it and picks correlators by `adapter.id`. A new `correlate.pele.ts` maps Pele's documented `data-id`/`pele-*` SVG contract onto the existing `Correlation` shape, so gestures/popovers/undo work untouched. Core, CodeMirror, and Monaco are untouched except one type-union widening.

**Tech Stack:** TypeScript (strict, ESM), vitest + jsdom, pnpm workspace, pele v1.13.0 (devDep of `@visimer/dom`, dep of playground only).

**Spec:** `docs/superpowers/specs/2026-11-01-pele-renderer-poc-design.md` — the plan argues from the spec; read both.

## Global Constraints

- Packages never depend on pele: `PeleLike` is a hand-written structural interface in dom; `pele` appears only as a devDependency of `@visimer/dom` (tests) and a dependency of `apps/playground` (demo). Spec anti-goal.
- The mermaid path keeps byte-identical behavior (initialize-at-creation and per-render, temp-element cleanup, validate, config re-init). Existing suites stay green, unmodified. Spec goal 5.
- Never mis-correlate: when a match is ambiguous, the entity degrades to view-only (`failed`) instead of pairing a wrong element. Spec anti-goal.
- Core's only change: `Diagnostic.source` widens to `'core' | 'mermaid' | 'pele'` (packages/core/src/types.ts:55). Spec constraint.
- Entity-id formats from core (flowchart/graph.ts): nodes `node:<id>`, edges `edge:<src>-><tgt>#<occ>`, subgraphs `subgraph:<id>`.
- Test files start with `// @vitest-environment jsdom` and polyfill `CSS.escape` exactly like packages/dom/test/fonts.test.ts:1-10.
- Commands: single file `pnpm --filter @visimer/dom exec vitest run test/<file>`; package suite `pnpm --filter @visimer/dom test` / `--filter @visimer/core test`; everything `pnpm test` / `pnpm typecheck`.
- Commits: one per task, repo style (`feat(dom): …`), on branch `pele-renderer-poc`.

## Review Focus

1. **A pair mixing visible and invisible edges** (pele omits `g.pele-edge` for `~~~`): blind order-matching would pair the wrong core edge with the rendered path and edit/delete the wrong source line. → Task 3, Fixture 4 asserts both edges degrade and the rendered path carries no `data-mw-entity`.
2. **Ids containing underscores** corrupt `L_<src>_<tgt>_<n>` parsing (`L_a_b_c_0` is pair `a→b_c` or `a_b→c`). → Task 3, Fixture 5 asserts correct correlation via the leftover rule.
3. **Entity-coded ids** (`A&quot;q`): pele writes `data-id` entity-decoded, so raw comparison silently degrades nodes to view-only. → Task 3, Fixture 6 + `decodeEntities` helper tests.
4. **Silent no-op of the animation picker under pele** (pele's style allowlist drops `animation-*`). → Task 4 asserts the animation section is absent from edge popover actions and keyframes are not injected.
5. **Pele throws on any mid-keystroke syntax error** (no partial render) — a blank canvas would break the error-tolerance promise. → Task 4 asserts keep-last-good: prior SVG stays, badge shows, diagnostics carry `source: 'pele'`.

---

### Task 1: Renderer adapter module (`renderer.ts`)

**Files:**
- Create: `packages/dom/src/renderer.ts`
- Modify: `packages/dom/src/index.ts` (add exports)
- Modify: `packages/dom/package.json` (devDependency `pele`)
- Test: `packages/dom/test/renderer.test.ts`

**Interfaces:**
- Produces (later tasks rely on exactly these):
  - `interface RendererAdapter { readonly id: 'mermaid' | 'pele'; render(code: string): Promise<{ svg: string }>; validate?(code: string): Promise<{ message: string } | null> }`
  - `interface PeleLike { render(source: string, options?: Record<string, unknown>): { svg: string; [key: string]: unknown }; parse?(text: string): unknown }` (method syntax — bivariance makes the real `pele` module structurally assignable)
  - `mermaidAdapter(mermaid: MermaidLike, config?: Record<string, unknown>): RendererAdapter`
  - `peleAdapter(pele: PeleLike, options?: Record<string, unknown>): RendererAdapter`

- [ ] **Step 1: Write failing tests in `packages/dom/test/renderer.test.ts`**

  jsdom pragma + `CSS.escape` polyfill per Global Constraints. Cases:

  1. `mermaidAdapter` initializes at creation and before every render — fake mermaid records `'initialize'` / `'render:<id>'` into a `calls` array; render twice; assert `calls.filter(c => c.startsWith('render')).length === 2` and every `render` entry is immediately preceded by an `initialize`.
  2. `mermaidAdapter` cleans mermaid's temp error elements — fake `render(id)` appends `<div id="d${id}"></div><div id="${id}"></div>` to `document.body` then throws; `await expect(adapter.render('bad')).rejects.toThrow()`; assert `document.querySelectorAll('[id^="mw-render"], [id^="dmw-render"]').length === 0`.
  3. `mermaidAdapter.validate` resolves `null` on parse success, `{ message }` (first line of the error) on parse throw.
  4. `peleAdapter` wraps synchronous render: fake pele `{ render: (src) => ({ svg: `<svg class="pele">${src}</svg>` }) }` → `await adapter.render('x')` resolves `{ svg }` containing `pele`.
  5. `peleAdapter.validate` maps a pele error to a diagnostic message. Fake `parse` throws `Object.assign(new Error('Parse error on line 2:\n…'), { type: 'flowchart', line: 2, column: 13 })`. Pinned message format: `` `${type} error: ${firstLine}` + (line ? ` (line ${line}, column ${column})` : '') `` → assert `expect.stringContaining('flowchart error: Parse error on line 2:')` and `expect.stringContaining('(line 2, column 13)')`. When the fake pele has no `parse`, `adapter.validate` is `undefined`.
  6. Real-pele smoke: `import { render as peleRender } from 'pele'`; build the `PeleLike` as `{ render: (src, o) => peleRender(src, o) }`; `const adapter = peleAdapter(peleLike)`; `const { svg } = await adapter.render('flowchart LR\n  A --> B')`; assert `svg` contains `class="pele-node` and `data-id="A"`.

- [ ] **Step 2: Run to verify failure**

  Run: `pnpm --filter @visimer/dom exec vitest run test/renderer.test.ts`
  Expected: FAIL — cannot resolve `../src/renderer`.

- [ ] **Step 3: Implement `packages/dom/src/renderer.ts`**

  Module-global render-id counter moved from view.ts (`mw-render-${++n}`, keep the "concurrent views never collide" comment). `mermaidAdapter`: call `initialize(config ?? {})` once at creation and before each `render(id, code)`; on throw, remove `d${id}` and `${id}` elements then rethrow; `validate` wraps `parse` (null on success, `{ message: firstLine }` on throw). `peleAdapter`: `render` returns `{ svg: pele.render(code, options).svg }` (sync → promise); `validate` present iff `pele.parse` exists, message format pinned in Step 1.5. No pele import.

- [ ] **Step 4: Run tests to verify pass**

  Run: `pnpm --filter @visimer/dom exec vitest run test/renderer.test.ts`
  Expected: PASS (all 6 cases)

- [ ] **Step 5: Wire exports + devDep, run full gates**

  `packages/dom/src/index.ts`: export `RendererAdapter`, `PeleLike`, `mermaidAdapter`, `peleAdapter` alongside the existing view exports. Add devDep: `pnpm --filter @visimer/dom add -D pele` (resolves ^1.13.0). Run `pnpm --filter @visimer/dom test` and `pnpm typecheck`.
  Expected: all pass.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/dom/src/renderer.ts packages/dom/src/index.ts packages/dom/package.json packages/dom/test/renderer.test.ts pnpm-lock.yaml
  git commit -m "feat(dom): renderer adapter seam with mermaid and pele adapters"
  ```

### Task 2: View routes through `RendererAdapter`

**Files:**
- Modify: `packages/dom/src/view.ts` (ViewOptions:155-173, constructor, render():793-858, validate():2713-2722, setMermaidConfig():529-534; delete `MermaidLike` usage in those paths — keep the type export)
- Modify: `packages/core/src/types.ts:55` (`Diagnostic.source` widening)
- Test: `packages/dom/test/renderer.test.ts` (extend)

**Interfaces:**
- Consumes: `RendererAdapter`, `mermaidAdapter` (Task 1), `MermaidLike` (existing export, unchanged).
- Produces: `ViewOptions { editor; container; mermaid?: MermaidLike; renderer?: RendererAdapter; mermaidConfig?; … }` — exactly one of `mermaid`/`renderer` required (constructor throws `Error('MermaidCanvasView: pass exactly one of `mermaid` or `renderer`')`); view keeps `private renderer: RendererAdapter` and `private mermaidInstance: MermaidLike | null`; render-error and validate diagnostics carry `source: this.renderer.id`.

- [ ] **Step 1: Write failing tests (extend `renderer.test.ts`)**

  1. View renders through a custom adapter: fake `RendererAdapter` (`id: 'pele'`, render returns `<svg>…</svg>`); construct `MermaidCanvasView` with `renderer` and no `mermaid`; assert container's `svgHost` contains the fake svg after the initial render (await the view's `'render'` event).
  2. Exactly-one enforcement: constructor without either option throws; with both throws.
  3. Mermaid call-order preserved: fake mermaid (fonts.test.ts pattern) records calls; construct view (initialize #1 at construction), then `editor.setCode('flowchart LR\n  A --> B\n  A --> C\n', 'external')` and await render → initialize #2 precedes render.
  4. Diagnostics source follows the adapter: fake adapter with `id: 'pele'` whose `render` rejects → after render settles, `view.renderError` truthy and `editor` diagnostics contain `{ source: 'pele' }` (read via the view's render error path; assert through `editor`'s diagnostics getter or the `'render'` event payload `{ ok: false }`).
  5. `setMermaidConfig` no-ops under a non-mermaid adapter: fake `id: 'pele'` adapter records render calls; `view.setMermaidConfig({ theme: 'dark' })` → `console.warn` spy called once, no additional render, `view.renderError` unchanged.

- [ ] **Step 2: Run to verify failure**

  Run: `pnpm --filter @visimer/dom exec vitest run test/renderer.test.ts`
  Expected: FAIL — `renderer` not a known `ViewOptions` key / type errors.

- [ ] **Step 3: Widen core's `Diagnostic.source`**

  `packages/core/src/types.ts:55`: `'core' | 'mermaid'` → `'core' | 'mermaid' | 'pele'`. Run `pnpm --filter @visimer/core test`.
  Expected: PASS (widening is additive).

- [ ] **Step 4: Implement the view seam**

  Constructor: exactly-one check; `this.mermaidInstance = options.mermaid ?? null`; `this.renderer = options.renderer ?? mermaidAdapter(options.mermaid!, this.mermaidConfig)` (config defaults at view.ts:428 unchanged); drop the constructor's direct `mermaid.initialize` (the adapter initializes at creation). `render()`: delete the id-generation and `this.mermaid.initialize` lines; `const { svg } = await this.renderer.render(code)`; in the catch, delete the `d${id}`/`${id}` cleanup (Task 1 moved it into `mermaidAdapter`) and set `source: this.renderer.id`. `validate()`: `const d = await this.renderer.validate?.(this.editor.code); if (!d) return true; setDiagnostics([{ message: d.message, span: null, severity: 'error', source: this.renderer.id }]); return false`. `setMermaidConfig`: keep today's mermaid behavior exactly (rebuild `this.renderer = mermaidAdapter(this.mermaidInstance, this.mermaidConfig)`, clear `lastRenderedCode`, re-render); under `renderer.id !== 'mermaid'` warn once and return. Update `ViewOptions` JSDoc: `mermaid` optional when `renderer` is provided.

- [ ] **Step 5: Run all gates**

  Run: `pnpm --filter @visimer/dom test && pnpm --filter @visimer/core test && pnpm typecheck`
  Expected: PASS — including the pre-existing suites (fonts, inplace, visibility-retry, correlate-hidden-mount) unmodified.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/dom/src/view.ts packages/core/src/types.ts packages/dom/test/renderer.test.ts
  git commit -m "refactor(dom): route the canvas view through RendererAdapter"
  ```

### Task 3: Pele flowchart correlator + dispatch

**Files:**
- Create: `packages/dom/src/correlate.pele.ts`
- Modify: `packages/dom/src/correlate.ts:32` (`addEdgeHitOverlay` becomes `export function`)
- Modify: `packages/dom/src/view.ts` (`bindSvg()`:898-917 dispatch)
- Modify: `packages/dom/src/index.ts` (export `correlatePeleFlowchart`)
- Test: `packages/dom/test/correlate-pele.test.ts`

**Interfaces:**
- Consumes: `Correlation` (correlate.ts:12-18), `FlowGraph`/`FlowNode`/`FlowEdge`/`FlowSubgraph` from `@visimer/core`, `addEdgeHitOverlay(path, entityId)`.
- Produces: `correlatePeleFlowchart(svg: SVGSVGElement, graph: FlowGraph): Correlation`, selected in `bindSvg` when `this.renderer.id === 'pele'` (flowchart slot only; all other slots → `null` correlation, `seqCorrelation` `null`, `armVisibilityRetry` passed `null`).

- [ ] **Step 1: Write failing tests in `packages/dom/test/correlate-pele.test.ts`**

  Harness: pragma + polyfill; `import { render as peleRender } from 'pele'`; helper `correlate(code)` → `new MermaidWysiwygEditor({ code })`, `graph = editor.result.flowchart`, `host.innerHTML = peleRender(code).svg`, `correlatePeleFlowchart(host.querySelector('svg')!, graph)`. Real pele works under jsdom (no canvas → its `metricsMeasurer` fallback).

  Fixtures (exact code strings):
  1. Standard — `'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]\n'`: `nodes` has `node:A`/`node:B`/`node:C` mapped to `g.pele-node` elements (each tagged `data-mw-entity`), `edges` has `edge:A->B#0`/`edge:B->C#0` mapped to the **inner `<path>`** of the right `g.pele-edge` (assert path is inside the group whose `data-id` starts `L_A_B_` / `L_B_C_`, and that the path's `data-mw-hit-overlay` sibling clone exists), `edgeLabels` has `edge:B->C#0` mapped to `g.pele-edge-label[data-id="L_B_C_0"]`, `failed` empty.
  2. Subgraph — `'flowchart TD\n  subgraph SG [Group]\n    A[Start] --> B\n  end\n  B --> C\n'`: `nodes` includes `subgraph:SG` → `g.pele-cluster[data-id="SG"]`. Then inject synthetically `<g class="pele-cluster-titles"><g class="pele-cluster-title" data-id="SG">Group</g></g>` into the svg and re-correlate: the `g.pele-cluster-title` element is tagged `data-mw-entity="subgraph:SG"` (struck titles live outside their cluster; pele src/svg/cluster.ts:67).
  3. Duplicate pair — `'flowchart TD\n  A -->|one| B\n  A -->|two| B\n'`: `edge:A->B#0` and `edge:A->B#1` both correlate, each to a distinct path, first-declared → first-in-DOM for the pair; `edgeLabels` maps both.
  4. Invisible member — `'flowchart TD\n  A --> B\n  A ~~~ B\n'`: pele renders one `g.pele-edge`; assert `edges` is empty, `failed` contains `edge:A->B#0` **and** `edge:A->B#1`, and the rendered path carries no `data-mw-entity` (degrade, never mis-pair).
  5. Special ids — `'flowchart TD\n  a-b --> c\n  a --> b_c\n'`: `node:a-b`, `node:b_c`, `edge:a-b->c#0` all correlate (underscore target `b_c` makes pele's `data-id` `L_a_b_c_0`; the leftover rule must pair it correctly).
  6. Entity-coded id — synthetic: `svg.insertAdjacentHTML` a `<g class="pele-node" data-id="A&quot;x">…` (DOM attribute value `A"x`) and a hand-built minimal graph node `{ entityId: 'node:x', id: 'A&quot;x', … }` as `FlowNode`; assert it correlates. Plus unit tests for the helper: `decodeEntities('A&quot;x') === 'A"x'`, `decodeEntities('a&amp;b') === 'a&b'`, `decodeEntities('&#65;') === 'A'`, unknown entity passes through.
  7. Multi-line label — `'flowchart TD\n  A -->|"line1<br/>line2"| B\n'`: `edgeLabels` has `edge:A->B#0`.
  8. View dispatch — `MermaidCanvasView` + `peleAdapter({ render: (src) => peleRender(src) })` on fixture 1: after `'render'`, container svg contains `[data-mw-entity="node:A"]`. Same view on a pie (`'pie title Pets\n  "cat": 40\n  "dog": 60\n'`): renders (svg exists) but contains zero `data-mw-entity` attributes.

- [ ] **Step 2: Run to verify failure**

  Run: `pnpm --filter @visimer/dom exec vitest run test/correlate-pele.test.ts`
  Expected: FAIL — cannot resolve `../src/correlate.pele`.

- [ ] **Step 3: Implement `correlate.pele.ts` + dispatch**

  Algorithm (data-id first, degrade on miss):
  - `decodeEntities(s)`: decode `&amp; &lt; &gt; &quot; &apos;` and `&#NN;`/`&#xHH;`; leave unknown codes as-is.
  - Nodes: iterate all `g.pele-node`; match when `el.getAttribute('data-id') === node.id || === decodeEntities(node.id)`; tag + claim. Leftovers on both sides: if counts equal, zip in DOM order; else all unmatched → `failed`.
  - Clusters: for each subgraph, `g.pele-cluster` by the same data-id rule → tag + `nodes.set`; additionally tag any `g.pele-cluster-title` with matching data-id (don't store in the map — selection styling queries the live DOM).
  - Edge groups: for every `g.pele-edge`, require `data-id` starting `L_`; parse from the right: last `_`-segment must be numeric (count), second-last is target, remainder is source; bucket DOM elements by `source->target`. Core edges bucketed by `${source}->${target}` in `edges`-array order (declaration order). Per pair: equal counts → zip DOM order to declaration order, storing the group's inner `<path>` with `data-mw-entity` + `addEdgeHitOverlay(path, entityId)`; unequal counts → the whole pair's core edges go to `failed` and its DOM elements stay unclaimed.
  - Leftover reconciliation (handles underscore ids): unclaimed DOM edge elements vs still-unmatched core edges — equal counts → zip in document order; else all degrade.
  - Edge labels: same parse over `g.pele-edge-label`; per pair, zip against that pair's **labeled** core edges when counts are equal; leftovers reconciled the same way; store the `g` element tagged.
  - `bindSvg` (view.ts:898-917): `const isPele = this.renderer.id === 'pele'`; under pele `this.correlation = flowchart ? correlatePeleFlowchart(svg, flowchart) : null`; `this.seqCorrelation = !isPele && sequence ? correlateSequence(svg, sequence) : null`; pass `null` (not `sequence`) to `armVisibilityRetry` under pele. The mermaid chain stays byte-identical.
  - `correlate.ts:32`: `function addEdgeHitOverlay` → `export function` (comment moves with it).

- [ ] **Step 4: Run tests to verify pass**

  Run: `pnpm --filter @visimer/dom exec vitest run test/correlate-pele.test.ts`
  Expected: PASS (all fixtures)

- [ ] **Step 5: Full gates + export**

  `packages/dom/src/index.ts`: export `correlatePeleFlowchart` next to `correlateFlowchart`. Run `pnpm --filter @visimer/dom test && pnpm typecheck`.
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/dom/src/correlate.pele.ts packages/dom/src/correlate.ts packages/dom/src/view.ts packages/dom/src/index.ts packages/dom/test/correlate-pele.test.ts
  git commit -m "feat(dom): pele flowchart correlator"
  ```

### Task 4: Pele view behaviors (gating + integration)

**Files:**
- Modify: `packages/dom/src/view.ts` (edge-popover animation section gated; `injectAnimationKeyframes` call skipped)
- Test: `packages/dom/test/pele-view.test.ts`

**Interfaces:**
- Consumes: `RendererAdapter` (Task 1), view seam (Task 2), `peleAdapter` over real pele.
- Produces: no new exports — behavior gates only.

- [ ] **Step 1: Write failing tests in `packages/dom/test/pele-view.test.ts`**

  Harness: real pele through `peleAdapter`; `MermaidCanvasView` in a jsdom container; await the view's `'render'` event.

  1. Keep-last-good: render `'flowchart TD\n  A[Start] --> B\n'`; then `editor.setCode('flowchart TD\n  A[unclosed', 'external')` and await the next `'render'` event → `{ ok: false }`; assert container still shows an svg containing `data-mw-entity="node:A"` (the previous render), `view.renderError` is truthy, and editor diagnostics contain `source: 'pele'`. Then `editor.setCode` back to the valid source → next render `{ ok: true }`, `renderError` null.
  2. Overlay-editor fallback: render the standard fixture; call `view.editEntityLabel('node:A')`; assert no element inside the svg has `contenteditable` (pele labels are SVG `<text>`), and an overlay editor element (input/textarea, per `openOverlayEditor`'s implementation) appears in the container showing `Start`. Commit a new value following the commit path used by packages/dom/test/inplace.test.ts (Enter/blur per the overlay editor's own contract); assert `editor.code` contains the new label. Read `openOverlayEditor` (view.ts:1597+) first and follow its actual commit event.
  3. Animation gating: with `'flowchart TD\n  A --> B\n'` rendered under pele, call `actionsFor` via bracket access (`(view as unknown as { actionsFor(id: string): PopoverAction[] }).actionsFor('edge:A->B#0')`); assert no item title contains `'Slow flow'` (the `anims` section, view.ts:1959-1963). Then repeat with a fake mermaid view on the same code: the animation items ARE present.
  4. Keyframes skipped: after rendering under pele, the svg contains no `<style>` mentioning `vsmr-flow`; under the fake mermaid view it does (current unconditional behavior).

- [ ] **Step 2: Run to verify failure**

  Run: `pnpm --filter @visimer/dom exec vitest run test/pele-view.test.ts`
  Expected: FAIL — cases 3 and 4 (animation items present / style injected under pele).

- [ ] **Step 3: Implement the gates**

  In the edge popover panel construction (the section built from the `anims` array, view.ts:1959-1963 and its panel use): omit the animation section entirely when `this.renderer.id === 'pele'`. In `render()`, wrap the `injectAnimationKeyframes(this.svg)` call (view.ts:833) in `if (this.renderer.id !== 'pele')`.

- [ ] **Step 4: Run tests to verify pass**

  Run: `pnpm --filter @visimer/dom exec vitest run test/pele-view.test.ts`
  Expected: PASS.

- [ ] **Step 5: Full gates**

  Run: `pnpm --filter @visimer/dom test && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/dom/src/view.ts packages/dom/test/pele-view.test.ts
  git commit -m "feat(dom): gate mermaid-only affordances under the pele renderer"
  ```

### Task 5: React `renderer` prop

**Files:**
- Modify: `packages/react/src/index.tsx` (`MermaidWysiwygProps`, `MermaidCanvasProps`, view-creation effects)

**Interfaces:**
- Consumes: `RendererAdapter` from `@visimer/dom` (Task 1), view seam (Task 2).
- Produces: `renderer?: RendererAdapter` on both components; `mermaid` becomes optional (`mermaid?: MermaidLike`) — exactly one required at runtime (the view's constructor enforces it).

- [ ] **Step 1: Update the two prop interfaces and components**

  `MermaidWysiwygProps` / `MermaidCanvasProps`: `mermaid?: MermaidLike`, add `renderer?: RendererAdapter` with JSDoc "alternate renderer (e.g. `peleAdapter(pele)`); pass exactly one of `mermaid`/`renderer`". Pass both through to `new MermaidCanvasView({ …, mermaid, renderer })`. View-recreation effect deps: `[mermaid]` → `[mermaid, renderer]`; `[editor, mermaid]` → `[editor, mermaid, renderer]`. Skip the `setMermaidConfig` effect when `renderer` is provided (pass `mermaidConfig` only on the mermaid path).

- [ ] **Step 2: Typecheck (react has no test suite — the playground in Task 6 exercises it)**

  Run: `pnpm typecheck`
  Expected: PASS with no edits to any existing consumer (all still pass `mermaid`).

- [ ] **Step 3: Commit**

  ```bash
  git add packages/react/src/index.tsx
  git commit -m "feat(react): optional renderer prop"
  ```

### Task 6: Playground renderer toggle

**Files:**
- Modify: `apps/playground/package.json` (dependency `pele`)
- Modify: `apps/playground/src/App.tsx` (toggle state, `Workspace` plumbing, pele notice)
- Modify: `apps/playground/src/app.css` (`--pele-*` theme block)
- Test: no automated playground tests (repo convention: playground is the manual harness, TESTING.md:41-42)

**Interfaces:**
- Consumes: `peleAdapter` from `@visimer/dom`, `renderer` prop from Task 5, pele package.
- Produces: user-facing toggle; nothing for later tasks.

- [ ] **Step 1: Add the dependency**

  `pnpm --filter playground add pele` (use the actual package name from apps/playground/package.json if different).

- [ ] **Step 2: Implement the toggle**

  `App`: `const [renderer, setRenderer] = useState<'mermaid' | 'pele'>(() => localStorage.getItem('visimer.renderer') === 'pele' ? 'pele' : 'mermaid')`, persist on change; segmented control in the topbar `.controls` (Mermaid | Pele). Pass `renderer` down to `Workspace`. `Workspace`: `import * as pele from 'pele'` + `import { peleAdapter } from '@visimer/dom'`; memoize once (`useRef`/`useMemo`, module scope preferred) `peleAdapter(pele, { fontFamily: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif' })`; `<MermaidCanvas … mermaid={renderer === 'mermaid' ? mermaid : undefined} renderer={renderer === 'pele' ? peleRendererAdapter : undefined} mermaidConfig={renderer === 'mermaid' ? { securityLevel: 'loose', ...themeConfig(theme) } : undefined} />`. Under pele add one notice element under the toolbar: flowcharts editable; other types render view-only; zenuml unsupported.

- [ ] **Step 3: Theme pele to match INK**

  `app.css`: on the canvas container (`.canvas`):
  `--pele-bg: #000000; --pele-fg: #ededed; --pele-muted: #a1a1a1; --pele-line: #8f8f8f; --pele-surface: #111111; --pele-surface-alt: #1a1a1a; --pele-border: #3f3f3f; --pele-accent: #3784ff; --pele-font: "Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif;` — eyeball-match only; adjust while looking at it.

- [ ] **Step 4: Gates + manual smoke**

  Run: `pnpm typecheck && pnpm test`
  Expected: PASS. Then `pnpm dev` → playground: toggle to Pele on the flowchart sample → double-click rename (overlay editor), drag-to-connect, delete, undo all work; switch to a non-flowchart sample → renders view-only with the notice; toggle back to Mermaid → everything as before.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/playground/package.json apps/playground/src/App.tsx apps/playground/src/app.css pnpm-lock.yaml
  git commit -m "feat(playground): mermaid/pele renderer toggle"
  ```
