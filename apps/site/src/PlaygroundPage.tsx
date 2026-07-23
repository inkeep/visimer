import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import mermaid from 'mermaid'
import { MermaidCanvas, useMermaidEditor } from '@visimer/react'
import { track } from './analytics'
import {
  CodeMirrorPane,
  Logo,
  PRESETS,
  TYPE_LABELS,
  codeFromHash,
  encodeCode,
  mono,
  themeConfig,
} from './playground-shared'

/**
 * The dedicated playground at /playground. The address bar is the document:
 * every edit lands in `#code=` (debounced replaceState), so a refresh keeps
 * your work and copying the URL shares it. Samples live in a menu that
 * resets the source to the chosen diagram type.
 */
export default function PlaygroundPage() {
  const initialCode = useMemo(() => codeFromHash(window.location.hash) ?? PRESETS.flowchart, [])
  const { editor } = useMermaidEditor(initialCode)

  const [skin, setSkin] = useState<'light' | 'dark'>('light')
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // keep the URL current with the source (debounced; replaceState adds no
  // history entries, so back/forward still just leaves the page)
  useEffect(() => {
    let timer: number | undefined
    const off = editor.on('change', () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        window.history.replaceState(null, '', `#code=${encodeCode(editor.code)}`)
      }, 400)
    })
    return () => {
      window.clearTimeout(timer)
      off()
    }
  }, [editor])

  // pasting a share link into an already-open tab only changes the hash (no
  // reload) — adopt the incoming code so the link still "opens"
  useEffect(() => {
    const onHash = () => {
      const incoming = codeFromHash(window.location.hash)
      if (incoming != null && incoming !== editor.code) {
        editor.setCode(incoming, 'api')
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [editor])

  // the activation signals, same shape as the inline demo's
  const editTracked = useRef({ canvas: false, code: false })
  useEffect(() => {
    return editor.on('change', ({ origin }) => {
      if (origin === 'canvas' && !editTracked.current.canvas) {
        editTracked.current.canvas = true
        track('playground_visual_edit')
      }
      if (origin === 'code' && !editTracked.current.code) {
        editTracked.current.code = true
        track('playground_code_edit')
      }
    })
  }, [editor])

  // samples menu: outside click / Esc closes
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const loadSample = (k: string) => {
    editor.setCode(PRESETS[k], 'api')
    setMenuOpen(false)
    track('preset_switched', { preset: k, surface: 'playground-page' })
  }

  const copySource = () => {
    void navigator.clipboard?.writeText(editor.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const share = () => {
    // make sure the hash is current before copying (the debounce may not
    // have fired yet)
    window.history.replaceState(null, '', `#code=${encodeCode(editor.code)}`)
    void navigator.clipboard?.writeText(window.location.href)
    track('share_link_copied')
    setShareCopied(true)
    window.setTimeout(() => setShareCopied(false), 1400)
  }

  const dark = skin === 'dark'
  const chromeBorder = dark ? '#2E2A22' : '#E6E0D4'
  const paneBg = dark ? '#1E1B16' : '#FCFAF5'
  const previewBg = dark ? '#17140F' : '#FFFFFF'
  const paneText = dark ? '#EDE7DA' : '#1C1A17'

  const chromeBtn: CSSProperties = {
    border: `1px solid ${chromeBorder}`,
    background: dark ? '#231F19' : '#FFFFFF',
    color: dark ? '#C9C2B4' : '#544F47',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11.5,
    fontWeight: 600,
    padding: '5px 11px',
    borderRadius: 8,
    cursor: 'pointer',
  }
  const ghostBtn: CSSProperties = {
    border: `1px solid ${chromeBorder}`,
    background: 'transparent',
    color: dark ? '#9C968A' : '#6B6559',
    fontFamily: "'Inter', sans-serif",
    fontSize: 11.5,
    fontWeight: 600,
    padding: '4px 9px',
    borderRadius: 7,
    cursor: 'pointer',
  }
  const chromeLabel: CSSProperties = {
    fontSize: 11.5,
    color: dark ? '#8C8578' : '#8A857A',
    fontWeight: 500,
  }

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: dark ? '#1A1712' : '#FCFAF5',
        ...({ '--pg-border': chromeBorder } as CSSProperties),
      }}
    >
      <div
        className="pg-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 14px',
          borderBottom: `1px solid ${chromeBorder}`,
        }}
      >
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            color: paneText,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontSize: 15.5,
            marginRight: 4,
          }}
        >
          <Logo size={24} />
          Visimer
          <span style={{ ...chromeLabel, fontWeight: 600, marginLeft: 2 }}>Playground</span>
        </a>
        <div
          className="pg-controls"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={chromeBtn}
            >
              ⌗ Samples ▾
            </button>
            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 30,
                  minWidth: 170,
                  background: dark ? '#231F19' : '#FFFFFF',
                  border: `1px solid ${chromeBorder}`,
                  borderRadius: 10,
                  boxShadow: '0 12px 34px -12px rgba(28,26,23,0.35)',
                  padding: 5,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <span style={{ ...chromeLabel, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '5px 9px 4px' }}>
                  Load sample
                </span>
                {Object.keys(TYPE_LABELS).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    onClick={() => loadSample(k)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      textAlign: 'left',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 13,
                      fontWeight: 500,
                      color: dark ? '#C9C2B4' : '#544F47',
                      padding: '7px 9px',
                      borderRadius: 7,
                      cursor: 'pointer',
                    }}
                  >
                    {TYPE_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setSkin(dark ? 'light' : 'dark')} style={chromeBtn}>
            {dark ? '☾ Dark' : '☀ Light'}
          </button>
          <button
            type="button"
            className="pg-share-btn"
            onClick={share}
            style={{ ...chromeBtn, background: '#0E7C6B', border: '1px solid #0E7C6B', color: '#FFFFFF' }}
          >
            {shareCopied ? 'Link copied' : '↗ Share'}
          </button>
        </div>
      </div>

      <div
        className="pg-grid pg-grid-full"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.15fr)',
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          className={dark ? 'pg-code-pane demo-pane demo-pane-dark' : 'pg-code-pane demo-pane'}
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: paneBg,
            borderRight: `1px solid ${chromeBorder}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 44, padding: '0 14px', flex: 'none',
              borderBottom: `1px solid ${chromeBorder}`,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 99, background: '#0E7C6B' }} />
            <span style={{ fontFamily: mono, fontSize: 12.5, color: paneText }}>diagram.mmd</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" onClick={copySource} style={ghostBtn}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <CodeMirrorPane editor={editor} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: previewBg }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 44, padding: '0 14px', flex: 'none',
              borderBottom: `1px solid ${chromeBorder}`,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: paneText }}>Preview</span>
            <span className="pg-hint-long" style={chromeLabel}>
              click to select · double-click to edit · drag empty space to pan · pinch to zoom
            </span>
            <span className="pg-hint-short" style={chromeLabel}>
              tap to select · double-tap to edit · pinch to zoom
            </span>
          </div>
          <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            <MermaidCanvas
              editor={editor}
              mermaid={mermaid}
              mermaidConfig={themeConfig(skin)}
              accentColor="#0E7C6B"
              panZoom
              className="site-demo-canvas"
              style={{
                backgroundColor: previewBg,
                backgroundImage: dark
                  ? 'radial-gradient(#231f19 1px, transparent 1px)'
                  : 'radial-gradient(#EFEADF 1px, transparent 1px)',
                backgroundSize: '20px 20px',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
