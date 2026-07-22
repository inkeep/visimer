# Testing substrate

A map of the product seams, what covers each one today, and what no current
substrate can prove. Grades: **A** real component over its real interface,
**B** narrow integration against a realistic fake, **uncovered** no automated
test exercises the seam.

## Seams

| Seam | What crosses it | Substrate | Grade |
|---|---|---|---|
| Core engine (parse → ops → minimal edits → history) | Public contract of `@visimer/core`; every op for all 22 editable diagram types | `packages/core/test/*.test.ts` (74 tests) run the real engine on real Mermaid source and assert emitted code, round-trips, and undo | A |
| `bindTextPane` editor contract | The adapter contract any code editor integration implements | `packages/core/test/textpane.test.ts` drives the binding through an in-memory pane that implements exactly the shipped adapter interface: both sync directions, caret selection, reveal, drift resync, dispose | B |
| CodeMirror binding | `@visimer/codemirror` against a real CodeMirror 6 `EditorView` | `packages/codemirror/test/binding.test.ts` (jsdom): engine ops → view, view edits → engine, decorations in the DOM, caret → entity selection, engine-authoritative undo, teardown | A |
| Monaco binding | `@visimer/monaco` against the structural editor interface it binds | `packages/monaco/test/binding.test.ts`: fake implementing exactly the bound surface (both sync directions, decorations, caret reasons, undo keys, dispose), plus a compile-time conformance check that real `monaco-editor` types satisfy the interface | B |
| SVG correlation (dom package ↔ Mermaid's rendered DOM) | Third-party dependency seam: correlators key off Mermaid's internal SVG structure, which can shift between Mermaid releases | None automated. Verified manually in the playground across all 23 diagram types | uncovered |
| Canvas interaction layer (popovers, drag, in-place editing) | `@visimer/dom` gestures compiled to engine ops | None automated. Verified manually in the playground | uncovered |
| React bindings | `@visimer/react` hooks/components over core events | None automated. Thin subscription layer; exercised manually via the playground | uncovered |

## Honest residual

What the current suite cannot catch:

- **A Mermaid upgrade that shifts the rendered SVG structure.** This is the
  highest-risk seam. Correlators fail soft (elements degrade to view-only),
  so the failure is silent feature loss, not a crash. Closing it needs a
  real-browser rung (vitest browser mode or Playwright) that renders real
  Mermaid per diagram type and asserts entities were tagged; jsdom cannot
  provide it because Mermaid layout requires real text measurement.
- **Pointer-gesture regressions** (drag-to-connect thresholds, double-click
  vs drag arbitration, popover anchoring). Same real-browser rung.
- **React render-loop regressions** (stale subscriptions, effect ordering).
  Would need @testing-library/react coverage.

The playground doubles as the manual harness for all three: every editable
type has a sample, and the toolbar/popovers exercise the gesture surface.

## Running

```bash
pnpm test        # all package suites
pnpm typecheck   # all packages and apps
```
