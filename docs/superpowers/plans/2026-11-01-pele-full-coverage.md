# Pele Full-Coverage Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every diagram type editable under Mermaid is editable under Pele — per-family correlators on the established pattern, wired into the view, with per-family fixtures.

**Architecture:** Seven correlator additions to `@visimer/dom` keyed off Pele's `data-id`/`pele-*` contract, each returning the existing `Correlation`/`SequenceCorrelation` shapes so gestures/popovers/ops work untouched. Core anchors every zip; ids are hints, order+count is truth, ambiguity degrades both sides. Spec: `docs/superpowers/specs/2026-11-01-pele-full-coverage-design.md`.

**Tech Stack:** TypeScript (strict, ESM), vitest + jsdom, real pele renders via metrics fallback, pnpm workspace.

**Model plan (user-directed cost optimization):** probing was done at plan time (facts pinned below), so Tasks 1–6 and 8 are transcription+testing → **implementers on `inference-coop/greenpt/glm-5.3-flash`** (cheap tier), reviewed by `inference-coop/greenpt/deepseek-v4.1-flash` (mid). Task 7 (sequence) carries real judgment → implementer AND reviewer on `inference-coop/greenpt/glm-5.3` (capable). Scoped re-reviews of small fix diffs: flash allowed; escalation on BLOCKED or two rounds of Important findings: one tier up. Final whole-branch review: glm-5.3.

## Global Constraints

- "Never mis-correlate: when a match is ambiguous, the entity degrades to view-only (`failed`) instead of pairing a wrong element."
- The mermaid path stays untouched; existing suites stay green, unmodified.
- Core changes are forbidden; a family whose core graph proves insufficient is a stop-and-rule, not an implementation detail.
- Scenery exclusions (spec rulings): `pele-state-start/-end` elements, sequence activation rects / destroy marks / fragment frames, and gantt gridlines are NEVER tagged — filter by class, never sweep by `data-id` alone.
- Index-style ids (`i0`, `edge0`, `task1`, `id_…_1`) are hints only — never trust them beyond consistency checks; order zips require equal counts on both sides.
- Entity-id formats from core: `state:`/`trans:`, `class:`/`rel:`, `entity:`/`erel:`, `slice:`, `task:<lineIndex>`, `item:`, `participant:`/`event:<lineIndex>`.
- Tests: `// @vitest-environment jsdom` pragma + `CSS.escape` polyfill + `HTMLCanvasElement.prototype.getContext = () => null` stub (pattern: packages/dom/test/renderer.test.ts). Harness helper: the `correlate(code)` pattern from packages/dom/test/correlate-pele.test.ts.
- Commands: `pnpm --filter @visimer/dom exec vitest run test/<file>`; gates `pnpm --filter @visimer/dom test`, per-package `typecheck`; pnpm workaround when `pnpm` fails with ENOEXEC: `node /Users/cag/Library/pnpm/.tools/pnpm/12.8.1/node_modules/pnpm/bin/pnpm.mjs <args>`.
- Commits: one per task, `feat(dom): pele <family> correlator`, on branch `pele-renderer-poc`.

## Probe facts (verified 2026-11-01 against pele@1.13.0 by rendering real samples; every task cites its section)

