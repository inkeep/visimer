<div align="center">

# visimer

**Visual editing for Mermaid diagrams. Every gesture becomes a minimal text edit.**

Click, drag, and type directly on the diagram; your Mermaid source updates surgically.
Type in the code; the canvas follows live. One document, two surfaces, zero lock-in.

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Mermaid 11](https://img.shields.io/badge/mermaid-v11-ff3670.svg)](https://mermaid.js.org)
[![Types](https://img.shields.io/badge/types-included-3178c6.svg)](#packages)

</div>

---

## Why

Mermaid has become the diagram language of choice for Markdown files. The mermaid ecosystem lacked open source visual editors. Consumers had to use proprietary tools or one-way exporters. `visimer` keeps **text as the source of truth**: the canvas is Mermaid's own SVG with an interaction layer on top, and every visual action (rename, connect, reorder, restyle) compiles to the smallest possible edit against your actual source. Comments, whitespace, and formatting are never touched. Drag one edge,\
get a one-line diff.

## Quick start

```bash
npm i @visimer/core @visimer/dom mermaid
```

```ts
import mermaid from 'mermaid'
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCanvasView } from '@visimer/dom'

const editor = new MermaidWysiwygEditor({
  code: 'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]',
})

new MermaidCanvasView({
  editor,
  container: document.querySelector('#canvas')!,
  mermaid,
  mermaidConfig: { theme: 'dark' },
})

editor.on('change', ({ code }) => console.log(code)) // always-current source
```

Try everything locally:

```bash
pnpm install && pnpm dev   # playground at http://localhost:5173
```

## What you can do

- **Edit text in place**: double-click any label and type right on the diagram; nodes grow as you type
- **Drag to connect** nodes, states, classes, entities, participants, with a ghost edge preview
- **Drag to reorder** sequence messages; the statements reorder in source
- **Popovers on every entity**: shape/type/arrow pickers, cardinalities, color swatches, fragments, notes
- **One undo stack** across canvas and code (⌘Z anywhere)
- **Error tolerant**: broken syntax mid-keystroke never blanks the canvas
- **Lossless**: unknown syntax is preserved verbatim; your diff is only what you changed

## Diagram support

**22 of 23 Mermaid diagram types are editable.**

| Type | View | Item editing | Structural editing |
|---|:---:|:---:|:---:|
| [flowchart](https://mermaid.js.org/syntax/flowchart.html) | ✅ | ✅ | ✅ |
| [sequence](https://mermaid.js.org/syntax/sequenceDiagram.html) | ✅ | ✅ | ✅ |
| [state](https://mermaid.js.org/syntax/stateDiagram.html) | ✅ | ✅ | ✅ |
| [class](https://mermaid.js.org/syntax/classDiagram.html) | ✅ | ✅ | ✅ |
| [ER](https://mermaid.js.org/syntax/entityRelationshipDiagram.html) | ✅ | ✅ | ✅ |
| [pie](https://mermaid.js.org/syntax/pie.html) | ✅ | ✅ | ✅ |
| [gantt](https://mermaid.js.org/syntax/gantt.html) | ✅ | ✅ | ✅ |
| [journey](https://mermaid.js.org/syntax/userJourney.html) | ✅ | ✅ | ❌ |
| [timeline](https://mermaid.js.org/syntax/timeline.html) | ✅ | ✅ | ❌ |
| [quadrant](https://mermaid.js.org/syntax/quadrantChart.html) | ✅ | ✅ | ❌ |
| [kanban](https://mermaid.js.org/syntax/kanban.html) | ✅ | ✅ | ❌ |
| [mindmap](https://mermaid.js.org/syntax/mindmap.html) | ✅ | ✅ | ❌ |
| [treemap](https://mermaid.js.org/syntax/treemap.html) | ✅ | ✅ | ❌ |
| [packet](https://mermaid.js.org/syntax/packet.html) | ✅ | ✅ | ❌ |
| [sankey](https://mermaid.js.org/syntax/sankey.html) | ✅ | ✅ | ❌ |
| [radar](https://mermaid.js.org/syntax/radar.html) | ✅ | ✅ | ❌ |
| [gitgraph](https://mermaid.js.org/syntax/gitgraph.html) | ✅ | ✅ | ❌ |
| [xychart](https://mermaid.js.org/syntax/xyChart.html) | ✅ | ✅ | ❌ |
| [requirement](https://mermaid.js.org/syntax/requirementDiagram.html) | ✅ | ✅ | ❌ |
| [C4](https://mermaid.js.org/syntax/c4.html) | ✅ | ✅ | ❌ |
| [architecture](https://mermaid.js.org/syntax/architecture.html) | ✅ | ✅ | ❌ |
| [block](https://mermaid.js.org/syntax/block.html) | ✅ | ✅ | ❌ |
| [zenuml](https://mermaid.js.org/syntax/zenuml.html) | ✅ | ❌ | ❌ |

**Item editing** is select, edit in place, add, and delete; **structural editing** adds connect, reorder, and restyle. Every type round-trips losslessly and syncs selection between code and canvas, including view-only zenuml (an external plugin).

## Packages

| Package | Purpose |
|---|---|
| `@visimer/core` | Headless engine: lossless CST, semantic graphs, ops → minimal text edits, unified history. Zero DOM deps |
| `@visimer/dom` | Interactive canvas: renders through your `mermaid` instance, correlates SVG ⇄ graph, all gestures |
| `@visimer/codemirror` | CodeMirror 6 pane: two-way sync, entity decorations, mermaid syntax highlighting, shared undo |
| `@visimer/monaco` | Monaco binding for an editor instance you own; zero monaco dependency of its own |
| `@visimer/react` | React bindings: `<MermaidWysiwyg code onCodeChange />` drop-in component plus `useMermaidEditor` hook |

The code-editor integration is a contract, not a dependency. `core` exposes
`bindTextPane`, a five-method adapter that gives any editor the same two-way sync;
the CodeMirror and Monaco packages are implementations of it, and neither is pulled
in unless you install it (editor libraries are peer dependencies or absent entirely).
Some other editor? Implement the adapter, it's about forty lines.

## Design

```
      code (source of truth)
        ⇅ minimal TextEdits
   lossless CST → semantic graph
        ⇅                ⇅
  CodeMirror pane   Mermaid SVG + overlay
```

## How the canvas works

We never re-implement rendering. Mermaid draws the SVG, untouched. A small per-type correlator then matches every element back to its source line, using id conventions, draw order, or label text, and tags it. All interaction hangs off those tags.

Anything we can't match degrades to view-only; the diagram still renders perfectly and the code stays editable. The tradeoff is that correlation leans on Mermaid's internal DOM, which can shift between releases. It's contained, because correlators are tiny, isolated, and fail soft. That's the price of pixel-perfect fidelity, and it beats owning a renderer that's wrong in a hundred small ways.

## License

[MIT](./LICENSE) © [Inkeep](https://inkeep.com)
