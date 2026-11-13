import { useEffect, useRef, useState, type CSSProperties } from 'react'
import mermaid from 'mermaid'
import { MermaidCanvas, useMermaidEditor } from '@visimer/react'
import { track } from './analytics'
import {
  HERO_HEADLINE,
  HERO_HINT_BODY,
  HERO_HINT_LEAD,
  HERO_LICENSE,
  HERO_SOURCE_LR,
  HERO_SOURCE_TD,
  HERO_STACK_MAX_WIDTH,
  HERO_SUBHEAD,
  heroPlaceholderFor,
  heroPlaceholderViewBox,
} from './hero-diagram'
import {
  CodeMirrorPane,
  Logo,
  CopyStatus,
  PRESETS,
  PRESET_KEYS,
  TYPE_LABELS,
  scrollBehavior,
  useCopy,
  type PresetKey,
  mono,
  playgroundUrl,
  themeConfig,
  useCanvasControlTracking,
} from './playground-shared'
import {
  ClosingCta,
  DiagramTypes,
  FeatureBento,
  GitHubMark,
  HowItWorks,
  InstallPill,
  Integrate,
  OpenKnowledgeBand,
  REPO,
  REPO_URL,
  SectionHeader,
  SiteFooter,
  StatStrip,
} from './home-sections'
import './home.css'

/**
 * Direction is picked once at mount rather than on every resize: a phone fits the
 * left-to-right layout by width, which shrinks the headline to caption size, but
 * re-picking on resize would overwrite whatever the visitor had typed into it.
 */
function initialHeroSource(): string {
  if (typeof window === 'undefined') return HERO_SOURCE_LR
  return window.innerWidth <= HERO_STACK_MAX_WIDTH ? HERO_SOURCE_TD : HERO_SOURCE_LR
}

/**
 * Mermaid lays the headline out at display size, so this config carries the type
 * scale rather than CSS scaling a small render up. Node padding is deliberately
 * tight: the masthead fits to width, so every unit of padding is paid for in
 * headline size.
 */
const heroConfig = {
  theme: 'base',
  // wrappingWidth defaults to 200: any single-line label past ~14 chars
  // trips mermaid's `display: table; white-space: break-spaces; width:
  // 200px` wrap-safe layout and reserves a phantom second line of
  // height (the "newline under the first node text" bug: type " NEW
  // TEXT" into "WYSIWYG editor" and the box grows by ~24 px). Bumping
  // it lets typical hero labels stay on one line and one line high.
  flowchart: { padding: 11, nodeSpacing: 44, rankSpacing: 44, useMaxWidth: false, wrappingWidth: 800 },
  themeVariables: {
    fontFamily: "'Inter', sans-serif",
    primaryColor: '#EAF3F0',
    primaryBorderColor: '#0E7C6B',
    primaryTextColor: '#1C1A17',
    lineColor: '#0E7C6B',
    secondaryColor: '#F5E9C9',
    secondaryBorderColor: '#C9A227',
    tertiaryColor: '#FBF9F4',
    tertiaryBorderColor: '#E6E0D4',
    mainBkg: '#EAF3F0',
    nodeBorder: '#0E7C6B',
    textColor: '#1C1A17',
    // No edgeLabelBackground: mermaid ignores it for flowchart edge labels and
    // backs them with the secondary tint instead, so site.css sets it.
  },
}


