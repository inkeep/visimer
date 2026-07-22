# @visimer/codemirror

CodeMirror 6 pane for [visimer](https://github.com/inkeep/visimer):
two-way sync with the editing engine (canvas changes apply as exact minimal edits),
entity selection as decorations, caret → entity selection, mermaid syntax highlighting,
and ⌘Z routed to the engine's unified history, the same undo stack the canvas uses.

```ts
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCodeMirror } from '@visimer/codemirror'

const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\n  A --> B' })
new MermaidCodeMirror(hostElement, editor)
```

Docs: [github.com/inkeep/visimer](https://github.com/inkeep/visimer)
