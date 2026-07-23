import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { MermaidCodeMirror } from '@visimer/codemirror'
import type { MermaidWysiwygEditor } from '@visimer/core'

/** Sample diagrams + chrome shared by the inline demo and /playground. */

export const PRESETS: Record<string, string> = {
  flowchart: `flowchart LR
    A[Write a doc] --> B{Needs a diagram?}
    B -->|Yes| C[Click a node to edit]
    B -->|No| D[Keep writing]
    C --> E[Source stays in sync]`,
  sequence: `sequenceDiagram
    participant H as Human
    participant E as Editor
    participant D as Diagram
    H->>E: Click a node
    E->>D: Rewrite label
    D-->>E: Re-render
    E-->>H: Source in sync`,
  class: `classDiagram
    class Editor {
      +String source
      +render()
      +selectNode()
    }
    class Diagram {
      +Node[] nodes
      +Edge[] edges
    }
    Editor --> Diagram : drives`,
  state: `stateDiagram-v2
    [*] --> Editing
    Editing --> Previewing : render
    Previewing --> Editing : click node
    Previewing --> [*] : done`,
  er: `erDiagram
    DOC ||--o{ DIAGRAM : contains
    DIAGRAM ||--|{ NODE : has
    NODE }o--o{ EDGE : connects`,
  gantt: `gantt
    title Release plan
    dateFormat YYYY-MM-DD
    section Build
    Editor core      :done, a1, 2026-01-01, 20d
    Visual editing   :active, a2, after a1, 15d
    section Ship
    Docs             :a3, after a2, 10d
    v1.0             :milestone, m1, after a3, 0d`,
}

export const TYPE_LABELS: Record<string, string> = {
  flowchart: 'Flowchart',
  sequence: 'Sequence',
  class: 'Class',
  state: 'State',
  er: 'ER',
  gantt: 'Gantt',
}

export const mono = "'JetBrains Mono', monospace"

/**
 * One mermaid palette per color mode — no user-facing theme picker. Light is
 * the site's paper palette (cream surfaces, teal primaries, gold accents).
 * Dark follows Open Knowledge's mermaid treatment — node fills with no
 * visible outline, muted connector strokes instead of mermaid's harsh
 * near-white lines, clusters as darker tiers, notes as a bold gold callout —
 * transposed into the site's warm dark tones. Plain hex on purpose: mermaid
 * runs color math over these strings, so CSS variables don't survive.
 */
export function themeConfig(mode: 'light' | 'dark'): Record<string, unknown> {
  const base = { fontFamily: '"Inter", sans-serif' }
  if (mode === 'dark') {
    return {
      theme: 'base',
      themeVariables: {
        ...base,
        darkMode: true,
        background: '#17140F',
        primaryColor: '#26221B',
        primaryTextColor: '#EDE7DA',
        primaryBorderColor: '#26221B',
        secondaryColor: '#2C2720',
        secondaryTextColor: '#EDE7DA',
        secondaryBorderColor: '#3A342A',
        tertiaryColor: '#322C24',
        tertiaryTextColor: '#EDE7DA',
        tertiaryBorderColor: '#3A342A',
        mainBkg: '#26221B',
        textColor: '#EDE7DA',
        lineColor: '#6B655A',
        defaultLinkColor: '#6B655A',
        // NOT the fill color (the OK borderless-node trick): class diagrams
        // draw their compartment dividers with this same stroke, so it has to
        // stay faintly visible
        nodeBorder: '#3A342A',
        clusterBkg: '#1E1A14',
        clusterBorder: '#3A342A',
        edgeLabelBackground: '#17140F',
        titleColor: '#A39D90',
        actorBkg: '#26221B',
        actorBorder: '#3A342A',
        actorTextColor: '#EDE7DA',
        actorLineColor: '#544E42',
        signalColor: '#8F887A',
        signalTextColor: '#A39D90',
        labelBoxBkgColor: '#26221B',
        labelBoxBorderColor: '#544E42',
        labelTextColor: '#A39D90',
        loopTextColor: '#A39D90',
        noteBkgColor: '#C9A227',
        noteTextColor: '#1C1A17',
        noteBorderColor: '#C9A227',
        activationBkgColor: '#322C24',
        activationBorderColor: '#464034',
      },
    }
  }
  return {
    theme: 'base',
    themeVariables: {
      ...base,
      primaryColor: '#EAF3F0',
      primaryBorderColor: '#0E7C6B',
      primaryTextColor: '#1C1A17',
      lineColor: '#8A9B96',
      secondaryColor: '#F5E9C9',
      secondaryBorderColor: '#C9A227',
      tertiaryColor: '#FBF9F4',
      tertiaryBorderColor: '#E6E0D4',
      noteBkgColor: '#F5E9C9',
      noteTextColor: '#1C1A17',
      noteBorderColor: '#C9A227',
    },
  }
}

export function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" style={{ flex: 'none' }}>
      <rect x="1" y="8.5" width="9" height="9" rx="2.4" fill="#0E7C6B" />
      <rect x="16" y="1" width="9" height="9" rx="2.4" fill="#1C1A17" />
      <rect x="16" y="16" width="9" height="9" rx="2.4" fill="#C9A227" />
      <path
        d="M10 12.2 H14 Q15 12.2 15 11.2 V6.8 Q15 5.8 16 5.8"
        stroke="#1C1A17"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M10 13.8 H14 Q15 13.8 15 14.8 V19.2 Q15 20.2 16 20.2"
        stroke="#C9A227"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * The demo's source pane IS the published CodeMirror binding: two-way sync,
 * mermaid syntax highlighting, entity highlights on canvas selection, and the
 * engine's unified undo — nothing site-specific beyond styling.
 */
export function CodeMirrorPane({ editor }: { editor: MermaidWysiwygEditor }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hostRef.current) return
    // wrap long lines — on phones the pane is full-width but short, and a
    // clipped line with no scroll affordance reads as missing code
    const cm = new MermaidCodeMirror(hostRef.current, editor, [EditorView.lineWrapping])
    return () => cm.destroy()
  }, [editor])
  return <div ref={hostRef} className="demo-cm" />
}

// ---- code <-> URL hash codec ----
// The playground keeps the current source in `#code=<base64url(utf8)>` so the
// address bar is always a share link. No compression: sample-sized diagrams
// stay comfortably under URL limits, and zero deps beats shaving bytes.

export function encodeCode(code: string): string {
  const bytes = new TextEncoder().encode(code)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeCode(encoded: string): string | null {
  try {
    const b64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const bin = atob(b64)
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** URL for the dedicated playground carrying `code` (omit for the default sample). */
export function playgroundUrl(code?: string): string {
  return code ? `/playground#code=${encodeCode(code)}` : '/playground'
}

export function codeFromHash(hash: string): string | null {
  const m = hash.match(/code=([A-Za-z0-9_-]+)/)
  return m ? decodeCode(m[1]) : null
}
