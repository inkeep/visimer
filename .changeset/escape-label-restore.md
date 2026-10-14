---
"@visimer/dom": patch
---

Cancelling an in-place label edit with Escape now restores the label exactly as mermaid rendered it. Before, the canvas parsed the raw label text from the diagram source as HTML, which skipped mermaid's sanitizer. If your canvas renders diagrams that you did not write, upgrade.
