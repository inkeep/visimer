import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import {
  DIAGRAM_TYPES,
  PARTICIPANT_TYPES,
  type MermaidWysiwygEditor,
  type ParticipantType,
  type ShapeId,
} from '@visimer/core'
import type { MermaidCanvasView, Tool } from '@visimer/dom'
import { MermaidCanvas, useMermaidEditor } from '@visimer/react'
import { MermaidCodeMirror } from '@visimer/codemirror'
import { MonacoPane } from './MonacoPane'
import { SAMPLES } from '../../js-playground/src/samples'

let zenumlReady: Promise<boolean> | null = null
function ensureZenuml(): Promise<boolean> {
  zenumlReady ??= import('@mermaid-js/mermaid-zenuml')
    .then(async (m) => (await mermaid.registerExternalDiagrams([m.default]), true))
    .catch(() => false)
  return zenumlReady
}

/** the playground's dark mermaid theme, built on mermaid's `base` theme */
const INK_THEME = {
  darkMode: true,
  background: '#000000',
  fontFamily: '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
  // core nodes and edges
  primaryColor: '#111111',
  primaryTextColor: '#ededed',
  primaryBorderColor: '#3f3f3f',
  secondaryColor: '#1a1a1a',
  secondaryBorderColor: '#333333',
  secondaryTextColor: '#ededed',
  tertiaryColor: '#0a0a0a',
  tertiaryBorderColor: '#262626',
  tertiaryTextColor: '#a1a1a1',
  mainBkg: '#111111',
  nodeBorder: '#3f3f3f',
  nodeTextColor: '#ededed',
  lineColor: '#8f8f8f',
  textColor: '#ededed',
  titleColor: '#ededed',
  clusterBkg: '#0a0a0a',
  clusterBorder: '#333333',
  edgeLabelBackground: '#1a1a1a',
  // sequence
  actorBkg: '#111111',
  actorBorder: '#3f3f3f',
  actorTextColor: '#ededed',
  actorLineColor: '#333333',
  signalColor: '#8f8f8f',
  signalTextColor: '#a1a1a1',
  labelBoxBkgColor: '#111111',
  labelBoxBorderColor: '#3f3f3f',
  labelTextColor: '#ededed',
  loopTextColor: '#a1a1a1',
  noteBkgColor: '#1a1a1a',
  noteBorderColor: '#3f3f3f',
  noteTextColor: '#ededed',
  activationBkgColor: '#1f1f1f',
  activationBorderColor: '#454545',
  sequenceNumberColor: '#ffffff',
   // pie and categorical scales
  pie1: '#3784ff',
  pie2: '#a78bfa',
  pie3: '#4fae72',
  pie4: '#d9a13c',
  pie5: '#d97757',
  pie6: '#69a3ff',
  pie7: '#f0716b',
  pie8: '#8fb8ff',
  pieTitleTextColor: '#ededed',
  pieSectionTextColor: '#ffffff',
  pieLegendTextColor: '#a1a1a1',
  pieStrokeColor: '#000000',
  pieOuterStrokeColor: '#000000',
  cScale0: '#3784ff',
  cScale1: '#a78bfa',
  cScale2: '#4fae72',
  cScale3: '#d9a13c',
  cScale4: '#d97757',
  cScale5: '#69a3ff',
  cScale6: '#f0716b',
  cScale7: '#8fb8ff',
  // gantt
  sectionBkgColor: '#0a0a0a',
  sectionBkgColor2: '#111111',
  altSectionBkgColor: '#000000',
  gridColor: '#262626',
  todayLineColor: '#d97757',
  taskBkgColor: '#3784ff',
  taskBorderColor: '#3784ff',
  taskTextColor: '#ffffff',
  taskTextLightColor: '#ffffff',
  taskTextOutsideColor: '#ededed',
  activeTaskBkgColor: '#a78bfa',
  activeTaskBorderColor: '#a78bfa',
  doneTaskBkgColor: '#333333',
  doneTaskBorderColor: '#454545',
  critBkgColor: '#d97757',
  critBorderColor: '#d97757',
  excludeBkgColor: '#111111',
  // er / class
  attributeBackgroundColorOdd: '#0a0a0a',
  attributeBackgroundColorEven: '#111111',
  classText: '#ededed',
  // gitgraph
  git0: '#3784ff',
  git1: '#a78bfa',
  git2: '#4fae72',
  git3: '#d9a13c',
  git4: '#d97757',
  git5: '#69a3ff',
  git6: '#f0716b',
  git7: '#8fb8ff',
  commitLabelColor: '#ededed',
  commitLabelBackground: '#111111',
}

