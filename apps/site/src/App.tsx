import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import mermaid from 'mermaid'
import { MermaidCanvas, useMermaidEditor } from '@visimer/react'
import { track } from './analytics'
import {
  CodeMirrorPane,
  Logo,
  PRESETS,
  TYPE_LABELS,
  mono,
  playgroundUrl,
  themeConfig,
} from './playground-shared'

const REPO = 'inkeep/visimer'
const REPO_URL = `https://github.com/${REPO}`
const INSTALL_CMD = 'npm i @visimer/react'


const FEATURES: Array<{ mark: string; title: string; body: string }> = [
  {
    mark: '⇄',
    title: 'Two-way sync',
    body: 'Type Mermaid or edit visually. Both stay in lockstep.',
  },
  {
    mark: '⊹',
    title: 'Click to edit',
    body: 'Select any node to rename, reshape, or restyle it.',
  },
  {
    mark: '❖',
    title: 'Minimal diffs',
    body: 'Every gesture becomes the smallest possible text edit.',
  },
  {
    mark: '{}',
    title: 'Framework-agnostic',
    body: 'Bindings for React, DOM, CodeMirror, and Monaco.',
  },
]

const kw: CSSProperties = { color: '#7FB3A8' }
const str: CSSProperties = { color: '#C9A227' }
const ident: CSSProperties = { color: '#9DBF8F' }
const cmt: CSSProperties = { color: '#8A9B96' }

