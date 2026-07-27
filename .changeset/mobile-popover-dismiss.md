---
"@visimer/core": patch
"@visimer/dom": patch
"@visimer/react": patch
"@visimer/codemirror": patch
"@visimer/monaco": patch
---

`@visimer/dom`: tapping empty canvas margin now dismisses the popover in panzoom mode. Previously, taps outside the SVG but inside its host (the padded margin where the SVG is centered) fell through the SVG's click handler and the popover stayed pinned to the selected node.