- **state**: states `g.pele-node.pele-state[data-id=<id>]`; pseudo-states render as `pele-state-start[data-id=root_start|<comp>_start]` / `pele-state-end[data-id=root_end|<comp>_end]`; transitions `g.pele-edge.pele-transition[data-id=edge<N>]` (+ `g.pele-edge-label` same id); composites `g.pele-cluster.pele-state-composite[data-id=<id>]` with `.pele-cluster-label`.
- **class**: classes `g.pele-node.pele-class[data-id=<id>]`; members `text.pele-member.pele-attribute` / `.pele-method` (no data-id; attributes grouped before methods); relations `g.pele-edge.pele-relation[data-id=id_<Src>_<Tgt>_<N>]` (+ labels same id); cardinalities `text.pele-cardinality` (positional).
- **ER**: entities `g.pele-node.pele-entity[data-id=<label>]` (label-keyed!); relationships `g.pele-edge.pele-er-identifying[data-id=id_entity-<label>-<idx>_entity-<label>-<idx>_<n>]`; attributes `text.pele-er-name` / `.pele-er-type` rows (no data-id; positional per entity) inside `g.pele-er-attributes`.
- **pie**: slices `path.pele-slice[data-id=<label>]`; legend `g.pele-legend-item[data-id=<label>]` — both label-keyed, no order dependence.
- **gantt**: tasks `g.pele-task[data-id=<sourceId|taskN>]` (core has no ids → order-zip); milestone variant class `pele-milestone`; sections `rect.pele-section.pele-section-<N>` + `text.pele-section-label[data-id=<name>]`; grid is `g.pele-grid` (separate group, still class-filter to `g.pele-task`).
- **line-items**: kanban columns `g.pele-cluster.pele-column[data-id]` / cards `g.pele-node.pele-card[data-id]`; git commits `g.pele-commit.pele-commit-<kind>[data-id=<commitId|generated>]`, branches `g.pele-branch[data-id]`; timeline periods `g.pele-node.pele-period[data-id=<text>]` (events have NO data-id → text fallback); journey tasks `g.pele-node.pele-task[data-id=<taskText>]`, sections `g.pele-cluster.pele-section[data-id]`; sankey nodes `rect.pele-sankey-node[data-id]` / links `path.pele-sankey-link[data-id=<A>-><B>]` / labels `g.pele-label[data-id]`.
- **sequence**: actors `g.pele-node.pele-actor.pele-actor-<kind>[data-id=<participantId>]` (bottom twins carry `pele-actor-footer`); lifelines `path.pele-lifeline[data-id=<participantId>]`; messages `g.pele-edge.pele-message[data-id=i<N>]` + `g.pele-edge-label[data-id=i<N>]`; notes `g.pele-note[data-id=i<N>]`; activations `rect.pele-activation[data-id=<participantId>]` (scenery); fragments `g.pele-frame.pele-frame-<kind>` (no data-id; scenery). **The `i<N>` counter is global across messages AND notes and non-contiguous per kind** (probe: messages i0, i2, i6 with note i4 between).

## Review Focus

1. **Index-id trust** — sequence/state/class/gantt index-style ids shift under insertion (sequence probe: i0,i2,i6). Every order zip is count-checked and ids are hints only. → Tasks 1, 2, 3, 5, 7 fixtures each pin a shifted-index or insertion case.
2. **Scenery mis-tagging** — start/end states, activations, destroys, frames, gridlines carry ids of real entities; a bare `[data-id]` sweep tags them. → Tasks 1, 5, 7 fixtures assert scenery stays untagged.
3. **Label-keyed ambiguity** — duplicate labels (ER entities via alias syntax, pie slices, kanban cards, timeline periods) collide on data-id. → Tasks 3, 4, 6 adversarial fixtures: duplicates degrade both sides, never mis-pair.
4. **Positional member/attribute mismatch** — class members and ER attributes have no ids; a count mismatch must degrade the rows, not zip partials. → Tasks 2, 3 count-mismatch fixtures.
5. **Silent style no-op** — pele's style allowlist can drop a family's style op. → Each family's spot-check step emits one style op and asserts visible change or escalates as stop-and-rule.

---

### Task 1: State correlator

**Model tier:** implementer flash, reviewer mid. **Files:** Create `packages/dom/src/correlate.pele.state.ts`; Modify `packages/dom/src/view.ts` (bindSvg pele branch: state slot), `packages/dom/src/index.ts` (export); Test `packages/dom/test/correlate-pele-state.test.ts`.

**Interfaces:**
- Consumes: `Correlation` (correlate.ts:12-18), `addEdgeHitOverlay`, `decodeEntities` (export from correlate.pele.ts if not already exported), `StateGraph` (`@visimer/core`: `states: {entityId 'state:<id>', id, isComposite}[]`, `transitions` in document order).
- Produces: `correlatePeleState(svg: SVGSVGElement, graph: StateGraph): Correlation`, wired under pele for the state slot.

