---
'@visimer/core': minor
'@visimer/dom': minor
---

Split the flowchart edge popover into focused pickers — Arrow (heads only, including a double-headed option), Stroke, Edge color, Animate edge (None/Slow/Fast), and Edge curve (Default/Natural/Linear, diagram-wide) — instead of the prior single "Edge type" panel that mixed line and head style. Adds `arrowStart` to `setEdgeStyle`, plus new `setEdgeAnimation` and `setFlowCurve` ops.

Edges are also easier to click on the canvas: each rendered edge now carries a transparent 14px-stroke hit overlay, so selecting a flowchart / state / class / ER edge no longer requires pixel-precise aim.
