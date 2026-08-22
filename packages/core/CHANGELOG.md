# @visimer/core

## 1.1.2

## 1.1.1

## 1.1.0

### Minor Changes

- 784f461: Split the flowchart edge popover into focused pickers — Arrow (heads only, including a double-headed option), Stroke, Edge color, Animate edge (None/Slow/Fast), and Edge curve (Default/Natural/Linear, diagram-wide) — instead of the prior single "Edge type" panel that mixed line and head style. Adds `arrowStart` to `setEdgeStyle`, plus new `setEdgeAnimation` and `setFlowCurve` ops.

  Edges are also easier to click on the canvas: each rendered edge now carries a transparent 14px-stroke hit overlay, so selecting a flowchart / state / class / ER edge no longer requires pixel-precise aim.

## 1.0.2

## 1.0.1

### Patch Changes

- 23611c0: Fix auto release.

## 1.0.0

### Major Changes

- 7ab9082: Rename the library to visimer. Packages move from `@inkeep/mermaid-wysiwyg-*` to
  scoped `@visimer/*` (`core`, `dom`, `react`, `codemirror`, `monaco`); the public
  repo moves from `inkeep/mermaid-wysiwyg` to `inkeep/visimer`. Update imports and
  install commands accordingly.

### Minor Changes

- 7ab9082: Textbox-grade inline editing: the canvas holds re-renders while an in-place
  label session is typing (live commits still sync the code surfaces), long
  labels stay on one line instead of wrapping into the clip, Escape reverts
  reliably, and a swap already in flight carries typed text and caret across.

  Popovers behave like part of the diagram: they anchor at the exact twin
  element clicked, flip below the node instead of clipping in overflow-hidden
  hosts, clamp horizontally, follow external pan/zoom transforms, and close on
  any interaction outside the canvas.

  New opt-in `panZoom` canvas option (DOM + React bindings): fit-to-canvas by
  default, drag empty space to pan, pinch or ctrl+wheel to zoom at the cursor,
  and corner zoom controls.

  All packages are relicensed from GPL-3.0-or-later to MIT.

### Patch Changes

- c13374b: `@visimer/dom`: tapping empty canvas margin now dismisses the popover in panzoom mode. Previously, taps outside the SVG but inside its host (the padded margin where the SVG is centered) fell through the SVG's click handler and the popover stayed pinned to the selected node.
