---
'@visimer/dom': patch
---

Re-render the canvas once the document's webfonts have loaded, so labels are no longer clipped on a first visit.

Mermaid measures label text against the fonts the document can use at the moment it renders, then bakes those measurements into fixed-width `foreignObject` boxes. On a cold load — a first-time visitor with an empty cache, where `font-display: swap` deliberately paints fallback text first — the webfont arrives after that measurement, and the real text is wider than the box that was sized for the fallback. Every label ends up clipped a few pixels short: "Tests green?" loses its "?", "Ship it" renders as "Ship i". Nothing in mermaid or in the browser re-measures, so the diagram stays wrong for the whole session; reloading fixes it only because the font is then cached, which is why it is invisible in normal development.

`MermaidCanvasView` now watches `document.fonts` after each render. If the document's fonts are still loading it waits for them to settle and then re-renders, which re-measures every label against the fonts the browser is actually painting with. It arms only while fonts are pending, so a page whose fonts are already available renders exactly once, as before. Environments with no `FontFaceSet` are unaffected.
