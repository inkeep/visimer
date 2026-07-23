---
'@visimer/dom': minor
---

Make the canvas usable on touch devices. Pan/zoom canvases now set `touch-action: none` so a one-finger drag pans instead of scrolling the page, two-finger pinch zooms about the finger midpoint, and a double tap on an entity opens the label editor even on browsers that never synthesize `dblclick` from taps (mobile Safari). Popover buttons, zoom controls, and menu rows grow to comfortable tap-target sizes under `@media (pointer: coarse)`.