- [ ] **Step 1: Failing tests** — harness per Global Constraints; sample: the probe's state sample (composite + labeled transitions). Assert: every `state:` entity correlates to `g.pele-state[data-id]` (decode-entities compare); composite state ALSO tags `g.pele-cluster.pele-state-composite[data-id=Processing]`; transitions zip document-order count-checked (`trans:` ids, hit overlays added, inner `<path>` stored); transition labels correlate; `[*]`-rendered elements (`pele-state-start/-end`) carry NO `data-mw-entity`; adversarial: a transition whose source sample makes counts mismatch degrades that transition (never mis-zips).
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @visimer/dom exec vitest run test/correlate-pele-state.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** — states: data-id match (decodeEntities), excluding elements with class `pele-state-start`/`pele-state-end`; leftover equal-count zip else degrade. Composites: cluster data-id match, tag + `nodes.set`, cluster-label tagged too. Transitions: `g.pele-edge.pele-transition` document order vs core transitions, count-check, store inner `<path>` + `addEdgeHitOverlay`; labels via `g.pele-edge-label[data-id]` matched to the transition's edge element (same data-id), count-checked. Wire bindSvg: under pele, state slot → `correlatePeleState`.
- [ ] **Step 4: Verify pass** — focused file, then `pnpm --filter @visimer/dom test` + dom typecheck.
- [ ] **Step 5: Style spot-check** — emit one state style op through a view-level render (e.g. a `classDef`/`style` on a state) and assert the re-rendered SVG changes visibly; if dropped by pele's allowlist → STOP and report (gate it, don't ship silent no-op).
- [ ] **Step 6: Commit** — `git commit -m "feat(dom): pele state correlator"` (files: new module, view.ts, index.ts, test).

### Task 2: Class correlator

**Model tier:** implementer flash, reviewer mid. **Files:** Create `packages/dom/src/correlate.pele.class.ts`; Modify view.ts (classGraph slot), index.ts; Test `packages/dom/test/correlate-pele-class.test.ts`.

