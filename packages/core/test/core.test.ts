import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse, scanLines, DIAGRAM_TYPES, detectDiagramType } from '../src'

const FLOW = `flowchart TD
  %% happy path
  A[Start] --> B{Valid?}
  B -->|yes| C[Process]
  C --> D[Done]
`

describe('generic CST', () => {
  it('is byte-lossless on scan', () => {
    const samples = [FLOW, 'pie\n  "a": 1', '---\ntitle: Hi\n---\nflowchart LR\n  A --> B\n\n%% done']
    for (const code of samples) {
      const lines = scanLines(code)
      const rejoined = lines.map((l) => l.text).join('\n')
      expect(rejoined).toBe(code)
    }
  })

  it('detects all registered diagram types by header', () => {
    const headers: Record<string, string> = {
      flowchart: 'flowchart LR',
      sequence: 'sequenceDiagram',
      class: 'classDiagram',
      state: 'stateDiagram-v2',
      er: 'erDiagram',
      journey: 'journey',
      gantt: 'gantt',
      pie: 'pie showData',
      quadrant: 'quadrantChart',
      requirement: 'requirementDiagram',
      gitgraph: 'gitGraph',
      c4: 'C4Context',
      mindmap: 'mindmap',
      timeline: 'timeline',
      zenuml: 'zenuml',
      sankey: 'sankey-beta',
      xychart: 'xychart-beta',
      block: 'block-beta',
      packet: 'packet-beta',
      kanban: 'kanban',
      architecture: 'architecture-beta',
      radar: 'radar-beta',
      treemap: 'treemap-beta',
    }
    expect(Object.keys(headers).sort()).toEqual(DIAGRAM_TYPES.map((t) => t.id).sort())
    for (const [id, header] of Object.entries(headers)) {
      expect(detectDiagramType(header)?.id, header).toBe(id)
    }
  })
})

describe('flowchart parsing', () => {
  it('parses nodes, edges, labels, shapes', () => {
    const r = parse(FLOW)
    expect(r.typeInfo?.id).toBe('flowchart')
    const g = r.flowchart!
    expect(g.direction).toBe('TD')
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(g.nodeById.get('B')!.shape).toBe('diamond')
    expect(g.nodeById.get('B')!.label).toBe('Valid?')
    expect(g.edges).toHaveLength(3)
    expect(g.edges[1].label).toBe('yes')
  })

  it('parses chains, fan-out, class shorthand and quoted labels', () => {
    const code = `flowchart LR
  A & B --> C{{"Hex label"}}:::hot --> D([Stadium])
  E -. dotted .-> F
  G == thick ==> H
  classDef hot fill:#f96
`
    const g = parse(code).flowchart!
    expect(g.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'A->C',
      'B->C',
      'C->D',
      'E->F',
      'G->H',
    ])
    expect(g.nodeById.get('C')!.classes).toContain('hot')
    expect(g.nodeById.get('C')!.label).toBe('Hex label')
    expect(g.edges[3].seg.line).toBe('dotted')
    expect(g.edges[3].label).toBe('dotted')
    expect(g.edges[4].seg.line).toBe('thick')
  })

  it('treats unparseable lines as unknown without failing the document', () => {
    const code = `flowchart LR
  A --> B
  this is @@ not $$ mermaid !!!
  B --> C
`
    const g = parse(code).flowchart!
    expect(g.edges).toHaveLength(2)
  })

  it('tracks subgraphs', () => {
    const code = `flowchart TB
  subgraph api [API Layer]
    A --> B
  end
  B --> C
`
    const g = parse(code).flowchart!
    expect(g.subgraphs).toHaveLength(1)
    expect(g.subgraphs[0].title).toBe('API Layer')
    expect(g.nodeById.get('A')!.subgraph).toBe('api')
    expect(g.nodeById.get('C')!.subgraph).toBe(null)
  })
})

