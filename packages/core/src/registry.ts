import type { DiagramTypeInfo } from './types'

const DOCS = 'https://mermaid.js.org'

/**
 * Every diagram type documented at https://mermaid.js.org/intro/.
 * `capability` describes what this library can do beyond rendering:
 *  - 'edit'   → full structural WYSIWYG (semantic graph + ops)
 *  - 'render' → renders through mermaid, generic CST (statement selection,
 *               comments/frontmatter handling, lossless round-trip) only.
 */
export const DIAGRAM_TYPES: DiagramTypeInfo[] = [
  { id: 'flowchart', name: 'Flowchart', match: /^(flowchart|graph)\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/flowchart.html` },
  { id: 'sequence', name: 'Sequence Diagram', match: /^sequenceDiagram\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/sequenceDiagram.html` },
  { id: 'class', name: 'Class Diagram', match: /^classDiagram(-v2)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/classDiagram.html` },
  { id: 'state', name: 'State Diagram', match: /^stateDiagram(-v2)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/stateDiagram.html` },
  { id: 'er', name: 'Entity Relationship', match: /^erDiagram\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/entityRelationshipDiagram.html` },
  { id: 'journey', name: 'User Journey', match: /^journey\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/userJourney.html` },
  { id: 'gantt', name: 'Gantt', match: /^gantt\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/gantt.html` },
  { id: 'pie', name: 'Pie Chart', match: /^pie\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/pie.html` },
  { id: 'quadrant', name: 'Quadrant Chart', match: /^quadrantChart\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/quadrantChart.html` },
  { id: 'requirement', name: 'Requirement Diagram', match: /^requirement(Diagram)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/requirementDiagram.html` },
  { id: 'gitgraph', name: 'Gitgraph', match: /^gitGraph\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/gitgraph.html` },
  { id: 'c4', name: 'C4 Diagram', match: /^C4(Context|Container|Component|Dynamic|Deployment)\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/c4.html` },
  { id: 'mindmap', name: 'Mindmap', match: /^mindmap\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/mindmap.html` },
  { id: 'timeline', name: 'Timeline', match: /^timeline\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/timeline.html` },
  { id: 'zenuml', name: 'ZenUML', match: /^zenuml\b/, capability: 'render', docsUrl: `${DOCS}/syntax/zenuml.html`, requiresPlugin: '@mermaid-js/mermaid-zenuml' },
  { id: 'sankey', name: 'Sankey', match: /^sankey(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/sankey.html` },
  { id: 'xychart', name: 'XY Chart', match: /^xychart(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/xyChart.html` },
  { id: 'block', name: 'Block Diagram', match: /^block(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/block.html` },
  { id: 'packet', name: 'Packet', match: /^packet(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/packet.html` },
  { id: 'kanban', name: 'Kanban', match: /^kanban\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/kanban.html` },
  { id: 'architecture', name: 'Architecture', match: /^architecture(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/architecture.html` },
  { id: 'radar', name: 'Radar', match: /^radar(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/radar.html` },
  { id: 'treemap', name: 'Treemap', match: /^treemap(-beta)?\b/, capability: 'edit', docsUrl: `${DOCS}/syntax/treemap.html` },
]

export function detectDiagramType(headerLine: string): DiagramTypeInfo | null {
  const trimmed = headerLine.trim()
  for (const t of DIAGRAM_TYPES) {
    if (t.match.test(trimmed)) return t
  }
  return null
}