**Interfaces:**
- Consumes: `Correlation`, `addEdgeHitOverlay`, `decodeEntities`, `ClassGraph` (`classes: {entityId 'class:<id>'}[]`, members, `relations: {entityId 'rel:…'}[]` — read core/src/class/graph.ts for member/relations shape and mirror what mermaid's correlateClass tags).
- Produces: `correlatePeleClass(svg, graph): Correlation` wired for the classGraph slot.

- [ ] **Step 1: Failing tests** — probe's class sample. Assert: classes correlate to `g.pele-class[data-id]`; member rows tagged mirroring mermaid's supplementary tags (`data-mw-member-class` on the row, `data-mw-member-line` on the divider — read correlate.ts:252-268 for the exact mermaid contract and mirror it, mapping attributes to `text.pele-member.pele-attribute` then methods to `.pele-method`, count-checked per class); relations correlate to `g.pele-edge.pele-relation` inner path + hit overlay, matched by `id_<Src>_<Tgt>_` prefix + ambiguity guard (same guard as flowchart leftovers); adversarial: member-count mismatch degrades the class's member rows, not the class; duplicate `L_`-style relation prefix collisions degrade.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** — per Step 1's contract; wire bindSvg classGraph slot under pele.
- [ ] **Step 4: Verify pass** — focused + full dom suite + typecheck.
- [ ] **Step 5: Style spot-check** — one class member style op round-trips visibly (or stop-and-rule).
- [ ] **Step 6: Commit** — `feat(dom): pele class correlator`.

### Task 3: ER correlator

**Model tier:** implementer flash, reviewer mid. **Files:** Create `packages/dom/src/correlate.pele.er.ts`; Modify view.ts (er slot), index.ts; Test `packages/dom/test/correlate-pele-er.test.ts`.

**Interfaces:**
- Consumes: `Correlation`, guards as above, `ErGraph` (`entity:` entities keyed by name; `erel:` relationships; attributes — mirror mermaid's correlateEr contract incl. `data-mw-attr-entity`/`data-mw-attr-line` tags, correlate.ts:293-367).
- Produces: `correlatePeleEr(svg, graph): Correlation` wired for the er slot.

- [ ] **Step 1: Failing tests** — probe's ER sample. Assert: entities correlate to `g.pele-entity[data-id=decodeEntities(name)]`; label-KEYED (not id) — adversarial: duplicate entity names via alias syntax degrade the colliding entities, never mis-pair; attributes positional per entity count-checked, tagged with mermaid's attr tags; relationships match `g.pele-edge.pele-er-identifying` by document-order count-check against core's `erel` list (the `id_entity-…` scheme is a hint only) + labels same; stripes/dividers excluded.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** — per Step 1; wire the er slot.
- [ ] **Step 4: Verify pass** — focused + gates.
- [ ] **Step 5: Style spot-check** — one entity/attribute style op round-trips visibly (or stop-and-rule).
- [ ] **Step 6: Commit** — `feat(dom): pele er correlator`.

### Task 4: Pie correlator

**Model tier:** implementer flash, reviewer mid. **Files:** Create `packages/dom/src/correlate.pele.pie.ts`; Modify view.ts (pie slot), index.ts; Test `packages/dom/test/correlate-pele-pie.test.ts`.

**Interfaces:**
- Consumes: `Correlation`, `decodeEntities`, `PieGraph` (`slice:` entities with label/value).
- Produces: `correlatePelePie(svg, graph): Correlation` wired for the pie slot.

- [ ] **Step 1: Failing tests** — probe's pie sample. Assert: every `slice:` correlates to `path.pele-slice[data-id=decodeEntities(label)]`; legend `g.pele-legend-item[data-id]` tagged with the same entity id; adversarial: duplicate slice labels degrade both colliding slices + legend items; all-correlated leaves `failed` empty.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** — data-id matching only (no order dependence); wire the pie slot.
- [ ] **Step 4: Verify pass** — focused + gates.
- [ ] **Step 5: Style spot-check** — one slice color op round-trips visibly (pele colors via `--pele-series-N` CSS vars — assert the series class/index changes or the op's source diff lands; if pele ignores per-slice styling → stop-and-rule before gating).
- [ ] **Step 6: Commit** — `feat(dom): pele pie correlator`.

### Task 5: Gantt correlator

**Model tier:** implementer flash, reviewer mid. **Files:** Create `packages/dom/src/correlate.pele.gantt.ts`; Modify view.ts (gantt slot), index.ts; Test `packages/dom/test/correlate-pele-gantt.test.ts`.

**Interfaces:**
- Consumes: `Correlation`, `GanttGraph` (`task:<lineIndex>` entities in document order).
- Produces: `correlatePeleGantt(svg, graph): Correlation` wired for the gantt slot.

- [ ] **Step 1: Failing tests** — probe's gantt sample (sections + milestone). Assert: tasks order-zip `g.pele-task` (document order vs core tasks, count-checked — core has no source ids; `data-id` values are NOT match keys); milestone variant correlated same as any task; gridlines (`g.pele-grid` children) and section rects carry NO `data-mw-entity`; adversarial: task-count mismatch degrades (e.g. a task pele drops) rather than zips.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** — order zip only; class-filter the sweep to `g.pele-task`; wire the slot.
- [ ] **Step 4: Verify pass** — focused + gates.
- [ ] **Step 5: Style spot-check** — one task status op (`done`/`active`/`crit`) round-trips visibly (class change on `pele-task`).
- [ ] **Step 6: Commit** — `feat(dom): pele gantt correlator`.

### Task 6: Line-items correlator (15 types)

**Model tier:** implementer flash, reviewer mid. **Files:** Create `packages/dom/src/correlate.pele.lineitems.ts`; Modify view.ts (lineItems slot), index.ts; Test `packages/dom/test/correlate-pele-lineitems.test.ts`.

**Interfaces:**
- Consumes: `Correlation`, `decodeEntities`, `LineItemsGraph` (`item:` entities with `matchText`), the probe facts above.
- Produces: `correlatePeleLineItems(svg, graph): Correlation` wired for the lineItems slot.

- [ ] **Step 1: Failing tests** — one fixture per type (15), using the playground sample strings from `apps/js-playground/src/samples` as sources. Match strategy per the probe: prefer first-class `data-id` (kanban cards/columns, git commits, sankey nodes/links, journey tasks, timeline periods) with `decodeEntities` compare; text fallback (`item.matchText` vs leaf `text/tspan` content, `.pele-label` and per-type text classes) for data-id-less elements (timeline events); re-enable `pointer-events: auto` on hit elements exactly as mermaid's correlateLineItems does (correlate.ts:452-457). Adversarial per the Review Focus: duplicate item text within one type (e.g. two kanban cards named the same) degrades both, never mis-pairs.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** — for types not probed at plan time (mindmap, treemap, packet, radar, xychart, architecture, requirement, c4, block, quadrant), run the probe first: the probe script is preserved at `/private/var/folders/b2/t9b43n89205878w6fwy1qhx40000gn/T/opencode/pele-probe/probe.mjs` (copy it into the workspace; render each sample, read its class/data-id surface) and pin what it shows in the fixtures. No guessing selectors.
- [ ] **Step 4: Verify pass** — focused (15+ fixtures) + gates.
- [ ] **Step 5: Style spot-check** — one kanban-card style op round-trips visibly (or stop-and-rule).
- [ ] **Step 6: Commit** — `feat(dom): pele line-items correlator`.

### Task 7: Sequence correlator

**Model tier:** implementer AND reviewer on the capable model. **Files:** Create `packages/dom/src/correlate.pele.sequence.ts`; Modify `packages/dom/src/view.ts` (seqCorrelation under pele + `armVisibilityRetry` re-enabled), index.ts; Test `packages/dom/test/correlate-pele-sequence.test.ts`.

**Interfaces:**
- Consumes: `SequenceCorrelation` (correlate.ts:464-474 — read it first: `participants: Map<string, Element[]>`, lifelines, events, eventTexts), `SequenceGraph` (`participant:` + `event:<lineIndex>` message/note events in document order), `addEdgeHitOverlay`, `decodeEntities`.
- Produces: `correlatePeleSequence(svg, graph): SequenceCorrelation` wired so the view's sequence machinery (lifeline UI, message drag, visibility retry) works under pele.

- [ ] **Step 1: Failing tests** — probe's sequence sample (participants incl. `actor` kind, messages, activation, note, loop frame). Assert:
  - participants: BOTH actor twins (`pele-actor` with and without `pele-actor-footer`) stored in `participants` per `data-id`; `participant:` ids tagged on both.
  - lifelines: `path.pele-lifeline[data-id]` fills the lifelines slot per participant.
  - events: `g.pele-edge.pele-message` and `g.pele-note` merged in DOCUMENT ORDER, zipped count-checked against core's events array (`event:` ids); the `i<N>` ids are NOT match keys (probe: i0, i2, i6 non-contiguous); message labels via `g.pele-edge-label` matched to their message group's data-id when equal-counted, else document-order zip.
  - scenery: `rect.pele-activation`, destroy marks, `g.pele-frame` carry NO `data-mw-entity` (clicking them selects nothing).
  - adversarial: inserting a note mid-sequence shifts message `i<N>` ids — assert the zip still pairs by order (the fixture pins exactly this).
  - view-level: a `MermaidCanvasView` over `peleAdapter` renders the sample, entities tagged, and `armVisibilityRetry` is armed for sequence under pele (hidden-mount case).
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** — per Step 1; wire `seqCorrelation` under pele and pass the sequence graph to `armVisibilityRetry` (replacing the current `null`).
- [ ] **Step 4: Verify pass** — focused + full gates.
- [ ] **Step 5: Style spot-check** — one note/message style op round-trips visibly (or stop-and-rule).
- [ ] **Step 6: Commit** — `feat(dom): pele sequence correlator`.

### Task 8: Notice, TESTING.md, README

**Model tier:** implementer flash, reviewer mid. **Files:** Modify `apps/playground/src/App.tsx` (notice copy), `TESTING.md`, `README.md`.

- [ ] **Step 1: Update notice copy** — under pele: "All diagram types are editable under Pele; zenuml is not supported." (replaces the flowchart-only notice).
- [ ] **Step 2: TESTING.md** — add the pele correlator rung to the SVG-correlation seam row (per-family real-render fixture suites; still uncovered: mermaid-side correlation).
- [ ] **Step 3: README** — one line under Architecture: the canvas is renderer-swappable (Mermaid or Pele); badge note optional.
- [ ] **Step 4: Gates** — `pnpm test`, per-package typecheck, playground build.
- [ ] **Step 5: Commit** — `docs+feat(playground): pele full-coverage notice and docs` (or split if cleaner).