function themeConfig(theme: string) {
  return theme === 'ink'
    ? { theme: 'base', themeVariables: INK_THEME }
    : { theme, themeVariables: {} }
}

const SHAPES: Array<{ id: ShapeId; label: string }> = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'round', label: 'Rounded' },
  { id: 'stadium', label: 'Stadium' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'circle', label: 'Circle' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'subroutine', label: 'Subroutine' },
]

export default function App() {
  const [sampleIndex, setSampleIndex] = useState(0)
  const [theme, setTheme] = useState('ink')
  const [readOnly, setReadOnly] = useState(false)
  const [zenumlOk, setZenumlOk] = useState(false)

  const sample = SAMPLES[sampleIndex]
  useEffect(() => {
    if (sample.typeId === 'zenuml') void ensureZenuml().then(setZenumlOk)
  }, [sample])

  const waitForZenuml = sample.typeId === 'zenuml' && !zenumlOk

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          visimer
          <span className="sep">/</span>
          <span className="sub">playground</span>
        </div>
        <div className="controls">
          <select value={theme} onChange={(e) => setTheme(e.target.value)} title="Mermaid theme">
            {['ink', 'dark', 'default', 'forest', 'neutral'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="switch">
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            Read-only
          </label>
          <a href="https://github.com/inkeep/visimer" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </header>
      <div className="body">
        <aside className="sidebar">
          <div className="side-label">Diagram types</div>
          {SAMPLES.map((s, i) => {
            const t = DIAGRAM_TYPES.find((d) => d.id === s.typeId)
            return (
              <button key={s.title} className={`side-item${i === sampleIndex ? ' active' : ''}`} onClick={() => setSampleIndex(i)}>
                <i className={`dot ${t?.capability ?? 'render'}`} />
                {s.title}
              </button>
            )
          })}
          <div className="legend">
            <span><i className="dot edit" /> editable</span>
            <span><i className="dot render" /> render</span>
          </div>
        </aside>
        {!waitForZenuml && <Workspace key={sampleIndex} code={sample.code} theme={theme} readOnly={readOnly} />}
      </div>
    </div>
  )
}

function Workspace({ code, theme, readOnly }: { code: string; theme: string; readOnly: boolean }) {
  const { editor } = useMermaidEditor(code)
  const [view, setView] = useState<MermaidCanvasView | null>(null)
  const [tool, setToolState] = useState<Tool>('select')
  const [status, setStatus] = useState<string | null>(null)
  const [pane, setPane] = useState<'codemirror' | 'monaco'>('codemirror')

  // theme changes flow through the MermaidCanvas mermaidConfig prop

  // subscribe to the editor so toolbar state (undo/redo/selection) stays live
  useEditorCode(editor)
  // status tracks render outcomes; the view emits after every (debounced)
  // render, including the undo-back-to-last-good path
  useEffect(() => {
    if (!view) return
    setStatus(view.renderError)
    return view.on('render', () => setStatus(view.renderError))
  }, [view])

  const setTool = (t: Tool) => {
    view?.setTool(t)
    setToolState(t)
  }

  const typeInfo = editor.result.typeInfo
  const editable = typeInfo?.capability === 'edit' && !readOnly

  return (
    <>
      <main className="main">
        <div className={`toolbar${editable ? '' : ' disabled'}`}>
          <button className={tool === 'select' ? 'primary' : ''} onClick={() => setTool('select')}>Select</button>
          <button className={tool === 'connect' ? 'primary' : ''} onClick={() => setTool('connect')}>Connect</button>
          <TypeTools editor={editor} view={view} />
          <span className="spacer" />
          <button disabled={!editor.selection.length} className="danger" onClick={() => editor.deleteEntities(editor.selection)}>Delete</button>
          <button disabled={!editor.canUndo} onClick={() => editor.undo()}>Undo</button>
          <button disabled={!editor.canRedo} onClick={() => editor.redo()}>Redo</button>
        </div>
        <MermaidCanvas
          editor={editor}
          mermaid={mermaid}
          mermaidConfig={{ securityLevel: 'loose', ...themeConfig(theme) }}
          accentColor="#69a3ff"
          readOnly={readOnly}
          onReady={setView}
          className="canvas"
          style={{ height: '100%' }}
        />
      </main>
      <section className="codepanel">
        <div className="panel-title">
          <span className="panel-title-left">
            Mermaid source
            <span className="seg">
              <button className={pane === 'codemirror' ? 'on' : ''} onClick={() => setPane('codemirror')}>
                CodeMirror
              </button>
              <button className={pane === 'monaco' ? 'on' : ''} onClick={() => setPane('monaco')}>
                Monaco
              </button>
            </span>
          </span>
          {typeInfo && (
            <span className={`badge${typeInfo.capability === 'edit' ? ' edit' : ''}`}>
              {typeInfo.name} · {typeInfo.capability === 'edit' ? 'WYSIWYG' : 'render'}
            </span>
          )}
        </div>
        {pane === 'monaco' ? <MonacoPane editor={editor} /> : <CodePane editor={editor} />}
        <div className="statusbar">
          {status ? <span className="err">✕ {status}</span> : <span className="ok">✓ mermaid parse ok</span>}
        </div>
      </section>
    </>
  )
}

/** re-render on document changes */
function useEditorCode(editor: MermaidWysiwygEditor) {
  const [code, setCode] = useState(editor.code)
  useEffect(() => editor.on('change', ({ code: next }) => setCode(next)), [editor])
  return code
}

function TypeTools({ editor, view }: { editor: MermaidWysiwygEditor; view: MermaidCanvasView | null }) {
  const typeId = editor.result.typeInfo?.id
  const openEditorSoon = (created?: string[]) => {
    const id = created?.[0]
    if (id) setTimeout(() => view?.editEntityLabel(id), 350)
  }

  if (typeId === 'flowchart') {
    return (
      <>
        <select value="" title="Add a node" onChange={(e) => e.target.value && view?.addNode(e.target.value as ShapeId)}>
          <option value="">+ Node…</option>
          {SHAPES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <DirectionSelect
          value={editor.result.flowchart?.direction ?? 'TD'}
          options={['TD', 'LR', 'BT', 'RL']}
          onChange={(d) => editor.dispatch({ type: 'setDirection', direction: d })}
        />
      </>
    )
  }
  if (typeId === 'sequence') {
    return (
      <>
        <select value="" title="Add a participant" onChange={(e) => e.target.value && editor.dispatch({ type: 'seq.addParticipant', ptype: e.target.value as ParticipantType })}>
          <option value="">+ Participant…</option>
          {PARTICIPANT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          className={editor.result.sequence?.autonumber.enabled ? 'primary' : ''}
          onClick={() => editor.dispatch({ type: 'seq.toggleAutonumber' })}
        >
          # Autonumber
        </button>
      </>
    )
  }
  if (typeId === 'state') {
    return (
      <>
        <button onClick={() => openEditorSoon(editor.dispatch({ type: 'st.addState', label: 'New state' })?.created)}>+ State</button>
        <DirectionSelect
          value={editor.result.state?.direction?.value ?? 'TB'}
          options={['TB', 'LR', 'BT', 'RL']}
          onChange={(d) => editor.dispatch({ type: 'st.setDirection', direction: d })}
        />
      </>
    )
  }
  if (typeId === 'class') {
    return (
      <>
        <button onClick={() => openEditorSoon(editor.dispatch({ type: 'cl.addClass' })?.created)}>+ Class</button>
        <DirectionSelect
          value={editor.result.classGraph?.direction?.value ?? 'TB'}
          options={['TB', 'LR', 'BT', 'RL']}
          onChange={(d) => editor.dispatch({ type: 'cl.setDirection', direction: d })}
        />
      </>
    )
  }
  if (typeId === 'er') {
    return <button onClick={() => openEditorSoon(editor.dispatch({ type: 'er.addEntity' })?.created)}>+ Entity</button>
  }
  if (typeId === 'pie') {
    return <button onClick={() => openEditorSoon(editor.dispatch({ type: 'pie.addSlice' })?.created)}>+ Slice</button>
  }
  if (typeId === 'gantt') {
    return <button onClick={() => openEditorSoon(editor.dispatch({ type: 'gantt.addTask' })?.created)}>+ Task</button>
  }
  if (editor.result.lineItems) {
    return <button onClick={() => openEditorSoon(editor.dispatch({ type: 'li.addItem' })?.created)}>+ Item</button>
  }
  return null
}

function DirectionSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (d: string) => void }) {
  const normalized = value === 'TD' && options.includes('TB') ? 'TB' : value === 'TB' && options.includes('TD') ? 'TD' : value
  return (
    <select value={normalized} title="Layout direction" onChange={(e) => onChange(e.target.value)}>
      {options.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  )
}

function CodePane({ editor }: { editor: MermaidWysiwygEditor }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const cm = new MermaidCodeMirror(ref.current, editor)
    return () => cm.destroy()
  }, [editor])
  return <div className="codepane" ref={ref} />
}