describe('ops → minimal text edits', () => {
  it('connect inserts a single line after last reference', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.dispatch({ type: 'connect', source: 'B', target: 'D', label: 'no' })
    expect(ed.code).toBe(`flowchart TD
  %% happy path
  A[Start] --> B{Valid?}
  B -->|yes| C[Process]
  C --> D[Done]
  B -->|no| D
`)
  })

  it('addNode uses the document letter convention', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    const res = ed.dispatch({ type: 'addNode', label: 'Retry', shape: 'round' })
    expect(res?.created).toEqual(['node:E'])
    expect(ed.code).toContain('  E(Retry)')
  })

  it('renameNode edits the label in place and quotes when needed', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.dispatch({ type: 'renameNode', id: 'A', label: 'Begin here' })
    expect(ed.code).toContain('A[Begin here] --> B{Valid?}')
    ed.dispatch({ type: 'renameNode', id: 'A', label: 'Begin (now)' })
    expect(ed.code).toContain('A["Begin (now)"] --> B{Valid?}')
  })

  it('renameNode declares label on implicit nodes', () => {
    const ed = new MermaidWysiwygEditor({ code: 'flowchart LR\n  A --> B\n' })
    ed.dispatch({ type: 'renameNode', id: 'B', label: 'The End' })
    expect(ed.code).toBe('flowchart LR\n  A --> B[The End]\n')
  })

  it('setEdgeLabel adds and edits pipe labels', () => {
    const ed = new MermaidWysiwygEditor({ code: 'flowchart LR\n  A --> B\n' })
    const edgeId = ed.result.flowchart!.edges[0].entityId
    ed.dispatch({ type: 'setEdgeLabel', edgeId, label: 'go' })
    expect(ed.code).toBe('flowchart LR\n  A -->|go| B\n')
    const edgeId2 = ed.result.flowchart!.edges[0].entityId
    ed.dispatch({ type: 'setEdgeLabel', edgeId: edgeId2, label: 'stop' })
    expect(ed.code).toBe('flowchart LR\n  A -->|stop| B\n')
  })

  it('deleteEdge preserves node declarations that live on the same line', () => {
    const ed = new MermaidWysiwygEditor({ code: 'flowchart LR\n  A[Start] --> B\n  B --> C\n' })
    const edgeId = ed.result.flowchart!.edges[0].entityId
    ed.dispatch({ type: 'deleteEdge', edgeId })
    expect(ed.code).toBe('flowchart LR\n  A[Start]\n  B --> C\n')
  })

  it('deleteNode removes its edges, splits chains, cleans class/style', () => {
    const code = `flowchart LR
  A[Start] --> B[Mid] --> C[End]
  D --> B
  class B,C important
  style B fill:#f00
`
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteNode', id: 'B' })
    // A, C keep their declarations; D survives as an isolated node
    expect(ed.code).toBe(`flowchart LR
  A[Start]
  C[End]
  D
  class C important
`)
  })

  it('setDirection edits the header token', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.dispatch({ type: 'setDirection', direction: 'LR' })
    expect(ed.code.startsWith('flowchart LR\n')).toBe(true)
  })

  it('setNodeShape rewrites delimiters keeping the label', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.dispatch({ type: 'setNodeShape', id: 'C', shape: 'stadium' })
    expect(ed.code).toContain('C([Process])')
  })

  it('setNodeColor manages a style statement (add, merge, clear)', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.dispatch({ type: 'setNodeColor', id: 'A', prop: 'fill', value: '#ef4444' })
    expect(ed.code).toContain('style A fill:#ef4444')
    ed.dispatch({ type: 'setNodeColor', id: 'A', prop: 'stroke', value: '#22c55e' })
    expect(ed.code).toContain('style A fill:#ef4444,stroke:#22c55e,stroke-width:2px')
    ed.dispatch({ type: 'setNodeColor', id: 'A', prop: 'stroke', value: null })
    ed.dispatch({ type: 'setNodeColor', id: 'A', prop: 'fill', value: null })
    expect(ed.code).not.toContain('style A')
    expect(ed.code.split('\n').filter((l) => l.trim() === '').length).toBeLessThan(2)
  })

  it('linkStyle indexes are renumbered when edge order changes', () => {
    const code = `flowchart LR
  A --> B
  B --> C
  C --> D
  linkStyle 1 stroke:#f00,stroke-width:2px
  linkStyle 2 stroke:#0f0,stroke-width:2px
`
    // deleting edge 0 shifts both styles down
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'deleteEdge', edgeId: ed.result.flowchart!.edges[0].entityId })
    expect(ed.code).toContain('linkStyle 0 stroke:#f00')
    expect(ed.code).toContain('linkStyle 1 stroke:#0f0')
    // deleting the styled edge drops its linkStyle line
    const ed2 = new MermaidWysiwygEditor({ code })
    ed2.dispatch({ type: 'deleteEdge', edgeId: ed2.result.flowchart!.edges[1].entityId })
    expect(ed2.code).not.toContain('#f00')
    expect(ed2.code).toContain('linkStyle 1 stroke:#0f0')
    // inserting an edge mid-order (after B's last ref, before C-->D) shifts later styles up
    const ed3 = new MermaidWysiwygEditor({ code })
    ed3.dispatch({ type: 'connect', source: 'A', target: 'B' })
    expect(ed3.code).toContain('linkStyle 1 stroke:#f00')
    expect(ed3.code).toContain('linkStyle 3 stroke:#0f0')
  })

  it('setEdgeColor manages a linkStyle statement by edge order', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    const second = ed.result.flowchart!.edges[1]
    ed.dispatch({ type: 'setEdgeColor', edgeId: second.entityId, value: '#06b6d4' })
    expect(ed.code).toContain('linkStyle 1 stroke:#06b6d4,stroke-width:2px')
    const again = ed.result.flowchart!.edges[1]
    ed.dispatch({ type: 'setEdgeColor', edgeId: again.entityId, value: null })
    expect(ed.code).not.toContain('linkStyle')
  })
})

describe('editor state', () => {
  it('undo/redo restores exact text across both surfaces', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.dispatch({ type: 'connect', source: 'B', target: 'D' })
    ed.setCode(ed.code.replace('Start', 'Begin'), 'code')
    const afterBoth = ed.code
    ed.undo()
    ed.undo()
    expect(ed.code).toBe(FLOW)
    ed.redo()
    ed.redo()
    expect(ed.code).toBe(afterBoth)
  })

  it('selection survives unrelated code edits and prunes on delete', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    ed.setSelection(['node:C'])
    ed.setCode(ed.code.replace('Start', 'Begin'), 'code')
    expect(ed.selection).toEqual(['node:C'])
    ed.dispatch({ type: 'deleteNode', id: 'C' })
    expect(ed.selection).toEqual([])
  })

  it('entityAt maps code offsets to entities', () => {
    const ed = new MermaidWysiwygEditor({ code: FLOW })
    const offset = ed.code.indexOf('B{Valid?}') + 1
    expect(ed.entityAt(offset)).toBe('node:B')
  })
})
