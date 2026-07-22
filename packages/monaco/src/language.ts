/** Mermaid syntax highlighting for Monaco (Monarch tokens). */

/** the slice of the monaco namespace `registerMermaidLanguage` needs */
export interface MonacoNamespaceLike {
  languages: {
    getLanguages(): Array<{ id: string }>
    register(language: { id: string }): void
    setMonarchTokensProvider(languageId: string, provider: unknown): unknown
  }
}

/** Monarch token rules for mermaid source; pass to `setMonarchTokensProvider` */
export const mermaidMonarchTokens = {
  defaultToken: '',
  tokenizer: {
    root: [
      [/%%.*$/, 'comment'],
      [/"[^"]*"/, 'string'],
      [
        /^\s*(flowchart|graph|sequenceDiagram|classDiagram-v2|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|pie|gantt|journey|timeline|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|kanban|packet-beta|packet|sankey-beta|radar-beta|treemap-beta|xychart-beta|block-beta|architecture-beta|zenuml)\b/,
        'keyword',
      ],
      [
        /\b(participant|actor|boundary|control|entity|database|collections|queue|loop|alt|else|opt|par|critical|break|rect|end|subgraph|direction|title|section|class|state|note|autonumber|dateFormat|axisFormat)\b/,
        'keyword',
      ],
      [/<?[-=.]{2,}[>x)o]?|:::?/, 'operator'],
      [/\d+(\.\d+)?/, 'number'],
    ],
  },
}

/** Register the mermaid language with a monaco namespace (idempotent). */
export function registerMermaidLanguage(monaco: MonacoNamespaceLike): void {
  if (monaco.languages.getLanguages().some((l) => l.id === 'mermaid')) return
  monaco.languages.register({ id: 'mermaid' })
  monaco.languages.setMonarchTokensProvider('mermaid', mermaidMonarchTokens)
}
