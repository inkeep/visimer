# @visimer/core

Headless bidirectional editing engine for [Mermaid](https://mermaid.js.org) diagrams.
Text is the source of truth: a lossless CST and per-type semantic graphs turn visual
operations (rename, connect, reorder, restyle) into **minimal text edits** against your
actual Mermaid source. Zero DOM dependencies.

```ts
import { MermaidWysiwygEditor } from '@visimer/core'

const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\n  A --> B' })
editor.dispatch({ type: 'renameNode', id: 'A', label: 'Start' })
editor.code // 'flowchart TD\n  A[Start] --> B'
editor.undo()
```

## Bring your own code editor

`bindTextPane` syncs the engine with any code editor behind a five-method adapter.
For CodeMirror use [`@visimer/codemirror`](https://npmjs.com/package/@visimer/codemirror),
for Monaco use [`@visimer/monaco`](https://npmjs.com/package/@visimer/monaco);
both are implementations of this contract. For anything else, implement the adapter:

```ts
import { bindTextPane } from '@visimer/core'

const binding = bindTextPane(editor, {
  getText: () => /* current document text */,
  applyEdits: (edits) => /* apply {start, end, text} offsets to the document */,
  setText: (text) => /* replace the whole document (resync safety net) */,
  setHighlights: (spans) => /* highlight the selected entities' ranges */,
  revealPosition: (offset) => /* optional: scroll an offset into view */,
})

// then wire your editor's events:
//   document changed  -> binding.notifyTextChange()
//   caret moved       -> binding.notifyCaretMove(offset)
//   undo/redo keys    -> binding.undo() / binding.redo()
```

Typing flows into the engine, engine changes come back as minimal edits, entity
selection syncs both ways, and undo/redo shares the canvas history stack. The
notify methods no-op while the binding is applying engine edits, so there is no
echo loop to guard against.

Pairs with [`@visimer/dom`](https://npmjs.com/package/@visimer/dom)
(interactive canvas). Docs: [github.com/inkeep/visimer](https://github.com/inkeep/visimer)