const stroke = { stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' } as const

/**
 * Hand-drawn nudges inside the inline playground, in the same Caveat/terracotta
 * voice as the navbar's "Leave a star!" hint. Each one lives in its own pane and
 * points at that pane's content rather than at the chrome above it:
 *
 * - source sits in the code pane's flow directly under the last line of code, so
 *   its arrow reaches up into the source no matter how tall the preset is;
 * - preview pins to the canvas floor, clear of the zoom controls.
 *
 * Each arrow is drawn with its tip on the viewBox's horizontal centre (x=18 of
 * 36) and the tail curving out towards its label, so centring the arrow in the
 * grid lands the tip on the middle of the content it points at. The two differ
 * only in which side the tail sweeps from, which is the side its text sits on.
 *
 * Both are pointer-events: none, so neither can eat a click meant for the editor.
 */
function PlaygroundCallout({ target }: { target: 'source' | 'preview' }) {
  if (target === 'source') {
    return (
      <div className="pg-callout pg-callout-source" aria-hidden>
        <svg className="pg-callout-arrow" viewBox="0 0 36 48" fill="none">
          <path d="M31 41 C26 44, 15 40, 18 10" {...stroke} />
          <path d="M18 10 L13.3 16.5 M18 10 L21.3 17.3" {...stroke} />
        </svg>
        <span className="pg-callout-text">Edit here</span>
      </div>
    )
  }
  return (
    <div className="pg-callout pg-callout-preview" aria-hidden>
      <span className="pg-callout-text">or edit here</span>
      <svg className="pg-callout-arrow" viewBox="0 0 36 48" fill="none">
        <path d="M5 41 C10 44, 21 40, 18 10" {...stroke} />
        <path d="M18 10 L14.7 17.3 M18 10 L22.7 16.5" {...stroke} />
      </svg>
    </div>
  )
}

export default function App() {
  const [type, setType] = useState<PresetKey>('flowchart')
  const [skin, setSkin] = useState<'light' | 'dark'>('light')
  const { editor } = useMermaidEditor(PRESETS.flowchart)

  // The headline runs on its own editor so editing it never disturbs the
  // playground below, and vice versa.
  const [heroInitial] = useState(initialHeroSource)
  const { editor: heroEditor } = useMermaidEditor(heroInitial)
  const [heroSource, setHeroSource] = useState(heroInitial)
  useEffect(() => heroEditor.on('change', ({ code }) => setHeroSource(code.trim())), [heroEditor])

  // The stand-in headline stays up until mermaid has actually put an SVG on the
  // page, which is a good half-second after mount on a cold load: the renderer
  // arrives over its own dynamic imports and then has to lay the diagram out.
  // Gating on mount instead would reopen the hole this is here to close.
  //
  // A failed parse also resolves this — the canvas shows its own error badge for
  // that, and a visitor who has typed the headline into an invalid state is
  // better served seeing that badge than the original sentence sitting under it.
  const [heroRendered, setHeroRendered] = useState(false)

  useCanvasControlTracking()

  // Expanding hands off to the dedicated /playground page, carrying the
  // current source in the URL hash so nothing is lost in the jump.
  const goToPlayground = () => {
    track('playground_expanded')
    window.location.href = playgroundUrl(editor.code)
  }
  const { copiedKey: sourceCopied, copy: copyText } = useCopy()
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

  const switchType = (next: PresetKey) => {
    setType(next)
    editor.setCode(PRESETS[next], 'api')
    track('preset_switched', { preset: next })
  }
  const tryPreset = (next: PresetKey) => {
    switchType(next)
    document.querySelector<HTMLButtonElement>(`#demo [data-preset="${next}"]`)?.focus({ preventScroll: true })
    document.getElementById('demo')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
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

  const starCount =
    ghStars == null ? null : ghStars >= 1000 ? `${(ghStars / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(ghStars)
  const starsLabel = starCount ?? 'Star'
  // Shared with the first-paint copy of the badge, which the build inlines into
  // index.html from the same module.
  const licenseLabel = HERO_LICENSE

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
        className="site-header"
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
            <a href="#diagrams" style={{ color: '#6B6559' }}>
              Diagrams
            </a>
            <a href="#how" style={{ color: '#6B6559' }}>
              How it works
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
              <GitHubMark color="#1C1A17" />
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

      {/* The hero canvas is 100vw, which counts the scrollbar on platforms that
          reserve space for one, so it would sit a few pixels wider than the page
          and add a horizontal scrollbar. `clip` trims that without creating a
          scroll container, so the sticky header above is unaffected. */}
      <main id="top" style={{ overflowX: 'clip' }}>
        {/* Wider than the old 1000px hero: the headline is now fit to the width of
            this container, so a narrow one renders it well below the 76px the
            text h1 used to carry. 1180 matches the demo section below it. */}
        {/* Geometry for this block lives in site.css rather than inline, because
            the served document paints a copy of it before React exists (see
            hero-diagram.ts). Two sources for the same vertical rhythm means the
            mount visibly nudges the page; one means it does not. */}
        <section className="hero-section">
          <div ref={badgeRef} className="hero-badge">
            <span className="hero-badge-dot" />
            Open source · {licenseLabel} · React &amp; vanilla
          </div>

          {/* The canvas is not a card in the hero, it IS the hero: full-bleed to the
              window, on the page's own background, with no border, fill or radius of
              its own. Only the diagram is drawn, so the band reads as open page.

              It stays in flow rather than sitting behind the whole section. Mermaid
              centres the diagram in its canvas, so a canvas spanning the section
              would centre on the section's midpoint, which on a phone lands on top
              of the copy. Owning its own band keeps that under control. */}
          {/* The heading is the text; the canvas is its rendering. Keeping them as
              separate elements matters: with the canvas inside the h1, the heading
              exposed the sentence once as its own text and then again, out of
              order, from the diagram's own labels, and its textContent picked up
              the whole stylesheet mermaid injects. The canvas is hidden from
              assistive tech because it duplicates the heading and its editing is
              pointer-only, so exposing it would add confusion without adding a
              capability.

              This text deliberately does not track edits to the diagram. It is the
              page's heading, and rewriting it under an assistive-tech user as
              somebody types would churn the accessibility tree and the document
              outline for a change only the editing visitor made, to their own
              local copy. The live source is echoed in the hint line below instead. */}
          <h1 className="sr-only">{HERO_HEADLINE}</h1>
          <div className={`hero-masthead${heroRendered ? ' is-rendered' : ''}`} aria-hidden>
            {/* Same markup the served document already painted, minus the
                media-query orientation pick: this one is fed the source the
                editor actually got, so both halves of the crossfade follow one
                decision. Rendering it again here rather than leaving the boot
                copy in place keeps the band under React's control — the copy is
                torn out with the rest of #root on mount, and this one crossfades
                out on its own schedule. */}
            <div
              className="hero-placeholder-layer"
              dangerouslySetInnerHTML={{ __html: heroPlaceholderFor(heroInitial) }}
            />
            <MermaidCanvas
              editor={heroEditor}
              mermaid={mermaid}
              mermaidConfig={heroConfig}
              accentColor="#0E7C6B"
              className="site-demo-canvas"
              // The binding defaults the host to min-height 240, which fights the
              // absolute inset positioning: between 761 and 999px the band is
              // shorter than that, so the canvas outgrows the box and the diagram
              // drifts off centre into the hint below.
              style={{ backgroundColor: 'transparent', minHeight: 0 }}
              // The canvas host sets tabIndex 0, which would leave a tab stop
              // inside this aria-hidden subtree that announces nothing and does
              // nothing, since editing here is pointer-only.
              onReady={(view) => {
                view.container.tabIndex = -1
                // Only the first render is comparable to the stand-in; once the
                // visitor edits the headline the diagram is legitimately a
                // different shape.
                let driftChecked = false
                // The view kicks off its first render in its constructor and
                // awaits mermaid before emitting, so this subscription is in
                // place well before the event it is waiting for.
                view.on('render', () => {
                  setHeroRendered(true)
                  // Nothing else notices when the stand-in's hand-measured
                  // coordinates stop matching mermaid's output — reword the
                  // hero, retune heroConfig or bump mermaid and the only symptom
                  // is a stand-in that shifts as it fades, on a cold load, which
                  // is invisible in normal development. The viewBox is the one
                  // number the whole fit depends on, so compare it here.
                  if (import.meta.env.DEV && !driftChecked) {
                    driftChecked = true
                    const rendered = view.container.querySelector('.mw-svg-host > svg')?.getAttribute('viewBox')
                    const expected = heroPlaceholderViewBox(heroInitial)
                    if (rendered && rendered !== expected) {
                      console.warn(
                        `[hero] stand-in viewBox is stale: mermaid rendered "${rendered}", hero-diagram.ts has "${expected}". Re-derive the coordinates in hero-diagram.ts.`,
                      )
                    }
                  }
                })
              }}
            />
          </div>
          <div className="hero-hint">
            <span className="hero-hint-lead">{HERO_HINT_LEAD}</span>
            <span>{HERO_HINT_BODY}</span>
            {/* the statement line only: "flowchart LR" is noise in a one-line hint */}
            <code style={{ fontFamily: mono, fontSize: 12.5, color: '#6B6559' }}>
              {heroSource.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()}
            </code>
          </div>
          <p className="hero-sub">{HERO_SUBHEAD}</p>
          <div className="cta-row">
            <a className="btn btn-dark" href="/playground" onClick={() => track('playground_cta_clicked', { location: 'hero' })}>
              Open the playground
            </a>
            <a className="btn btn-light" href={REPO_URL} onClick={() => track('github_clicked', { location: 'hero' })}>
              <GitHubMark /> Star on GitHub
              {starCount ? <span className="btn-count">{starCount}</span> : null}
            </a>
          </div>
          <InstallPill location="hero" />
          <StatStrip />
        </section>

        <section id="demo" className="home-section home-section-demo">
          <SectionHeader
            index="01"
            eyebrow="Playground"
            title={
              <>
                Take it for <span className="accent">a spin.</span>
              </>
            }
            sub="The real editor, running in your browser. Edit the code or the diagram; the other follows."
          />
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
                {PRESET_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    data-preset={k}
                    aria-pressed={type === k}
                    onClick={() => switchType(k)}
                    style={pill(type === k)}
                  >
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
                className={
                  dark
                    ? 'pg-code-pane pg-inline-pane demo-pane demo-pane-dark'
                    : 'pg-code-pane pg-inline-pane demo-pane'
                }
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
                    <CopyStatus copied={sourceCopied !== null} />
                    <button type="button" onClick={() => void copyText(editor.code, 'source')} style={ghostBtn}>
                      {sourceCopied ? 'Copied' : 'Copy'}
                    </button>
                    <button type="button" onClick={reset} style={ghostBtn}>
                      Reset
                    </button>
                  </div>
                </div>
                <CodeMirrorPane editor={editor} />
                <PlaygroundCallout target="source" />
                <div className="pg-callout-filler" />
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
                    click to select · double-click to edit · alt + drag to connect · pinch to zoom
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
                  <PlaygroundCallout target="preview" />
                </div>
              </div>
            </div>
          </div>
          <p style={{ textAlign: 'center', color: '#8A857A', fontSize: 13.5, marginTop: 14 }}>
            Tip: click any box in the preview. The popover on the diagram edits it. Watch the source pane rewrite
            itself.
          </p>
        </section>

        <DiagramTypes onTry={tryPreset} />
        <HowItWorks />
        <FeatureBento />
        <Integrate />
        <OpenKnowledgeBand />
        <ClosingCta starCount={starCount} />
        <SiteFooter />
      </main>
    </div>
  )
}
