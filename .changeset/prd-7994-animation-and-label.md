---
'@visimer/dom': patch
---

Smooth the edge-animation loop, and stop node labels from getting quoted when Chromium substitutes `&nbsp;` mid-edit.

`injectAnimationKeyframes` was ending each animation cycle at `stroke-dashoffset: -20`, but the visual dash+gap period is `2 * 8 = 16` — `-20 mod 16 = -4`, so the dash pattern snapped back by 4 units at every loop boundary. Ending at `-16` completes exactly one period per cycle, so the 100 % → 0 % transition is now invisible.

`readLabelHtml` used to pass Chromium's `&nbsp;` entity through to the source rewriter unchanged. Typing a trailing space in a contenteditable label produced `"foo&nbsp;"`, and the `&` character tripped the `NEEDS_QUOTE` regex, so the live commit wrapped the label in double quotes; every subsequent keystroke saw `ref.quoted === true` and the quotes stuck around forever. The read now canonicalises `&nbsp;` back to a real space so `.trim()` catches it and the label stays unquoted through the whole edit session.
