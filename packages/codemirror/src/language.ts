import { StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const HEADERS =
  /^(flowchart|graph|sequenceDiagram|classDiagram(-v2)?|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|timeline|zenuml|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|radar-beta|treemap-beta)\b/

const KEYWORDS =
  /^(participant|actor|note|loop|alt|else|opt|par|and|critical|option|break|rect|box|activate|deactivate|autonumber|over|left|right|of|end|section|title|direction|subgraph|state|class|classDef|linkStyle|style|click|namespace|dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|commit|branch|checkout|merge|cherry-pick|showData|accTitle|accDescr|columns|x-axis|y-axis|bar|line|axis|curve|max|min|for|as)\b/

// connection operators across diagram types: flowchart arrows, sequence
// messages, class relations, ER cardinalities, state transitions
const OPERATORS =
  /^(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|<-->|<--|-->|<\.\.|\.\.>|-{2,}[>xo]?|={2,}[>xo]?|-\.+-*[>xo]?|~{3,}|--?>>|--?[x)]|[|}][|o]--[|o][{|]|[|}][|o]\.\.[|o][{|]|:::?)/

const mermaidStream = StreamLanguage.define({
  name: 'mermaid',
  token(stream) {
    if (stream.sol()) stream.eatSpace()
    if (stream.match(/^%%.*/)) return 'comment'
    if (stream.match(/^"([^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^<<\w+>>/)) return 'meta'
    if (stream.match(HEADERS)) return 'heading'
    if (stream.match(KEYWORDS)) return 'keyword'
    if (stream.match(OPERATORS)) return 'operator'
    if (stream.match(/^\d{4}-\d{2}-\d{2}/)) return 'number'
    if (stream.match(/^\d+(\.\d+)?[a-z]*/)) return 'number'
    if (stream.match(/^[[\]{}()<>|&]/)) return 'bracket'
    if (stream.match(/^[\w-]+/)) return null
    stream.next()
    return null
  },
})

/** Lightweight mermaid syntax highlighting (token classes styled via CSS). */
export function mermaidLanguage(): Extension {
  return [mermaidStream, syntaxHighlighting(classHighlighter)]
}
