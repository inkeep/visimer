# @visimer/monaco

Monaco binding for [visimer](https://github.com/inkeep/visimer).
You create and own the Monaco editor (workers, theme, options); `bindMonaco`
wires the two-way sync: typing flows into the engine, engine changes come back
as minimal edits, entity selection renders as decorations and follows the
caret, and undo/redo share the canvas history.

This package has no dependency on `monaco-editor`, not even for types, so it
never pins your Monaco version. It binds against a small structural interface
that any real Monaco editor satisfies.

```ts
import * as monaco from 'monaco-editor'
import { MermaidWysiwygEditor } from '@visimer/core'
import { bindMonaco, registerMermaidLanguage } from '@visimer/monaco'

registerMermaidLanguage(monaco) // optional syntax highlighting

const editor = new MermaidWysiwygEditor({ code: 'flowchart TD\n  A --> B' })
const me = monaco.editor.create(host, { value: editor.code, language: 'mermaid' })
const binding = bindMonaco(editor, me)

// style the selection highlight however you like:
// .mw-monaco-entity { background: rgba(105, 163, 255, 0.28); border-radius: 3px; }

binding.dispose() // unhooks listeners and clears decorations
```

Pairs with [`@visimer/dom`](https://npmjs.com/package/@visimer/dom)
(interactive canvas). Docs: [github.com/inkeep/visimer](https://github.com/inkeep/visimer)
