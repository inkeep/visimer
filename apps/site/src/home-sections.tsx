import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { track } from './analytics'
import { HERO_LICENSE } from './hero-diagram'
import { CopyStatus, Logo, TYPE_LABELS, useCopy, type PresetKey } from './playground-shared'

export const REPO = 'inkeep/visimer'
export const REPO_URL = `https://github.com/${REPO}`
export const NPM_URL = 'https://www.npmjs.com/package/@visimer/react'
export const LAUNCH_POST_URL = 'https://openknowledge.ai/blog/edit-mermaid-diagrams-visually'
export const OK_URL = 'https://openknowledge.ai'
export const INSTALL_CMD = 'npm i @visimer/react mermaid'

export function GitHubMark({ size = 15, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function SectionHeader({
  index,
  eyebrow,
  title,
  sub,
  align = 'center',
}: {
  index: string
  eyebrow: string
  title: ReactNode
  sub?: ReactNode
  align?: 'center' | 'left'
}) {
  return (
    <div className={`section-header section-header-${align}`}>
      <div className="eyebrow">
        <span className="eyebrow-index" aria-hidden>
          {index}
        </span>
        <span className="eyebrow-sep" aria-hidden>
          /
        </span>
        {eyebrow}
      </div>
      <h2 className="section-title">{title}</h2>
      {sub ? <p className="section-sub">{sub}</p> : null}
    </div>
  )
}

export function InstallPill({ location }: { location: string }) {
  const { copiedKey, copy } = useCopy()
  return (
    <>
      <button
        type="button"
        className="install-pill"
        onClick={() => void copy(INSTALL_CMD, 'install', () => track('install_copied', { location }))}
      >
        <span className="install-pill-prompt" aria-hidden>
          $
        </span>
        <span>{INSTALL_CMD}</span>
        <span className="install-pill-copy" aria-hidden>
          {copiedKey ? 'Copied' : 'Copy'}
        </span>
        <span className="sr-only">Copy</span>
      </button>
      <CopyStatus copied={copiedKey !== null} />
    </>
  )
}


type Support = 'structural' | 'item' | 'view'

const DIAGRAM_TYPES: Array<{ name: string; doc: string; support: Support; preset?: PresetKey }> = [
  { name: 'Flowchart', doc: 'flowchart', support: 'structural', preset: 'flowchart' },
  { name: 'Sequence', doc: 'sequenceDiagram', support: 'structural', preset: 'sequence' },
  { name: 'State', doc: 'stateDiagram', support: 'structural', preset: 'state' },
  { name: 'Class', doc: 'classDiagram', support: 'structural', preset: 'class' },
  { name: 'ER', doc: 'entityRelationshipDiagram', support: 'structural', preset: 'er' },
  { name: 'Pie', doc: 'pie', support: 'structural' },
  { name: 'Gantt', doc: 'gantt', support: 'structural', preset: 'gantt' },
  { name: 'Journey', doc: 'userJourney', support: 'item' },
  { name: 'Timeline', doc: 'timeline', support: 'item' },
  { name: 'Quadrant', doc: 'quadrantChart', support: 'item' },
  { name: 'Kanban', doc: 'kanban', support: 'item' },
  { name: 'Mindmap', doc: 'mindmap', support: 'item' },
  { name: 'Treemap', doc: 'treemap', support: 'item' },
  { name: 'Packet', doc: 'packet', support: 'item' },
  { name: 'Sankey', doc: 'sankey', support: 'item' },
  { name: 'Radar', doc: 'radar', support: 'item' },
  { name: 'Gitgraph', doc: 'gitgraph', support: 'item' },
  { name: 'XY chart', doc: 'xyChart', support: 'item' },
  { name: 'Requirement', doc: 'requirementDiagram', support: 'item' },
  { name: 'C4', doc: 'c4', support: 'item' },
  { name: 'Architecture', doc: 'architecture', support: 'item' },
  { name: 'Block', doc: 'block', support: 'item' },
  { name: 'ZenUML', doc: 'zenuml', support: 'view' },
]

const EDITABLE_TYPES = DIAGRAM_TYPES.filter((t) => t.support !== 'view').length
const TOTAL_TYPES = DIAGRAM_TYPES.length

const SUPPORT_LABEL: Record<Support, string> = {
  structural: 'Full editing',
  item: 'Item editing',
  view: 'View + sync',
}

export function DiagramTypes({ onTry }: { onTry: (preset: PresetKey) => void }) {
  return (
    <section id="diagrams" className="home-section">
      <SectionHeader
        index="02"
        eyebrow="Diagram support"
        title={
          <>
            <span className="accent">
              {EDITABLE_TYPES} of {TOTAL_TYPES}
            </span>{' '}
            Mermaid diagram types, editable.
          </>
        }
        sub="Every type round-trips losslessly and keeps selection in sync between code and canvas."
      />
      <div className="support-legend">
        <span className="support-key support-key-structural">
          <i /> Full editing <em>select, edit, add, delete, connect, reorder, restyle</em>
        </span>
        <span className="support-key support-key-item">
          <i /> Item editing <em>select, edit in place, add, delete</em>
        </span>
        <span className="support-key support-key-view">
          <i /> View + sync <em>renders through an external plugin; selection syncs with the code</em>
        </span>
      </div>
      <ul className="type-grid">
        {DIAGRAM_TYPES.map((t) => {
          const body = (
            <>
              <span className="type-name">{t.name}</span>
              <span className={`type-badge type-badge-${t.support}`}>{SUPPORT_LABEL[t.support]}</span>
              {t.preset ? (
                <span className="type-try">
                  Try it <span aria-hidden>↑</span>
                </span>
              ) : null}
            </>
          )
          const preset = t.preset
          return (
            <li key={t.name}>
              {preset ? (
                <button
                  type="button"
                  className="type-tile type-tile-live"
                  title={`Load the ${TYPE_LABELS[preset]} sample into the playground`}
                  onClick={() => {
                    track('diagram_type_tried', { preset })
                    onTry(preset)
                  }}
                >
                  {body}
                </button>
              ) : (
                <a className="type-tile" href={`https://mermaid.js.org/syntax/${t.doc}.html`} target="_blank" rel="noreferrer">
                  {body}
                </a>
              )}
            </li>
          )
        })}
        <li>
          <a className="type-tile type-tile-more" href={`${REPO_URL}#diagram-support`}>
            <span className="type-name">Full support matrix</span>
            <span className="type-more-link">On GitHub →</span>
          </a>
        </li>
      </ul>
    </section>
  )
}

export function HowItWorks() {
  return (
    <section id="how" className="home-section">
      <SectionHeader
        index="03"
        eyebrow="How it works"
        title={
          <>
            Mermaid draws it. <span className="accent">You edit it.</span>
          </>
        }
        sub="Visimer never re-implements Mermaid's renderer. It overlays editing on the real output and writes back the smallest possible change."
      />
      <ol className="steps">
        <li className="step">
          <div className="step-num">01</div>
          <h3>Your Mermaid renders it</h3>
          <p>Diagrams go through your own <code>mermaid</code> instance, unmodified, so they look exactly as Mermaid intends.</p>
          <pre className="step-visual">
            <span className="tok-k">flowchart</span> LR{'\n'}
            {'  '}A[Start] <span className="tok-o">--&gt;</span> B{'{'}OK?{'}'}
          </pre>
        </li>
        <li className="step">
          <div className="step-num">02</div>
          <h3>Visimer maps it back</h3>
          <p>Every SVG element is correlated to its span in a lossless syntax tree of your source.</p>
          <pre className="step-visual">
            <span className="tok-c">{'<g id="flowchart-B-1">'}</span>
            {'\n'}
            {'  '}<span className="tok-o">→</span> line 2, col 18–20
          </pre>
        </li>
        <li className="step">
          <div className="step-num">03</div>
          <h3>Gestures become minimal edits</h3>
          <p>Rename, connect or restyle and only those characters change. Your diff is only what you changed.</p>
          <pre className="step-visual">
            <span className="diff-del">-  A[Start] --&gt; B{'{'}OK?{'}'}</span>
            <span className="diff-add">+  A[Start] --&gt; B{'{'}Ship it?{'}'}</span>
          </pre>
        </li>
      </ol>
    </section>
  )
}

const FEATURES: Array<{ mark: string; title: string; body: string; span?: boolean; wide?: boolean }> = [
  {
    mark: 'Aa',
    title: 'Edit text in place',
    body: 'Double-click any label and type right on the diagram. Nodes grow as you type.',
  },
  {
    mark: '⟶',
    span: true,
    title: 'Drag to connect and reorder',
    body: 'Connect nodes, states, classes, entities and participants with a ghost edge preview. Drag sequence messages to reorder their statements.',
  },
  {
    mark: '◇',
    title: 'Popovers on every entity',
    body: 'Shape, type and arrow pickers, cardinalities, color swatches, fragments and notes.',
  },
  {
    mark: '⌘Z',
    title: 'One undo stack',
    body: 'Canvas and code share history, so undo works the same wherever you made the change.',
  },
  {
    mark: '!',
    title: 'Error tolerant',
    body: 'Broken syntax mid-keystroke never blanks the canvas. The last good render stays up.',
  },
  {
    mark: '≡',
    title: 'Lossless by design',
    body: 'Comments, directives and syntax Visimer does not understand are preserved verbatim. It only touches what you edit, so it is safe on hand-written and AI-generated diagrams alike.',
    wide: true,
  },
]

export function FeatureBento() {
  return (
    <section id="features" className="home-section">
      <SectionHeader
        index="04"
        eyebrow="Features"
        title={
          <>
            Diagrams you can <span className="accent">actually touch.</span>
          </>
        }
        sub="Fix a diagram fast, without re-learning Mermaid syntax to move one arrow."
      />
      <div className="bento">
        {FEATURES.map((f) => (
          <div key={f.title} className={`bento-card${f.wide ? ' bento-card-wide' : ''}${f.span ? ' bento-card-span' : ''}`}>
            <div className="bento-mark" aria-hidden>
              {f.mark}
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const kw: CSSProperties = { color: '#7FB3A8' }
const str: CSSProperties = { color: '#D9B44A' }
const ident: CSSProperties = { color: '#9DBF8F' }
const cmt: CSSProperties = { color: '#8A9B96' }

type Recipe = { id: string; label: string; pkg: string; code: ReactNode }

const RECIPES: Recipe[] = [
  {
    id: 'react',
    label: 'React',
    pkg: '@visimer/react',
    code: (
      <>
        <span style={cmt}># npm i @visimer/react mermaid</span>
        {'\n'}
        <span style={kw}>import</span> mermaid <span style={kw}>from</span> <span style={str}>'mermaid'</span>
        {'\n'}
        <span style={kw}>import</span> {'{ MermaidWysiwyg }'} <span style={kw}>from</span> <span style={str}>'@visimer/react'</span>
        {'\n\n'}&lt;<span style={ident}>MermaidWysiwyg</span>
        {'\n'}
        {'  '}<span style={str}>code</span>={'{diagram}'}
        {'\n'}
        {'  '}<span style={str}>onCodeChange</span>={'{setDiagram}'}
        {'\n'}
        {'  '}<span style={str}>mermaid</span>={'{mermaid}'}
        {'\n'}/&gt;
      </>
    ),
  },
  {
    id: 'vanilla',
    label: 'Vanilla',
    pkg: '@visimer/core + @visimer/dom',
    code: (
      <>
        <span style={cmt}># npm i @visimer/core @visimer/dom mermaid</span>
        {'\n'}
        <span style={kw}>import</span> mermaid <span style={kw}>from</span> <span style={str}>'mermaid'</span>
        {'\n'}
        <span style={kw}>import</span> {'{ MermaidWysiwygEditor }'} <span style={kw}>from</span> <span style={str}>'@visimer/core'</span>
        {'\n'}
        <span style={kw}>import</span> {'{ MermaidCanvasView }'} <span style={kw}>from</span> <span style={str}>'@visimer/dom'</span>
        {'\n\n'}
        <span style={kw}>const</span> editor = <span style={kw}>new</span> <span style={ident}>MermaidWysiwygEditor</span>({'{ '}
        <span style={str}>code</span>
        {' }'})
        {'\n'}
        <span style={kw}>new</span> <span style={ident}>MermaidCanvasView</span>({'{ '}
        <span style={str}>editor</span>, <span style={str}>container</span>, <span style={str}>mermaid</span>
        {' }'})
        {'\n\n'}editor.<span style={ident}>on</span>(<span style={str}>'change'</span>, ({'{ code }'}) =&gt; <span style={ident}>save</span>(code))
      </>
    ),
  },
  {
    id: 'codemirror',
    label: 'CodeMirror',
    pkg: '@visimer/codemirror',
    code: (
      <>
        <span style={cmt}># npm i @visimer/codemirror</span>
        {'\n'}
        <span style={kw}>import</span> {'{ MermaidCodeMirror }'} <span style={kw}>from</span> <span style={str}>'@visimer/codemirror'</span>
        {'\n\n'}
        <span style={kw}>new</span> <span style={ident}>MermaidCodeMirror</span>(host, editor)
        {'\n'}
        <span style={cmt}># typing, highlights and undo, all shared with the canvas</span>
      </>
    ),
  },
  {
    id: 'monaco',
    label: 'Monaco',
    pkg: '@visimer/monaco',
    code: (
      <>
        <span style={cmt}># npm i @visimer/monaco  (bring your own monaco instance)</span>
        {'\n'}
        <span style={kw}>import</span> {'{ bindMonaco }'} <span style={kw}>from</span> <span style={str}>'@visimer/monaco'</span>
        {'\n\n'}
        <span style={kw}>const</span> binding = <span style={ident}>bindMonaco</span>(editor, monacoEditor)
        {'\n'}binding.<span style={ident}>dispose</span>()
      </>
    ),
  },
  {
    id: 'headless',
    label: 'Headless',
    pkg: '@visimer/core',
    code: (
      <>
        <span style={cmt}># every gesture is also a semantic op</span>
        {'\n'}editor.<span style={ident}>dispatch</span>({'{ '}
        <span style={str}>type</span>: <span style={str}>'renameNode'</span>, <span style={str}>id</span>: <span style={str}>'B'</span>,{' '}
        <span style={str}>label</span>: <span style={str}>'Valid?'</span>
        {' }'})
        {'\n'}editor.<span style={ident}>dispatch</span>({'{ '}
        <span style={str}>type</span>: <span style={str}>'connect'</span>, <span style={str}>source</span>: <span style={str}>'A'</span>,{' '}
        <span style={str}>target</span>: <span style={str}>'C'</span>
        {' }'})
        {'\n'}editor.<span style={ident}>undo</span>()
      </>
    ),
  },
  {
    id: 'theming',
    label: 'Theming',
    pkg: 'CSS variables',
    code: (
      <>
        <span style={cmt}># chrome follows your tokens; mermaid keeps its themes</span>
        {'\n'}.mw-canvas {'{'}
        {'\n'}
        {'  '}<span style={str}>--mw-accent</span>: <span style={ident}>#0E7C6B</span>;
        {'\n'}
        {'  '}<span style={str}>--mw-chrome-bg</span>: <span style={ident}>#1E1B16</span>;
        {'\n'}
        {'  '}<span style={str}>--mw-chrome-fg</span>: <span style={ident}>#EDE7DA</span>;
        {'\n'}
        {'}'}
        {'\n'}
        <span style={cmt}># or per instance: accentColor, mermaidConfig={'{ theme: "dark" }'}</span>
      </>
    ),
  },
]

const PACKAGES: Array<{ name: string; body: string }> = [
  { name: '@visimer/core', body: 'Headless engine: lossless syntax tree, ops to minimal text edits, unified history. No DOM.' },
  { name: '@visimer/dom', body: 'Interactive canvas over your mermaid instance, with every gesture.' },
  { name: '@visimer/react', body: 'Drop-in <MermaidWysiwyg /> component and useMermaidEditor hook.' },
  { name: '@visimer/codemirror', body: 'CodeMirror 6 pane with two-way sync and shared undo.' },
  { name: '@visimer/monaco', body: 'Binding for a Monaco editor you already own.' },
]

export function StatStrip() {
  const stats: Array<{ value: string; label: string }> = [
    { value: `${EDITABLE_TYPES} / ${TOTAL_TYPES}`, label: 'Mermaid diagram types editable' },
    { value: 'Lossless', label: 'Unknown syntax kept byte for byte' },
    { value: String(PACKAGES.length), label: 'Packages, React to headless' },
    { value: HERO_LICENSE, label: 'Open source, built in the open' },
  ]
  return (
    <div className="stat-strip">
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <div className="stat-value">{s.value}</div>
          <div className="stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

export function Integrate() {
  const [active, setActive] = useState(RECIPES[0].id)
  const { copiedKey, copy } = useCopy()
  const preRef = useRef<HTMLPreElement>(null)
  const recipe = RECIPES.find((r) => r.id === active) ?? RECIPES[0]
  const select = (r: Recipe) => {
    setActive(r.id)
    track('recipe_tab_selected', { recipe: r.label })
  }
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = RECIPES.findIndex((r) => r.id === active)
    const last = RECIPES.length - 1
    const next =
      e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next === null) return
    e.preventDefault()
    select(RECIPES[next])
    document.getElementById(`recipe-tab-${RECIPES[next].id}`)?.focus()
  }
  return (
    <section id="install" className="home-section">
      <div className="integrate">
        <div className="integrate-copy">
          <SectionHeader
            align="left"
            index="05"
            eyebrow="Install"
            title={
              <>
                Add it to <span className="accent">your own editor.</span>
              </>
            }
            sub="The playground above is this exact package. Pick a binding, or implement the five-method text-pane adapter for any other editor."
          />
          <ul className="pkg-list">
            {PACKAGES.map((p) => (
              <li key={p.name}>
                <code>{p.name}</code>
                <span>{p.body}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="code-window">
          <div className="code-window-tabs" role="tablist" aria-label="Integration examples" onKeyDown={onTabKeyDown}>
            {RECIPES.map((r) => (
              <button
                key={r.id}
                id={`recipe-tab-${r.id}`}
                type="button"
                role="tab"
                aria-selected={r.id === active}
                aria-controls="recipe-panel"
                tabIndex={r.id === active ? 0 : -1}
                className={`code-tab${r.id === active ? ' is-active' : ''}`}
                onClick={() => select(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div id="recipe-panel" role="tabpanel" aria-labelledby={`recipe-tab-${recipe.id}`}>
            <div className="code-window-meta">
              <span>{recipe.pkg}</span>
              <button
                type="button"
                className="code-copy"
                onClick={() =>
                  void copy(preRef.current?.textContent ?? '', recipe.id, () =>
                    track('recipe_copied', { recipe: recipe.label }),
                  )
                }
                aria-label={`Copy ${recipe.label} example`}
              >
                {copiedKey === recipe.id ? 'Copied' : 'Copy'}
              </button>
              <CopyStatus copied={copiedKey !== null} />
            </div>
            <pre ref={preRef} className="code-window-body code-card-scroll">
              {recipe.code}
            </pre>
          </div>
          <div className="code-window-foot">
            <a href={`${REPO_URL}#readme`}>
              <GitHubMark size={13} /> Full API in the README
            </a>
            <a href={NPM_URL}>npm ↗</a>
          </div>
        </div>
      </div>
    </section>
  )
}

export function OpenKnowledgeBand() {
  return (
    <section className="home-section">
      <div className="ok-band">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-index">In production</span>
          </div>
          <h2 className="ok-band-title">Already editing diagrams in Open Knowledge.</h2>
          <p>
            Open Knowledge is a WYSIWYG markdown editor for Mac, Windows and Linux. Visimer is its native editor for every
            Mermaid block in your docs.
          </p>
        </div>
        <div className="ok-band-actions">
          <a className="btn btn-light" href={OK_URL} target="_blank" rel="noreferrer" onClick={() => track('ok_clicked', { location: 'ok_band' })}>
            Try Open Knowledge ↗
          </a>
          <a className="ok-band-link" href={LAUNCH_POST_URL} target="_blank" rel="noreferrer">
            Read the launch post →
          </a>
        </div>
      </div>
    </section>
  )
}

export function ClosingCta({ starCount }: { starCount: string | null }) {
  return (
    <section className="closing">
      <Logo size={40} />
      <h2 className="closing-title">
        Make every Mermaid diagram <span className="accent">editable.</span>
      </h2>
      <p className="section-sub">Free and open source. Drop it into your app in an afternoon.</p>
      <div className="cta-row">
        <a className="btn btn-dark" href="/playground" onClick={() => track('playground_cta_clicked', { location: 'closing' })}>
          Open the playground
        </a>
        <a className="btn btn-light" href={REPO_URL} onClick={() => track('github_clicked', { location: 'closing' })}>
          <GitHubMark /> Star on GitHub
          {starCount ? <span className="btn-count">{starCount}</span> : null}
        </a>
      </div>
      <InstallPill location="closing" />
    </section>
  )
}

const FOOTER_COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: 'Product',
    links: [
      { label: 'Playground', href: '/playground' },
      { label: 'Diagram support', href: '#diagrams' },
      { label: 'How it works', href: '#how' },
      { label: 'Install', href: '#install' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'GitHub', href: REPO_URL },
      { label: 'npm', href: NPM_URL },
      { label: 'README', href: `${REPO_URL}#readme` },
      { label: 'Changelog', href: `${REPO_URL}/blob/main/packages/react/CHANGELOG.md` },
    ],
  },
  {
    title: 'From Inkeep',
    links: [
      { label: 'Open Knowledge', href: OK_URL },
      { label: 'Launch post', href: LAUNCH_POST_URL },
      { label: 'Inkeep', href: 'https://inkeep.com' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <div className="site-footer-logo">
            <Logo size={24} />
            Visimer
          </div>
          <p>The visual editor for Mermaid diagrams.</p>
          <a className="site-footer-gh" href={REPO_URL}>
            <GitHubMark size={14} /> {REPO}
          </a>
        </div>
        {FOOTER_COLUMNS.map((c) => (
          <div key={c.title} className="site-footer-col">
            <div className="site-footer-col-title">{c.title}</div>
            <ul>
              {c.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="site-footer-base">
        <span>MIT licensed · © Inkeep</span>
        <span>Built in the open</span>
      </div>
    </footer>
  )
}