function CodeCard({ title, children }: { title: string; children: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const text = preRef.current?.textContent ?? ''
    void navigator.clipboard?.writeText(text)
    track('recipe_copied', { recipe: title })
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div style={{ background: '#1E1B16', borderRadius: 16, overflow: 'hidden', border: '1px solid #2E2A22' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px 8px 16px',
          borderBottom: '1px solid #2E2A22',
          fontFamily: mono,
          fontSize: 12,
          color: '#8A9B96',
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${title} example`}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: copied ? '#0E7C6B' : '#2E2A22',
            color: '#EDE7DA',
            fontFamily: 'inherit',
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 6,
            cursor: 'pointer',
            flex: 'none',
            transition: 'background .15s',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        ref={preRef}
        className="code-card-scroll"
        style={{
          margin: 0,
          padding: '18px 16px',
          fontFamily: mono,
          fontSize: 13,
          lineHeight: 1.65,
          color: '#EDE7DA',
          overflow: 'auto',
        }}
      >
        {children}
      </pre>
    </div>
  )
}

export default function App() {
  const [type, setType] = useState('flowchart')
  const [skin, setSkin] = useState<'light' | 'dark'>('light')
  const { editor } = useMermaidEditor(PRESETS.flowchart)

  // Expanding hands off to the dedicated /playground page, carrying the
  // current source in the URL hash so nothing is lost in the jump.
  const goToPlayground = () => {
    track('playground_expanded')
    window.location.href = playgroundUrl(editor.code)
  }
  const [copied, setCopied] = useState(false)
  const [installCopied, setInstallCopied] = useState(false)
  const [ghStars, setGhStars] = useState<number | null>(null)

  // Fade the "Leave a star!" hint out as the "Open source · MIT" badge scrolls
  // up under the sticky navbar. We track the badge itself so the fade is tied
  // to the thing the user actually sees moving.
  const badgeRef = useRef<HTMLDivElement>(null)
  const [starHintOpacity, setStarHintOpacity] = useState(1)
  useEffect(() => {
    const badge = badgeRef.current
    if (!badge) return
    const navBottom = 80
    const compute = () => {
      const rect = badge.getBoundingClientRect()
      // Re-derive the fade origin every tick so a late web-font layout
      // shift or viewport resize doesn't leave the ratio stale.
      const startTop = rect.top + window.scrollY - navBottom
      if (startTop <= 0) return 0
      return Math.max(0, Math.min(1, (rect.top - navBottom) / startTop))
    }
    const onScroll = () => setStarHintOpacity(compute())
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const switchType = (next: string) => {
    setType(next)
    editor.setCode(PRESETS[next], 'api')
    track('preset_switched', { preset: next })
  }

  // The activation signals: did this visitor actually edit the diagram —
  // visually (canvas gesture) or textually (source pane)? Once per session
  // each, so live-commit keystrokes don't spew events.
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

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        if (typeof d.stargazers_count === 'number') setGhStars(d.stargazers_count)
      })
      .catch(() => {})
  }, [])

  const starsLabel =
    ghStars == null ? 'Star' : ghStars >= 1000 ? `${(ghStars / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(ghStars)
  const licenseLabel = 'MIT'

  const copyInstall = () => {
    void navigator.clipboard?.writeText(INSTALL_CMD)
    track('install_copied')
    setInstallCopied(true)
    window.setTimeout(() => setInstallCopied(false), 1400)
  }
  const copySource = () => {
    void navigator.clipboard?.writeText(editor.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const reset = () => editor.setCode(PRESETS[type], 'api')

  const dark = skin === 'dark'
  const chromeBorder = dark ? '#2E2A22' : '#E6E0D4'
  const paneBg = dark ? '#1E1B16' : '#FCFAF5'
  const previewBg = dark ? '#17140F' : '#FFFFFF'
  const paneText = dark ? '#EDE7DA' : '#1C1A17'

  const pill = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? '#0E7C6B' : chromeBorder}`,
    background: active ? '#0E7C6B' : dark ? '#231F19' : '#FFFFFF',
    color: active ? '#FFFFFF' : dark ? '#C9C2B4' : '#544F47',
    fontFamily: "'Inter', sans-serif",
    fontSize: 12.5,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all .12s',
  })
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
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backdropFilter: 'blur(12px)',
          background: 'rgba(247,244,237,0.82)',
          borderBottom: '1px solid #E6E0D4',
        }}
      >
        <div
          className="site-header-row"
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            padding: '13px 26px',
            display: 'flex',
            alignItems: 'center',
            gap: 26,
          }}
        >
          <a
            href="#top"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#1C1A17',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontSize: 16.5,
            }}
          >
            <Logo size={26} />
            Visimer
          </a>
          <nav className="site-nav" style={{ display: 'flex', gap: 22, marginLeft: 6, fontSize: 14.5 }}>
            <a href="#demo" style={{ color: '#6B6559' }}>
              Playground
            </a>
            <a href="#features" style={{ color: '#6B6559' }}>
              Features
            </a>
            <a href="#install" style={{ color: '#6B6559' }}>
              Install
            </a>
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
            <a
              href={REPO_URL}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 13.5,
                color: '#1C1A17',
                border: '1px solid #E6E0D4',
                background: '#FCFAF5',
                padding: '7px 12px',
                borderRadius: 9,
                fontWeight: 500,
                position: 'relative',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="#1C1A17">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <span style={{ fontWeight: 600 }}>{starsLabel}</span>
            </a>
            <div
              aria-hidden
              className="site-star-hint"
              style={{
                position: 'absolute',
                top: 'calc(100% + 14px)',
                right: 2,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
                opacity: starHintOpacity,
                transition: 'opacity 120ms linear',
              }}
            >
              <span
                style={{
                  fontFamily: "'Caveat', cursive",
                  fontSize: 21,
                  fontWeight: 600,
                  color: '#C9713B',
                  whiteSpace: 'nowrap',
                  transform: 'rotate(-4deg)',
                  marginTop: 16,
                }}
              >
                Leave a star!
              </span>
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none" style={{ marginTop: 0 }}>
                <path
                  d="M4 30 C16 28, 26 20, 28 6"
                  stroke="#C9713B"
                  strokeWidth="2.2"
                  fill="none"
                  strokeLinecap="round"
                />
                <path d="M28 6 L21.5 9.5 M28 6 L29.5 13" stroke="#C9713B" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
            </div>
            <a
              href="#install"
              style={{
                fontSize: 13.5,
                background: '#1C1A17',
                color: '#F7F4ED',
                padding: '8px 15px',
                borderRadius: 9,
                fontWeight: 600,
              }}
            >
              npm install
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section style={{ maxWidth: 1000, margin: '0 auto', padding: '82px 26px 30px', textAlign: 'center' }}>
          <div
            ref={badgeRef}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              fontSize: 13,
              color: '#6B6559',
              border: '1px solid #E6E0D4',
              background: '#FCFAF5',
              padding: '6px 13px',
              borderRadius: 999,
              letterSpacing: '0.01em',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: '#0E7C6B', display: 'inline-block' }} />
            Open source · {licenseLabel} · React &amp; vanilla
          </div>
          <h1
            style={{
              fontFamily: "'Inter', sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(42px, 6.6vw, 76px)',
              lineHeight: 1.04,
              letterSpacing: '-0.035em',
              margin: '26px 0 0',
              textWrap: 'balance',
            }}
          >
            Edit Mermaid diagrams <em style={{ fontStyle: 'normal', color: '#0E7C6B' }}>visually.</em>
          </h1>
          <p
            style={{
              maxWidth: 620,
              margin: '22px auto 0',
              fontSize: 18.5,
              lineHeight: 1.55,
              color: '#544F47',
              textWrap: 'pretty',
            }}
          >
            Click a node to edit it. Perfect for polishing AI-generated diagrams.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', marginTop: 30 }}>
            <a
              href="/playground"
              style={{
                background: '#1C1A17',
                border: '1px solid #1C1A17',
                color: '#F7F4ED',
                padding: '13px 22px',
                borderRadius: 11,
                fontWeight: 600,
                fontSize: 15,
                lineHeight: '20px',
                cursor: 'pointer',
              }}
            >
              Open the playground
            </a>
            <a
              href="https://openknowledge.ai"
              target="_blank"
              rel="noreferrer"
              style={{
                background: '#FCFAF5',
                border: '1px solid #E6E0D4',
                color: '#1C1A17',
                padding: '13px 22px',
                borderRadius: 11,
                fontWeight: 600,
                fontSize: 15,
                lineHeight: '20px',
              }}
            >
              Try with Open Knowledge ↗
            </a>
            <a
              href="#install"
              style={{
                background: 'transparent',
                border: '1px solid transparent',
                color: '#544F47',
                padding: '13px 12px',
                borderRadius: 11,
                fontWeight: 600,
                fontSize: 15,
                lineHeight: '20px',
              }}
            >
              Install
            </a>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 26,
              background: '#1E1B16',
              color: '#EDE7DA',
              fontFamily: mono,
              fontSize: 14,
              padding: '11px 15px',
              borderRadius: 11,
            }}
          >
            <span style={{ color: '#8A9B96' }}>$</span>
            <span>{INSTALL_CMD}</span>
            <button
              type="button"
              onClick={copyInstall}
              style={{
                border: 'none',
                background: '#2E2A22',
                color: '#EDE7DA',
                fontFamily: 'inherit',
                fontSize: 12,
                padding: '5px 9px',
                borderRadius: 7,
                cursor: 'pointer',
              }}
            >
              {installCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>

        <section id="demo" style={{ maxWidth: 1200, margin: '0 auto', padding: '34px 26px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: '#0E7C6B',
                background: '#EAF3F0',
                borderRadius: 999,
                padding: '6px 14px',
              }}
            >
              Playground
            </div>
            <h2
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: 'clamp(30px, 4.2vw, 46px)',
                letterSpacing: '-0.03em',
                margin: '14px 0 0',
              }}
            >
              Take it for a spin.
            </h2>
            <p style={{ color: '#544F47', fontSize: 17, maxWidth: 560, margin: '12px auto 0', textWrap: 'pretty' }}>
              The real editor, running in your browser. Nothing to install.
            </p>
          </div>
          <div
            style={{
              background: dark ? '#1A1712' : '#FCFAF5',
              border: `1px solid ${chromeBorder}`,
              overflow: 'hidden',
              borderRadius: 20,
              boxShadow: '0 30px 70px -30px rgba(28,26,23,0.28)',
              // the mobile stylesheet needs the pane divider color (it turns the
              // pane border-right into a border-bottom); custom props aren't in
              // CSSProperties' type
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
                padding: '12px 14px',
                borderBottom: `1px solid ${chromeBorder}`,
              }}
            >
              <div className="pg-presets" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.keys(TYPE_LABELS).map((k) => (
                  <button key={k} type="button" onClick={() => switchType(k)} style={pill(type === k)}>
                    {TYPE_LABELS[k]}
                  </button>
                ))}
              </div>
              <div
                className="pg-controls"
                style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
              >
                <button
                  type="button"
                  onClick={() => setSkin(dark ? 'light' : 'dark')}
                  style={{
                    border: `1px solid ${chromeBorder}`,
                    background: dark ? '#231F19' : '#FFFFFF',
                    color: dark ? '#C9C2B4' : '#544F47',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '5px 11px',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  {dark ? '☾ Dark' : '☀ Light'}
                </button>
                <button
                  type="button"
                  className="pg-expand-btn"
                  onClick={goToPlayground}
                  aria-label="Open the full playground page with the current diagram"
                  title="Open the full playground"
                  style={{
                    border: `1px solid ${chromeBorder}`,
                    background: dark ? '#231F19' : '#FFFFFF',
                    color: dark ? '#C9C2B4' : '#544F47',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '5px 11px',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  ⛶ Expand
                </button>
              </div>
            </div>

            <div
              className="pg-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.15fr)',
                height: 480,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  background: paneBg,
                  borderRight: `1px solid ${chromeBorder}`,
                }}
                className={dark ? 'pg-code-pane demo-pane demo-pane-dark' : 'pg-code-pane demo-pane'}
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
                  <span style={{ fontFamily: mono, fontSize: 12.5, color: paneText }}>{type}.mmd</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button type="button" onClick={copySource} style={ghostBtn}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button type="button" onClick={reset} style={ghostBtn}>
                      Reset
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
          <p style={{ textAlign: 'center', color: '#8A857A', fontSize: 13.5, marginTop: 14 }}>
            Tip: click any box in the preview. The popover on the diagram edits it. Watch the source pane rewrite
            itself.
          </p>
        </section>

        <section id="features" style={{ maxWidth: 1140, margin: '0 auto', padding: '64px 26px 20px' }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(30px, 4.2vw, 46px)',
              letterSpacing: '-0.03em',
              textAlign: 'center',
              margin: 0,
            }}
          >
            Diagrams you can actually touch.
          </h2>
          <p style={{ textAlign: 'center', color: '#544F47', fontSize: 17, maxWidth: 560, margin: '14px auto 0', textWrap: 'pretty' }}>
            Fix a diagram fast. No re-learning Mermaid syntax to move one arrow.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
              marginTop: 38,
            }}
          >
            {FEATURES.map((f) => (
              <div key={f.title} style={{ background: '#FCFAF5', border: '1px solid #E6E0D4', borderRadius: 16, padding: 22 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: '#EAF3F0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#0E7C6B',
                    fontFamily: mono,
                    fontWeight: 600,
                    fontSize: 15,
                  }}
                >
                  {f.mark}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 600, margin: '15px 0 6px', letterSpacing: '-0.01em' }}>{f.title}</h3>
                <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#544F47', margin: 0, textWrap: 'pretty' }}>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="install" style={{ maxWidth: 1000, margin: '0 auto', padding: '64px 26px 30px' }}>
          <h2
            style={{
              fontFamily: "'Inter', sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(30px, 4.2vw, 46px)',
              letterSpacing: '-0.03em',
              textAlign: 'center',
              margin: '0 0 8px',
            }}
          >
            Add it to your own editor.
          </h2>
          <p style={{ textAlign: 'center', color: '#544F47', fontSize: 17, maxWidth: 600, margin: '0 auto 30px' }}>
            The playground above is this exact package. Six recipes cover it all.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
            <CodeCard title="React · @visimer/react">
              <span style={cmt}># npm i @visimer/react</span>
              {'\n'}
              <span style={kw}>import</span> mermaid <span style={kw}>from</span> <span style={str}>'mermaid'</span>
              {'\n'}
              <span style={kw}>import</span> {'{ MermaidWysiwyg }'} <span style={kw}>from</span>{' '}
              <span style={str}>'@visimer/react'</span>
              {'\n\n'}&lt;<span style={ident}>MermaidWysiwyg</span> <span style={str}>code</span>={'{diagram}'}{' '}
              <span style={str}>onCodeChange</span>={'{setDiagram}'} <span style={str}>mermaid</span>={'{mermaid}'} /&gt;
            </CodeCard>
            <CodeCard title="Vanilla · @visimer/core + @visimer/dom">
              <span style={cmt}># npm i @visimer/core @visimer/dom mermaid</span>
              {'\n'}
              <span style={kw}>import</span> mermaid <span style={kw}>from</span> <span style={str}>'mermaid'</span>
              {'\n'}
              <span style={kw}>import</span> {'{ MermaidWysiwygEditor }'} <span style={kw}>from</span>{' '}
              <span style={str}>'@visimer/core'</span>
              {'\n'}
              <span style={kw}>import</span> {'{ MermaidCanvasView }'} <span style={kw}>from</span>{' '}
              <span style={str}>'@visimer/dom'</span>
              {'\n\n'}
              <span style={kw}>const</span> editor = <span style={kw}>new</span> <span style={ident}>MermaidWysiwygEditor</span>({'{ '}
              <span style={str}>code</span>
              {' }'})
              {'\n'}
              <span style={kw}>new</span> <span style={ident}>MermaidCanvasView</span>({'{ '}
              <span style={str}>editor</span>, <span style={str}>container</span>, <span style={str}>mermaid</span>
              {' }'})
            </CodeCard>
            <CodeCard title="CodeMirror pane · @visimer/codemirror">
              <span style={cmt}># npm i @visimer/codemirror</span>
              {'\n'}
              <span style={kw}>import</span> {'{ MermaidCodeMirror }'} <span style={kw}>from</span>{' '}
              <span style={str}>'@visimer/codemirror'</span>
              {'\n\n'}
              <span style={kw}>new</span> <span style={ident}>MermaidCodeMirror</span>(host, editor)
              {'\n'}
              <span style={cmt}># typing, highlights, undo, all shared with the canvas</span>
            </CodeCard>
            <CodeCard title="Monaco · @visimer/monaco">
              <span style={cmt}># npm i @visimer/monaco  (bring your own monaco instance)</span>
              {'\n'}
              <span style={kw}>import</span> {'{ bindMonaco }'} <span style={kw}>from</span>{' '}
              <span style={str}>'@visimer/monaco'</span>
              {'\n\n'}
              <span style={kw}>const</span> binding = <span style={ident}>bindMonaco</span>(editor, monacoEditor)
              {'\n'}binding.<span style={ident}>dispose</span>()
            </CodeCard>
            <CodeCard title="Headless · drive it from code">
              <span style={cmt}># every gesture is also a semantic op</span>
              {'\n'}editor.<span style={ident}>dispatch</span>({'{ '}
              <span style={str}>type</span>: <span style={str}>'renameNode'</span>, <span style={str}>id</span>:{' '}
              <span style={str}>'B'</span>, <span style={str}>label</span>: <span style={str}>'Valid?'</span>
              {' }'})
              {'\n'}editor.<span style={ident}>dispatch</span>({'{ '}
              <span style={str}>type</span>: <span style={str}>'connect'</span>, <span style={str}>source</span>:{' '}
              <span style={str}>'A'</span>, <span style={str}>target</span>: <span style={str}>'C'</span>
              {' }'})
              {'\n'}editor.<span style={ident}>undo</span>()
            </CodeCard>
            <CodeCard title="Theming · CSS variables">
              <span style={cmt}># chrome follows your tokens; mermaid keeps its themes</span>
              {'\n'}.mw-canvas {'{'}
              {'\n'}  <span style={str}>--mw-accent</span>: <span style={ident}>#0E7C6B</span>;
              {'\n'}  <span style={str}>--mw-chrome-bg</span>: <span style={ident}>#1E1B16</span>;
              {'\n'}  <span style={str}>--mw-chrome-fg</span>: <span style={ident}>#EDE7DA</span>;
              {'\n'}{'}'}
              {'\n'}
              <span style={cmt}># or per-instance: accentColor · mermaidConfig={'{ theme: "dark" }'}</span>
            </CodeCard>
          </div>
        </section>

        <footer style={{ borderTop: '1px solid #E6E0D4', marginTop: 40 }}>
          <div
            style={{
              maxWidth: 1140,
              margin: '0 auto',
              padding: '34px 26px',
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, letterSpacing: '-0.02em' }}>
              <Logo size={22} />
              Visimer
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 14, marginLeft: 8, flexWrap: 'wrap' }}>
              <a href={REPO_URL} style={{ color: '#6B6559' }}>
                GitHub
              </a>
              <a href="https://www.npmjs.com/package/@visimer/react" style={{ color: '#6B6559' }}>
                npm
              </a>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#A39D90' }}>
              {licenseLabel} licensed · built in the open
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
