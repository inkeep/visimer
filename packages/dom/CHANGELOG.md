# @visimer/dom

## 1.0.0

### Major Changes

- 7ab9082: Rename the library to visimer. Packages move from `@inkeep/mermaid-wysiwyg-*` to
  scoped `@visimer/*` (`core`, `dom`, `react`, `codemirror`, `monaco`); the public
  repo moves from `inkeep/mermaid-wysiwyg` to `inkeep/visimer`. Update imports and
  install commands accordingly.

### Minor Changes

- e6feaec: Sequence-diagram connects now start from the lifeline plus buttons: drag a plus to another participant and the message is inserted at that exact gap, then opens for in-place label editing. A plain click still opens the self-message / note menu. The old alt-drag on participant boxes, which could only append at the end of the diagram, is removed.
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

- 1fdfef4: Make the canvas usable on touch devices. Pan/zoom canvases now set `touch-action: none` so a one-finger drag pans instead of scrolling the page, two-finger pinch zooms about the finger midpoint, and a double tap on an entity opens the label editor even on browsers that never synthesize `dblclick` from taps (mobile Safari). Popover buttons, zoom controls, and menu rows grow to comfortable tap-target sizes under `@media (pointer: coarse)`.

### Patch Changes

- 4afd20d: The selection glow is no longer clipped flat at the diagram's top and bottom edges.
- c13374b: `@visimer/dom`: tapping empty canvas margin now dismisses the popover in panzoom mode. Previously, taps outside the SVG but inside its host (the padded margin where the SVG is centered) fell through the SVG's click handler and the popover stayed pinned to the selected node.
- e6feaec: Committing an overlay label edit (sequence notes, ER attribute rows, and other SVG-text labels) no longer flashes the pre-edit text while the re-render catches up.
- Updated dependencies [c13374b]
- Updated dependencies [7ab9082]
- Updated dependencies [7ab9082]
  - @visimer/core@1.0.0
