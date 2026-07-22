# @visimer/dom

Interactive WYSIWYG canvas for [Mermaid](https://mermaid.js.org): renders through your
`mermaid` instance for full fidelity, then overlays selection, drag-to-connect,
in-place text editing, entity popovers (shapes, arrow types, colors, cardinalities),
and keyboard editing, every gesture compiled to a minimal source edit by
[`@visimer/core`](https://npmjs.com/package/@visimer/core).

```ts
import mermaid from 'mermaid'
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCanvasView } from '@visimer/dom'

const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\n  A --> B' })
new MermaidCanvasView({ editor, container: el, mermaid })
```

Docs: [github.com/inkeep/visimer](https://github.com/inkeep/visimer)
