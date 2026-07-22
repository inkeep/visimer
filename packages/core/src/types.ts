export interface Span {
  start: number
  end: number
}

export interface TextEdit {
  start: number
  end: number
  text: string
}

export type Origin = 'code' | 'canvas' | 'api' | 'history' | 'external'

export type Capability = 'edit' | 'render'

export interface DiagramTypeInfo {
  /** stable id, e.g. 'flowchart' */
  id: string
  /** display name, e.g. 'Flowchart' */
  name: string
  /** matched against the trimmed header line */
  match: RegExp
  /** what this library can do with the type today */
  capability: Capability
  docsUrl: string
  /** requires an external mermaid plugin to render */
  requiresPlugin?: string
}

export type LineKind =
  | 'blank'
  | 'comment'
  | 'directive'
  | 'frontmatter'
  | 'header'
  | 'statement'

export interface LineInfo {
  index: number
  kind: LineKind
  /** raw text, no newline */
  text: string
  /** absolute offset of line start */
  start: number
  /** absolute offset of line end (before newline) */
  end: number
  /** leading whitespace */
  indent: string
}

export interface Diagnostic {
  message: string
  span: Span | null
  severity: 'error' | 'warning'
  source: 'core' | 'mermaid'
}
