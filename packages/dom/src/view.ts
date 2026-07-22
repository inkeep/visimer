import {
  MermaidWysiwygEditor,
  MESSAGE_OPS,
  PARTICIPANT_TYPES,
  type Diagnostic,
  type ShapeId,
  type EdgeLine,
  type EdgeArrow,
  type MessageOp,
  type ParticipantType,
} from '@visimer/core'
import {
  correlateClass,
  correlateEr,
  correlateFlowchart,
  correlateGantt,
  correlateLineItems,
  correlatePie,
  correlateSequence,
  correlateState,
  type Correlation,
  type SequenceCorrelation,
} from './correlate'
import {
  Popover,
  POPOVER_CSS,
  type PopoverAction,
  type PopoverPanelItem,
  type PopoverPanelSection,
} from './popover'
import { ICONS } from './icons'

/** default swatches offered in the color panels (works on light and dark themes) */
export const COLOR_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#d946ef', '#64748b']

export interface MermaidLike {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string; bindFunctions?: (el: Element) => void }>
  parse(code: string, options?: Record<string, unknown>): Promise<unknown>
}

export type Tool = 'select' | 'connect'

export interface ViewHooks {
  /** return true to suppress the built-in inline label editor */
  onEntityDoubleClick?: (entityId: string) => boolean | void
  onEntityClick?: (entityId: string, event: MouseEvent) => void
}

export interface ViewOptions {
  editor: MermaidWysiwygEditor
  container: HTMLElement
  mermaid: MermaidLike
  /** merged into mermaid.initialize; e.g. { theme: 'dark' } */
  mermaidConfig?: Record<string, unknown>
  debounceMs?: number
  readOnly?: boolean
  /**
   * Canvas pan/zoom: fit-to-canvas on first render, drag empty space to pan,
   * ctrl/cmd+wheel (or trackpad pinch) to zoom, plus corner zoom controls.
   */
  panZoom?: boolean
  /** CSS color for selection/hover/ghost-edge chrome */
  accentColor?: string
  /** kind of edge created by drag-to-connect */
  defaultEdge?: { line?: EdgeLine; arrowEnd?: EdgeArrow }
  hooks?: ViewHooks
}

type ViewEventMap = {
  render: { ok: boolean; error?: string }
  toolChange: Tool
  connectPreview: { source: string | null }
}

const BASE_CSS = `
.mw-canvas { position: relative; overflow: auto; outline: none; }
.mw-canvas .mw-svg-host { user-select: none; -webkit-user-select: none; }
.mw-canvas .mw-svg-host { min-height: 100%; display: flex; align-items: flex-start; justify-content: center; padding: 16px; box-sizing: border-box; }
.mw-canvas svg { max-width: 100%; height: auto; }
.mw-canvas.mw-panzoom { overflow: hidden; }
.mw-canvas.mw-panzoom .mw-svg-host { position: absolute; inset: 0; display: block; padding: 0; min-height: 0; overflow: hidden; }
.mw-canvas.mw-panzoom .mw-svg-host svg { position: absolute; left: 0; top: 0; max-width: none; height: auto; transform-origin: 0 0; }
.mw-canvas.mw-panzoom .mw-svg-host { cursor: grab; }
.mw-canvas.mw-panzoom.mw-panning .mw-svg-host { cursor: grabbing; }
.mw-canvas.mw-panzoom [data-mw-entity] { cursor: pointer; }
.mw-zoom-controls { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 4px; z-index: 6; }
.mw-zoom-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border-radius: 7px; border: 1px solid var(--mw-chrome-border, rgba(128,128,128,.35)); background: var(--mw-chrome-bg, rgba(24,24,27,.92)); color: var(--mw-chrome-fg, #e4e4e7); cursor: pointer; }
.mw-zoom-btn:hover { background: var(--mw-chrome-hover, rgba(63,63,70,.9)); }
.mw-zoom-btn svg { width: 14px; height: 14px; }
.mw-canvas [data-mw-entity] { cursor: pointer; }
.mw-canvas.mw-readonly [data-mw-entity] { cursor: default; }
.mw-canvas.mw-tool-connect [data-mw-entity^="node:"] { cursor: crosshair; }
.mw-canvas [data-mw-entity]:hover { filter: drop-shadow(0 0 3px var(--mw-accent, #6366f1)); }
.mw-canvas .mw-selected { filter: drop-shadow(0 0 2px var(--mw-accent, #6366f1)) drop-shadow(0 0 5px var(--mw-accent, #6366f1)) !important; }
.mw-canvas .mw-ghost-edge { stroke: var(--mw-accent, #6366f1); stroke-width: 2; stroke-dasharray: 6 4; fill: none; pointer-events: none; }
.mw-canvas .mw-connect-source { filter: drop-shadow(0 0 5px var(--mw-accent, #6366f1)) !important; }
.mw-inplace-editor {
  position: absolute; z-index: 10; white-space: pre; outline: none;
  padding: 1px 3px; margin: -1px -3px; border-radius: 3px;
  caret-color: var(--mw-accent, #6366f1);
  box-shadow: 0 1.5px 0 0 var(--mw-accent, #6366f1);
  background: color-mix(in srgb, var(--mw-editor-bg, #fff) 35%, transparent);
}
.mw-error-badge {
  position: absolute; top: 8px; right: 8px; z-index: 5;
  font: 500 11px/1.4 ui-sans-serif, system-ui, sans-serif;
  background: #dc2626; color: #fff; border-radius: 6px; padding: 3px 8px;
  max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mw-drop-indicator {
  position: absolute; left: 6%; right: 6%; height: 2.5px; z-index: 14;
  background: var(--mw-accent, #6366f1); border-radius: 2px; pointer-events: none;
  box-shadow: 0 0 6px var(--mw-accent, #6366f1);
}
.mw-canvas [contenteditable="true"] {
  outline: none; cursor: text; white-space: pre-wrap; min-width: 8px;
  caret-color: var(--mw-accent, #6366f1);
}
`

let styleInjected = false
/** global counter so concurrent views never collide on mermaid's DOM ids */
let renderIdCounter = 0

/**
 * Read the in-place editor's label back to the string form the mermaid source
 * carries. `textContent` alone drops `<br>` DOM elements to nothing, so a
 * source label like `"3. Layout<br/>dagre computes coordinates"` round-trips
 * to `"3. Layoutdagre computes coordinates"` on a no-op blur — the browser's
 * innerHTML preserves the break, and normalising the two forms mermaid emits
 * (`<br>` on Chromium, occasional `<br/>` on serializers) to the canonical
 * source form `<br/>` keeps the strict equality check in the caller
 * meaningful. Trims outer whitespace to match the prior `.textContent.trim()`
 * contract. Kept small and reversible — any richer HTML the user paste-injects
 * flows through untouched (mermaid accepts a small allowlist of inline tags
 * inside labels; the parser rejects anything it doesn't know).
 */
function readLabelHtml(label: HTMLElement): string {
  return (label.innerHTML ?? '').replace(/<br\s*\/?>/gi, '<br/>').trim()
}

/**
 * Absolute caret offset within `root`, counted across all of its text nodes.
 * `Selection.anchorOffset` alone is relative to the anchor node — a label that
 * the browser split into several text nodes (or that contains `<br>`) would
 * restore the caret into the wrong word.
 */
function caretOffsetWithin(root: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel?.anchorNode || !root.contains(sel.anchorNode)) return -1
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(sel.anchorNode, sel.anchorOffset)
  return range.toString().length
}

/** place a collapsed caret at an absolute text offset within `root` */
function placeCaretAt(root: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  let remaining = Math.max(0, offset)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) {
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= len
    node = walker.nextNode() as Text | null
  }
  range.selectNodeContents(root)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Interactive canvas bound to a MermaidWysiwygEditor.
 * Renders through mermaid itself (full fidelity) and overlays interaction:
 * click-select, drag-to-connect, double-click inline label editing.
 */
export class MermaidCanvasView {
  readonly editor: MermaidWysiwygEditor
  readonly container: HTMLElement
  private mermaid: MermaidLike
  private mermaidConfig: Record<string, unknown>
  private svgHost: HTMLElement
  private overlayHost: HTMLElement
  private errorBadge: HTMLElement
  private correlation: Correlation | null = null
  private seqCorrelation: SequenceCorrelation | null = null
  private popover: Popover
  private plusButtons: HTMLElement[] = []
  private plusMenu: HTMLElement | null = null
  private hoveredLifeline: string | null = null
  private svg: SVGSVGElement | null = null
  /** tracks external transforms on the svg (host pan/zoom toolbars) */
  private svgTransformObserver: MutationObserver | null = null
  private popoverFollowRaf = 0
  /** our own pan/zoom writes must not trip the external-transform observer */
  private applyingOwnTransform = false
  /** which of an entity's twin elements the user clicked (popover anchor) */
  private popoverAnchorPick: { entityId: string; index: number } | null = null
  private tool: Tool = 'select'
  private readOnly: boolean
  private debounceMs: number
  private defaultEdge: { line?: EdgeLine; arrowEnd?: EdgeArrow }
  private hooks: ViewHooks
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private lastRenderedCode = ''
  private disposers: Array<() => void> = []
  private listeners = new Map<keyof ViewEventMap, Set<(p: never) => void>>()
  private connectSource: string | null = null
  private suppressNextClick = false
  private ghostPath: SVGLineElement | null = null
  private dragEvent: string | null = null
  private dragStartY = 0
  private dragging = false
  private dropIndicator: HTMLElement | null = null
  private dropSlots: Array<{ y: number; afterEvent: string | null }> = []
  private inlineInput: HTMLElement | null = null
  private inlineHidden: { el: HTMLElement | SVGElement; prevVisibility: string } | null = null
  private pendingEditEntity: string | null = null
  private inPlaceSession: {
    entityId: string
    labelSelector: string
    original: string
    lastCommitted: string
    caretOffset: number
    commitValue: (v: string) => void
    liveTimer: ReturnType<typeof setTimeout> | null
    /** the label element the session is currently attached to */
    label: HTMLElement | null
    /** finish the session from outside the attach closure (commit or revert) */
    finish: ((commit: boolean) => void) | null
  } | null = null
  private lastError: string | null = null
  /** a render was requested while an in-place edit was typing; applied on finish */
  private renderHeldByEdit = false
  // pan/zoom state (only used when options.panZoom is set)
  private panZoomEnabled: boolean
  private zoomScale = 1
  private zoomTx = 0
  private zoomTy = 0
  /** the user panned/zoomed — keep their viewport across re-renders */
  private hasUserView = false
  private svgSize: { width: number; height: number } | null = null
  private panSession: { pointerId: number; x: number; y: number; tx: number; ty: number; moved: boolean } | null = null
  private zoomControls: HTMLElement | null = null
  /** per-instance staleness counter; a shared one would drop renders across instances */
  private renderSeq = 0

  constructor(options: ViewOptions) {
    this.editor = options.editor
    this.container = options.container
    this.mermaid = options.mermaid
    this.readOnly = options.readOnly ?? false
    this.panZoomEnabled = options.panZoom ?? false
    this.debounceMs = options.debounceMs ?? 200
    this.defaultEdge = options.defaultEdge ?? {}
    this.hooks = options.hooks ?? {}
    this.mermaidConfig = { startOnLoad: false, ...options.mermaidConfig }

    if (!styleInjected) {
      const style = document.createElement('style')
      style.setAttribute('data-mw', '')
      style.textContent = BASE_CSS + POPOVER_CSS
      document.head.appendChild(style)
      styleInjected = true
    }

    this.container.classList.add('mw-canvas')
    this.container.tabIndex = 0
    if (options.accentColor) this.container.style.setProperty('--mw-accent', options.accentColor)
    if (this.readOnly) this.container.classList.add('mw-readonly')

    this.svgHost = document.createElement('div')
    this.svgHost.className = 'mw-svg-host'
    this.overlayHost = document.createElement('div')
    this.errorBadge = document.createElement('div')
    this.errorBadge.className = 'mw-error-badge'
    this.errorBadge.style.display = 'none'
    this.container.append(this.svgHost, this.overlayHost, this.errorBadge)
    this.popover = new Popover(this.overlayHost)

    this.mermaid.initialize(this.mermaidConfig)

    this.disposers.push(
      this.editor.on('change', () => this.scheduleRender()),
      this.editor.on('selectionChange', () => this.applySelectionStyles()),
    )

    const keydown = (e: KeyboardEvent) => this.onKeyDown(e)
    this.container.addEventListener('keydown', keydown)
    this.disposers.push(() => this.container.removeEventListener('keydown', keydown))

    // interacting anywhere outside the canvas deselects: the popover, the
    // lifeline plus-menu, and any open editing session must not linger while
    // the user works elsewhere (e.g. a host app's own pan controls)
    const docPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target || this.container.contains(target)) return
      this.inPlaceSession?.finish?.(true)
      // the overlay editor commits itself via its own blur handler
      this.clearLifelineUi()
      this.popover.hide()
      if (this.editor.selection.length) this.editor.clearSelection('canvas')
    }
    // capture phase: other widgets on the page (e.g. CodeMirror) stop the
    // bubbling pointerdown before it would reach the document
    document.addEventListener('pointerdown', docPointerDown, true)
    this.disposers.push(() => document.removeEventListener('pointerdown', docPointerDown, true))

    if (this.panZoomEnabled) this.setupPanZoom()

    void this.render()
  }

  on<K extends keyof ViewEventMap>(event: K, fn: (payload: ViewEventMap[K]) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn as never)
    return () => this.listeners.get(event)!.delete(fn as never)
  }

  private emit<K extends keyof ViewEventMap>(event: K, payload: ViewEventMap[K]) {
    this.listeners.get(event)?.forEach((fn) => (fn as (p: ViewEventMap[K]) => void)(payload))
  }

  get currentTool(): Tool {
    return this.tool
  }

  get renderError(): string | null {
    return this.lastError
  }

  setTool(tool: Tool) {
    this.tool = tool
    this.container.classList.toggle('mw-tool-connect', tool === 'connect')
    this.cancelConnect()
    this.emit('toolChange', tool)
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly
    this.container.classList.toggle('mw-readonly', readOnly)
    this.closeInlineEditor(false)
    this.cancelConnect()
    this.clearLifelineUi()
    this.updatePopover()
  }

  /** Replace the interaction hooks (bindings re-apply this when props change). */
  setHooks(hooks: ViewHooks) {
    this.hooks = hooks
  }

  setAccentColor(color: string) {
    this.container.style.setProperty('--mw-accent', color)
  }

  /** Re-initialize mermaid with new config (e.g. theme) and re-render. */
  setMermaidConfig(config: Record<string, unknown>) {
    this.mermaidConfig = { ...this.mermaidConfig, ...config }
    this.mermaid.initialize(this.mermaidConfig)
    this.lastRenderedCode = ''
    void this.render()
  }

  /** Add a node and immediately open its inline label editor. */
  addNode(shape: ShapeId = 'rect', label = 'New node') {
    if (this.readOnly) return
    const res = this.editor.dispatch({ type: 'addNode', shape, label })
    const created = res?.created?.[0]
    if (created) this.pendingEditEntity = created
  }

  private scheduleRender() {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.renderTimer = setTimeout(() => void this.render(), this.debounceMs)
  }

  // ----- pan / zoom -----

  private setupPanZoom() {
    this.container.classList.add('mw-panzoom')

    const onWheel = (e: WheelEvent) => {
      // trackpad pinch arrives as ctrl+wheel; plain wheel keeps scrolling the page
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // pinches stream small deltas; discrete wheel ticks send ±100+ — clamp
      // so one tick can't triple the scale
      const delta = Math.max(-40, Math.min(40, e.deltaY))
      this.zoomAt(e.clientX, e.clientY, Math.exp(-delta * 0.01))
    }
    this.container.addEventListener('wheel', onWheel, { passive: false })
    this.disposers.push(() => this.container.removeEventListener('wheel', onWheel))

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (this.tool === 'connect' || e.altKey) return
      if (this.inlineInput || this.inPlaceSession) return
      const target = e.target as Element | null
      if (!target || !this.svgHost.contains(target)) return
      // background only — entity presses belong to select/drag gestures
      let el: Element | null = target
      while (el && el !== this.container) {
        if (el.getAttribute?.('data-mw-entity')) return
        el = el.parentElement
      }
      this.panSession = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: this.zoomTx, ty: this.zoomTy, moved: false }
    }
    const onMove = (e: PointerEvent) => {
      const pan = this.panSession
      if (!pan || e.pointerId !== pan.pointerId) return
      const dx = e.clientX - pan.x
      const dy = e.clientY - pan.y
      if (!pan.moved && Math.hypot(dx, dy) > 4) {
        pan.moved = true
        this.container.classList.add('mw-panning')
        try {
          this.container.setPointerCapture(e.pointerId)
        } catch {
          // synthetic pointers (tests, automation) have no capturable id
        }
        this.popover.hide()
      }
      if (pan.moved) {
        this.zoomTx = pan.tx + dx
        this.zoomTy = pan.ty + dy
        this.hasUserView = true
        this.applyViewTransform()
      }
    }
    const onUp = (e: PointerEvent) => {
      const pan = this.panSession
      if (!pan || e.pointerId !== pan.pointerId) return
      this.panSession = null
      this.container.classList.remove('mw-panning')
      if (pan.moved) {
        this.suppressNextClick = true
        this.updatePopover()
      }
    }
    this.container.addEventListener('pointerdown', onDown)
    this.container.addEventListener('pointermove', onMove)
    this.container.addEventListener('pointerup', onUp)
    this.container.addEventListener('pointercancel', onUp)
    this.disposers.push(() => {
      this.container.removeEventListener('pointerdown', onDown)
      this.container.removeEventListener('pointermove', onMove)
      this.container.removeEventListener('pointerup', onUp)
      this.container.removeEventListener('pointercancel', onUp)
    })

    const controls = document.createElement('div')
    controls.className = 'mw-zoom-controls'
    const btn = (title: string, iconMarkup: string, fn: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'mw-zoom-btn'
      b.title = title
      b.innerHTML = iconMarkup
      b.addEventListener('pointerdown', (e) => e.stopPropagation())
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        fn()
      })
      controls.appendChild(b)
    }
    btn('Zoom out', ICONS.minus, () => this.zoomBy(1 / 1.25))
    btn('Zoom in', ICONS.plus, () => this.zoomBy(1.25))
    btn('Fit diagram', ICONS.maximize, () => this.fitView())
    this.container.appendChild(controls)
    this.zoomControls = controls

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (!this.hasUserView) this.fitView()
      })
      ro.observe(this.container)
      this.disposers.push(() => ro.disconnect())
    }
  }

  /** zoom about the canvas center (used by the corner controls) */
  zoomBy(factor: number) {
    const rect = this.container.getBoundingClientRect()
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  private zoomAt(clientX: number, clientY: number, factor: number) {
    if (!this.panZoomEnabled) return
    const rect = this.container.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const next = Math.min(Math.max(this.zoomScale * factor, 0.1), 4)
    const k = next / this.zoomScale
    if (k === 1) return
    this.zoomTx = px - (px - this.zoomTx) * k
    this.zoomTy = py - (py - this.zoomTy) * k
    this.zoomScale = next
    this.hasUserView = true
    this.applyViewTransform()
    this.updatePopover()
  }

  /** scale + center the diagram to the canvas (the default view) */
  fitView() {
    if (!this.panZoomEnabled || !this.svg || !this.svgSize) return
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    if (!cw || !ch) return
    const pad = 28
    const { width, height } = this.svgSize
    const s = Math.min((cw - pad * 2) / width, (ch - pad * 2) / height)
    this.zoomScale = Math.min(Math.max(s, 0.1), 2)
    this.zoomTx = (cw - width * this.zoomScale) / 2
    this.zoomTy = (ch - height * this.zoomScale) / 2
    this.hasUserView = false
    this.applyViewTransform()
    this.updatePopover()
  }

  private applyViewTransform() {
    if (!this.svg) return
    this.applyingOwnTransform = true
    this.svg.style.transform = `translate(${this.zoomTx}px, ${this.zoomTy}px) scale(${this.zoomScale})`
    // mutation records for this write are delivered in a microtask queued at
    // mutation time — before this one — so the observer still sees the flag
    queueMicrotask(() => {
      this.applyingOwnTransform = false
    })
  }

  /** pixel-size the fresh svg from its viewBox so the transform is the only scaling */
  private prepareSvgForPanZoom() {
    const svg = this.svg
    if (!svg) return
    let width = 0
    let height = 0
    const vb = svg.viewBox?.baseVal
    if (vb && vb.width && vb.height) {
      width = vb.width
      height = vb.height
    } else {
      const bb = (svg as SVGGraphicsElement).getBBox?.()
      width = bb?.width || 800
      height = bb?.height || 600
    }
    this.svgSize = { width, height }
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.width = `${width}px`
    svg.style.height = `${height}px`
    svg.style.maxWidth = 'none'
    if (this.hasUserView) this.applyViewTransform()
    else this.fitView()
  }

  async render(): Promise<void> {
    // typing in place must feel like a plain textbox: never swap the SVG out
    // from under an active session. Live commits keep the code surfaces in
    // sync; the canvas catches up the moment the session ends.
    if (this.inPlaceSession) {
      this.renderHeldByEdit = true
      return
    }
    const code = this.editor.code
    if (code === this.lastRenderedCode) {
      // an intervening failed parse can leave a stale error badge even though
      // the document is back to the last successfully rendered text (e.g. undo
      // right after a broken keystroke)
      if (this.lastError) {
        this.lastError = null
        this.errorBadge.style.display = 'none'
        this.editor.setDiagnostics([])
        this.emit('render', { ok: true })
      }
      return
    }
    const seq = ++this.renderSeq
    const id = `mw-render-${++renderIdCounter}`
    try {
      const { svg } = await this.mermaid.render(id, code)
      if (seq !== this.renderSeq) return // stale
      // an in-place edit may have kept typing since the live commit this render
      // came from — snapshot the label's real text and caret before the swap
      // destroys them, then reinject below so no keystroke is lost
      // a session may have OPENED while the render was in flight — re-read it
      // through the accessor so the early-return narrowing above doesn't apply
      let liveEdit: { value: string; caret: number } | null = null
      const midFlightSession = this.activeInPlaceSession()
      const editingLabel = midFlightSession?.label
      if (midFlightSession && editingLabel?.isConnected) {
        liveEdit = { value: readLabelHtml(editingLabel), caret: caretOffsetWithin(editingLabel) }
        // a pending live-commit timer closes over the label we are about to
        // detach; the reinjection below reschedules it against the new one
        if (midFlightSession.liveTimer) {
          clearTimeout(midFlightSession.liveTimer)
          midFlightSession.liveTimer = null
        }
      }
      this.lastRenderedCode = code
      this.lastError = null
      this.errorBadge.style.display = 'none'
      this.svgHost.innerHTML = svg
      this.svg = this.svgHost.querySelector('svg')
      if (this.svg) {
        if (this.panZoomEnabled) this.prepareSvgForPanZoom()
        else this.svg.style.maxWidth = '100%'
        this.bindSvg()
      }
      this.editor.setDiagnostics([])
      this.emit('render', { ok: true })
      if (this.activeInPlaceSession()) {
        this.resumeInPlaceSession(liveEdit)
      } else if (this.pendingEditEntity) {
        const entity = this.pendingEditEntity
        this.pendingEditEntity = null
        if (this.editor.entityExists(entity)) this.editEntityLabel(entity)
      }
    } catch (err) {
      if (seq !== this.renderSeq) return
      // mermaid can leave a temp error element behind
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
      this.lastError = message
      this.errorBadge.textContent = `render error: ${message}`
      this.errorBadge.style.display = 'block'
      const diag: Diagnostic = { message, span: null, severity: 'error', source: 'mermaid' }
      this.editor.setDiagnostics([diag])
      this.emit('render', { ok: false, error: message })
    }
  }

  private bindSvg() {
    const svg = this.svg
    if (!svg) return
    const { flowchart, sequence, state, classGraph, er } = this.editor.result
    this.correlation = flowchart
      ? correlateFlowchart(svg, flowchart)
      : state
        ? correlateState(svg, state)
        : classGraph
          ? correlateClass(svg, classGraph)
          : er
            ? correlateEr(svg, er)
            : this.editor.result.pie
              ? correlatePie(svg, this.editor.result.pie)
              : this.editor.result.gantt
                ? correlateGantt(svg, this.editor.result.gantt)
                : this.editor.result.lineItems
                  ? correlateLineItems(svg, this.editor.result.lineItems)
                  : null
    this.seqCorrelation = sequence ? correlateSequence(svg, sequence) : null
    this.clearLifelineUi()

    svg.addEventListener('click', (e) => this.onSvgClick(e))
    svg.addEventListener('dblclick', (e) => this.onSvgDblClick(e))
    svg.addEventListener('pointerdown', (e) => this.onSvgPointerDown(e))
    svg.addEventListener('pointermove', (e) => this.onSvgPointerMove(e))
    svg.addEventListener('pointerup', (e) => this.onSvgPointerUp(e))
    if (this.seqCorrelation) {
      svg.addEventListener('pointermove', (e) => this.onLifelineHover(e))
      svg.addEventListener('pointerleave', () => this.scheduleLifelineClear())
    }

    // host apps may pan/zoom the svg from their own toolbars (transform on
    // the svg or an inner group) — the popover must follow its entity instead
    // of floating where the diagram used to be
    this.svgTransformObserver?.disconnect()
    if (typeof MutationObserver !== 'undefined') {
      this.svgTransformObserver = new MutationObserver(() => {
        // internal pan/zoom paths already reposition the popover themselves
        if (this.applyingOwnTransform || this.popoverFollowRaf || !this.popover.isOpen) return
        const schedule =
          typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (fn: FrameRequestCallback) => setTimeout(fn, 16) as unknown as number
        this.popoverFollowRaf = schedule(() => {
          this.popoverFollowRaf = 0
          this.updatePopover()
        })
      })
      this.svgTransformObserver.observe(svg, {
        attributes: true,
        attributeFilter: ['style', 'transform'],
        subtree: true,
      })
    }

    this.applySelectionStyles()
  }

  private entityFromEvent(e: Event): string | null {
    return this.entityHitFromEvent(e)?.id ?? null
  }

  /** entity id plus the concrete element that was hit (a participant has several) */
  private entityHitFromEvent(e: Event): { id: string; el: Element } | null {
    let el = e.target as Element | null
    while (el && el !== this.svg) {
      const entity = el.getAttribute?.('data-mw-entity')
      if (entity) return { id: entity, el }
      el = el.parentElement as Element | null
    }
    return null
  }

  /** topmost of the elements belonging to an entity (e.g. a participant's top box) */
  private topmostEntityElement(entityId: string): Element | null {
    let best: Element | null = null
    let bestTop = Infinity
    this.svg?.querySelectorAll(`[data-mw-entity="${CSS.escape(entityId)}"]`).forEach((el) => {
      const top = el.getBoundingClientRect().top
      if (top < bestTop) {
        bestTop = top
        best = el
      }
    })
    return best
  }

  private onSvgClick(e: MouseEvent) {
    // pointer capture during a connect gesture retargets the click to the svg
    // root; the pointerup handler has already decided what the gesture meant
    if (this.suppressNextClick) {
      this.suppressNextClick = false
      return
    }
    // while an in-place editor is open, clicks must not re-select or steal
    // focus — blurring the editor already commits the edit
    if (this.inlineInput || this.inPlaceSession) return
    const hit = this.entityHitFromEvent(e)
    if (hit) {
      const entity = hit.id
      this.hooks.onEntityClick?.(entity, e)
      // several elements can share one entity id (a sequence participant is
      // rendered as a top AND a bottom box) — remember which one was clicked
      // so the popover opens where the user pointed, not at the topmost twin
      this.popoverAnchorPick = { entityId: entity, index: this.entityElementIndex(entity, hit.el) }
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const sel = this.editor.selection.includes(entity)
          ? this.editor.selection.filter((s) => s !== entity)
          : [...this.editor.selection, entity]
        this.editor.setSelection(sel, 'canvas')
      } else {
        this.editor.setSelection([entity], 'canvas')
        // clicking the other twin of an already-selected entity changes the
        // anchor pick but not the selection — no selectionChange fires, so
        // re-anchor explicitly
        this.updatePopover()
      }
      this.container.focus({ preventScroll: true })
    } else {
      this.editor.clearSelection('canvas')
    }
  }

  /** position of `el` among all elements carrying this entity id (DOM order) */
  private entityElementIndex(entityId: string, el: Element): number {
    if (!this.svg) return 0
    const els = [...this.svg.querySelectorAll(`[data-mw-entity="${CSS.escape(entityId)}"]`)]
    const index = els.indexOf(el)
    return index >= 0 ? index : 0
  }

  private onSvgDblClick(e: MouseEvent) {
    if (this.readOnly) return
    // class members are editable rows inside the class box
    const memberEl = (e.target as Element).closest?.('[data-mw-member-line]')
    if (memberEl && this.editor.result.classGraph) {
      const clsId = memberEl.getAttribute('data-mw-member-class')!
      const lineIndex = Number(memberEl.getAttribute('data-mw-member-line'))
      const cls = this.editor.result.classGraph.classById.get(clsId)
      const member = cls?.members.find((m) => m.lineIndex === lineIndex)
      if (member) {
        e.preventDefault()
        this.popover.hide()
        this.editInPlace(
          `member:${clsId}:${lineIndex}`,
          memberEl,
          '.nodeLabel',
          member.text,
          (v) => this.editor.dispatch({ type: 'cl.setMemberText', id: clsId, memberLine: lineIndex, text: v }, 'canvas'),
          { live: false },
        )
        return
      }
    }
    // ER attribute rows edit the whole source line (type name keys "comment")
    const attrEl = (e.target as Element).closest?.('[data-mw-attr-line]')
    if (attrEl && this.editor.result.er) {
      const entityId = attrEl.getAttribute('data-mw-attr-entity')!
      const attrLine = Number(attrEl.getAttribute('data-mw-attr-line'))
      const entity = this.editor.result.er.entityById.get(entityId)
      const attr = entity?.attributes.find((a) => a.lineIndex === attrLine)
      if (attr) {
        e.preventDefault()
        this.popover.hide()
        this.openOverlayEditor(attrEl, attr.text, (v) =>
          this.editor.dispatch({ type: 'er.setAttributeText', id: entityId, attrLine, text: v }, 'canvas'),
        )
        return
      }
    }
    const hit = this.entityHitFromEvent(e)
    if (!hit) return
    e.preventDefault()
    if (this.hooks.onEntityDoubleClick?.(hit.id)) return
    // edit at the element the user actually double-clicked (a participant is
    // rendered twice — top and bottom box — and either should be editable)
    this.editEntityLabel(hit.id, hit.el)
  }

  // ----- drag to connect -----

  private onSvgPointerDown(e: PointerEvent) {
    if (this.readOnly) return
    const entity = this.entityFromEvent(e)
    const connectable =
      entity?.startsWith('node:') ||
      entity?.startsWith('participant:') ||
      entity?.startsWith('state:') ||
      entity?.startsWith('class:') ||
      entity?.startsWith('entity:')
    const wantConnect = this.tool === 'connect' || e.altKey
    if (connectable && wantConnect && entity) {
      e.preventDefault()
      this.connectSource = entity
      this.svg?.setPointerCapture?.(e.pointerId)
      this.entityElement(entity)?.classList.add('mw-connect-source')
      this.emit('connectPreview', { source: entity })
      return
    }
    // sequence events can be dragged vertically to reorder statements
    // (skip on a double-click's second press — that gesture is text editing).
    // Pointer capture waits until the drag threshold: capturing on press
    // retargets the click to the svg and breaks double-click detection.
    if (entity?.startsWith('event:') && this.editor.result.sequence && e.detail <= 1) {
      this.dragEvent = entity
      this.dragStartY = e.clientY
      this.dragging = false
    }
  }

  private entityElement(entityId: string): Element | null {
    return this.svg?.querySelector(`[data-mw-entity="${CSS.escape(entityId)}"]`) ?? null
  }

  private onSvgPointerMove(e: PointerEvent) {
    if (this.dragEvent && this.svg) {
      if (!this.dragging && Math.abs(e.clientY - this.dragStartY) > 8) {
        this.dragging = true
        this.svg.setPointerCapture?.(e.pointerId)
        this.computeDropSlots()
        this.popover.hide()
      }
      if (this.dragging) {
        const host = this.container.getBoundingClientRect()
        const y = e.clientY - host.top + this.container.scrollTop
        const slot = this.nearestSlot(y)
        if (slot) this.showDropIndicator(slot.y)
      }
      return
    }
    if (!this.connectSource || !this.svg) return
    const from = this.entityCenter(this.connectSource)
    const to = this.clientToSvg(e.clientX, e.clientY)
    if (!from || !to) return
    if (!this.ghostPath) {
      this.ghostPath = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      this.ghostPath.classList.add('mw-ghost-edge')
      this.svg.appendChild(this.ghostPath)
    }
    this.ghostPath.setAttribute('x1', String(from.x))
    this.ghostPath.setAttribute('y1', String(from.y))
    this.ghostPath.setAttribute('x2', String(to.x))
    this.ghostPath.setAttribute('y2', String(to.y))
  }

  private onSvgPointerUp(e: PointerEvent) {
    if (this.dragEvent) {
      const dragged = this.dragEvent
      const wasDragging = this.dragging
      this.dragEvent = null
      this.dragging = false
      this.dropIndicator?.remove()
      this.dropIndicator = null
      if (wasDragging) {
        this.suppressNextClick = true
        const host = this.container.getBoundingClientRect()
        const slot = this.nearestSlot(e.clientY - host.top + this.container.scrollTop)
        if (slot) this.editor.dispatch({ type: 'seq.moveEvent', eventId: dragged, afterEvent: slot.afterEvent })
      }
      return
    }
    if (!this.connectSource) return
    const source = this.connectSource
    // hit test at pointer location (ghost line has pointer-events: none)
    const kind = source.startsWith('node:')
      ? 'node:'
      : source.startsWith('state:')
        ? 'state:'
        : source.startsWith('class:')
          ? 'class:'
          : source.startsWith('entity:')
            ? 'entity:'
            : 'participant:'
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    let target: string | null = null
    let el = hit as Element | null
    while (el && el !== this.container) {
      const entity = el.getAttribute?.('data-mw-entity')
      if (entity?.startsWith(kind)) {
        target = entity
        break
      }
      el = el.parentElement
    }
    this.cancelConnect()
    this.suppressNextClick = true
    if (target && target !== source && kind === 'node:') {
      this.editor.dispatch({
        type: 'connect',
        source: source.slice(5),
        target: target.slice(5),
        line: this.defaultEdge.line,
        arrowEnd: this.defaultEdge.arrowEnd,
      })
    } else if (target && target !== source && kind === 'participant:') {
      this.editor.dispatch({
        type: 'seq.addMessage',
        source: source.slice(12),
        target: target.slice(12),
        text: 'message',
      })
    } else if (target && target !== source && kind === 'state:') {
      this.editor.dispatch({ type: 'st.connect', source: source.slice(6), target: target.slice(6) })
    } else if (target && target !== source && kind === 'class:') {
      this.editor.dispatch({ type: 'cl.connect', source: source.slice(6), target: target.slice(6) })
    } else if (target && target !== source && kind === 'entity:') {
      this.editor.dispatch({ type: 'er.connect', source: source.slice(7), target: target.slice(7) })
    } else {
      // no drag happened — treat as a plain click-select on the source node
      this.editor.setSelection([source], 'canvas')
      this.container.focus({ preventScroll: true })
    }
  }

  private cancelConnect() {
    if (this.connectSource) {
      this.entityElement(this.connectSource)?.classList.remove('mw-connect-source')
    }
    this.connectSource = null
    this.ghostPath?.remove()
    this.ghostPath = null
    this.emit('connectPreview', { source: null })
  }

  // ----- inline label editing -----

  editEntityLabel(entityId: string, anchorHint?: Element | null) {
    if (this.readOnly) return
    const { flowchart, sequence } = this.editor.result
    this.closeInlineEditor(false)
    // moving to a different entity must settle the open session first — its
    // deferred blur handler would see a replaced session and bail, stranding
    // the old label contenteditable with uncommitted text
    if (this.inPlaceSession && this.inPlaceSession.entityId !== entityId) {
      this.inPlaceSession.finish?.(true)
    }
    this.popover.hide()

    // only honor a hint that actually belongs to this entity
    const hint =
      anchorHint && anchorHint.getAttribute('data-mw-entity') === entityId ? anchorHint : null
    let anchor: Element | null = null
    let current = ''
    let commitValue: (value: string) => void = () => {}

    if (flowchart && entityId.startsWith('node:')) {
      const node = flowchart.nodeById.get(entityId.slice(5))
      if (!node) return
      current = node.label
      anchor = this.correlation?.nodes.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'renameNode', id: node.id, label: v }, 'canvas')
      // natural in-node editing when mermaid rendered an HTML label
      if (anchor && this.editInPlace(entityId, anchor, '.nodeLabel', current, commitValue)) return
    } else if (flowchart && entityId.startsWith('edge:')) {
      const edge = flowchart.edges.find((ed) => ed.entityId === entityId)
      if (!edge) return
      current = edge.label ?? ''
      anchor = this.correlation?.edgeLabels.get(entityId) ?? this.correlation?.edges.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'setEdgeLabel', edgeId: entityId, label: v }, 'canvas')
      if (edge.label && anchor && this.editInPlace(entityId, anchor, '.edgeLabel', current, commitValue)) return
    } else if (flowchart && entityId.startsWith('subgraph:')) {
      const sg = flowchart.subgraphs.find((s) => s.entityId === entityId)
      if (!sg) return
      current = sg.title ?? sg.id
      anchor =
        this.correlation?.nodes.get(entityId)?.querySelector('.cluster-label') ??
        hint ??
        this.correlation?.nodes.get(entityId) ??
        this.svg?.querySelector(`#${CSS.escape(sg.id)}`) ??
        null
      commitValue = (v) => this.editor.dispatch({ type: 'renameSubgraph', id: sg.id, title: v }, 'canvas')
    } else if (this.editor.result.state && entityId.startsWith('state:')) {
      const s = this.editor.result.state.stateById.get(entityId.slice(6))
      if (!s) return
      current = s.label
      anchor = this.correlation?.nodes.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'st.setStateLabel', id: s.id, label: v }, 'canvas')
      if (anchor && this.editInPlace(entityId, anchor, '.nodeLabel', current, commitValue)) return
    } else if (this.editor.result.state && entityId.startsWith('trans:')) {
      const t = this.editor.result.state.transitions.find((tr) => tr.entityId === entityId)
      if (!t) return
      current = t.label ?? ''
      anchor = this.correlation?.edgeLabels.get(entityId) ?? this.correlation?.edges.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'st.setTransitionLabel', transId: entityId, label: v }, 'canvas')
      if (t.label && anchor && this.editInPlace(entityId, anchor, '.edgeLabel', current, commitValue)) return
    } else if (this.editor.result.classGraph && entityId.startsWith('class:')) {
      const c = this.editor.result.classGraph.classById.get(entityId.slice(6))
      if (!c) return
      current = c.id
      anchor = hint ?? this.correlation?.nodes.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'cl.renameClass', id: c.id, name: v }, 'canvas')
    } else if (this.editor.result.classGraph && entityId.startsWith('rel:')) {
      const r = this.editor.result.classGraph.relations.find((rr) => rr.entityId === entityId)
      if (!r) return
      current = r.label ?? ''
      anchor = this.correlation?.edgeLabels.get(entityId) ?? this.correlation?.edges.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'cl.setRelationLabel', relId: entityId, label: v }, 'canvas')
    } else if (this.editor.result.er && entityId.startsWith('entity:')) {
      const e = this.editor.result.er.entityById.get(entityId.slice(7))
      if (!e) return
      current = e.id
      anchor = hint ?? this.correlation?.nodes.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'er.renameEntity', id: e.id, name: v }, 'canvas')
    } else if (this.editor.result.er && entityId.startsWith('erel:')) {
      const r = this.editor.result.er.relations.find((rr) => rr.entityId === entityId)
      if (!r) return
      current = r.label
      anchor = this.correlation?.edgeLabels.get(entityId) ?? this.correlation?.edges.get(entityId) ?? null
      commitValue = (v) => this.editor.dispatch({ type: 'er.setRelationLabel', relId: entityId, label: v }, 'canvas')
    } else if (this.editor.result.pie && entityId.startsWith('slice:')) {
      const s = this.editor.result.pie.slices.find((sl) => sl.entityId === entityId)
      if (!s) return
      current = String(s.value)
      anchor = hint ?? this.entityElement(entityId)
      commitValue = (v) => {
        const value = Number(v)
        if (Number.isFinite(value)) this.editor.dispatch({ type: 'pie.setValue', sliceId: entityId, value }, 'canvas')
      }
    } else if (this.editor.result.gantt && entityId.startsWith('task:')) {
      const t = this.editor.result.gantt.tasks.find((tk) => tk.entityId === entityId)
      if (!t) return
      current = t.name
      anchor = hint ?? this.entityElement(entityId)
      commitValue = (v) => this.editor.dispatch({ type: 'gantt.setTaskName', taskId: entityId, name: v }, 'canvas')
    } else if (this.editor.result.lineItems && entityId.startsWith('item:')) {
      const item = this.editor.result.lineItems.items.find((i) => i.entityId === entityId)
      if (!item) return
      current = item.text
      anchor = hint ?? this.entityElement(entityId)
      commitValue = (v) => this.editor.dispatch({ type: 'li.setLine', itemId: entityId, text: v }, 'canvas')
    } else if (sequence && entityId.startsWith('participant:')) {
      const p = sequence.participantById.get(entityId.slice(12))
      if (!p) return
      current = p.label
      // edit in whichever box was double-clicked; default to the top one
      anchor = hint ?? this.topmostEntityElement(entityId)
      commitValue = (v) => this.editor.dispatch({ type: 'seq.renameParticipant', id: p.id, name: v }, 'canvas')
    } else if (sequence && entityId.startsWith('event:')) {
      const ev = sequence.events.find((e) => e.entityId === entityId)
      if (!ev) return
      current = ev.stmt.text
      anchor = this.seqCorrelation?.eventTexts.get(entityId) ?? hint ?? this.entityElement(entityId)
      commitValue = (v) => this.editor.dispatch({ type: 'seq.setEventText', eventId: entityId, text: v }, 'canvas')
    }
    if (!anchor) return
    this.openOverlayEditor(anchor, current, commitValue)
  }

  /**
   * Edit the label directly inside the node: mermaid's HTML labels
   * (foreignObject spans) become contenteditable, so text is edited in place.
   * While typing, changes are live-committed (debounced) so the node grows to
   * fit — the session survives the re-render and re-attaches with the caret
   * restored.
   */
  private editInPlace(
    entityId: string,
    anchor: Element,
    labelSelector: string,
    current: string,
    commitValue: (value: string) => void,
    opts: { live?: boolean } = {},
  ): boolean {
    const label = anchor.matches?.(labelSelector)
      ? ((anchor.querySelector<HTMLElement>('p') ?? anchor) as HTMLElement)
      : (anchor.querySelector<HTMLElement>(`${labelSelector} p`) ?? anchor.querySelector<HTMLElement>(labelSelector))
    if (!label || !(label instanceof HTMLElement)) return false

    const resuming = this.inPlaceSession?.entityId === entityId
    if (resuming && this.inPlaceSession!.label === label && label.isConnected) {
      // the session is already attached to this exact element (e.g. a second
      // double-click mid-session) — re-adding listeners would duplicate every
      // commit and let stale closures race the live ones
      label.focus()
      return true
    }
    if (!resuming) {
      this.inPlaceSession = {
        entityId,
        labelSelector,
        original: current,
        lastCommitted: current,
        caretOffset: -1,
        commitValue,
        liveTimer: null,
        label: null,
        finish: null,
      }
    }
    const session = this.inPlaceSession!
    session.label = label

    label.setAttribute('contenteditable', 'true')
    // the box can't grow while renders are held — keep the text on one line
    // and let it spill past the shape instead of wrapping into the clip
    const clipHost = label.closest('foreignObject') as SVGElement | null
    const prevWhiteSpace = label.style.whiteSpace
    const prevClipOverflow = clipHost?.style.overflow ?? ''
    label.style.whiteSpace = 'nowrap'
    if (clipHost) clipHost.style.overflow = 'visible'
    label.focus()
    if (resuming && session.caretOffset >= 0) {
      placeCaretAt(label, session.caretOffset)
    } else {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(label)
      selection?.removeAllRanges()
      selection?.addRange(range)
    }

    const rememberCaret = () => {
      const offset = caretOffsetWithin(label)
      if (offset >= 0) session.caretOffset = offset
    }

    const liveCommit = () => {
      if (this.inPlaceSession !== session) return
      const value = readLabelHtml(label)
      if (!value || value === session.lastCommitted) return
      rememberCaret()
      session.lastCommitted = value
      session.commitValue(value)
    }

    const finish = (commit: boolean) => {
      if (this.inPlaceSession !== session) return
      this.inPlaceSession = null
      if (session.liveTimer) clearTimeout(session.liveTimer)
      label.removeAttribute('contenteditable')
      label.style.whiteSpace = prevWhiteSpace
      if (clipHost) clipHost.style.overflow = prevClipOverflow
      label.removeEventListener('keydown', onKey)
      label.removeEventListener('blur', onBlur)
      label.removeEventListener('input', onInput)
      const value = readLabelHtml(label)
      if (commit) {
        if (value && value !== session.lastCommitted) session.commitValue(value)
        else if (!value) label.textContent = session.lastCommitted
      } else {
        // Escape: revert everything, including live-committed intermediate
        // states. Restore the label DOM directly too — when the reverted code
        // equals the last rendered code, render() short-circuits and would
        // leave the typed text on screen.
        label.innerHTML = session.original
        if (session.lastCommitted !== session.original) session.commitValue(session.original)
      }
      // apply any canvas render held back while the session was typing
      if (this.renderHeldByEdit) {
        this.renderHeldByEdit = false
        this.scheduleRender()
      }
      this.updatePopover()
    }

    const onInput = () => {
      if (opts.live === false) return
      if (session.liveTimer) clearTimeout(session.liveTimer)
      session.liveTimer = setTimeout(liveCommit, 450)
    }
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        finish(false)
      }
    }
    const onBlur = () => {
      // a re-render removes the label mid-session — that is not a real blur
      setTimeout(() => {
        if (this.inPlaceSession === session && label.isConnected && document.activeElement !== label) {
          finish(true)
        }
      }, 60)
    }
    session.finish = finish
    label.addEventListener('keydown', onKey)
    label.addEventListener('blur', onBlur)
    label.addEventListener('input', onInput)
    return true
  }

  /** non-narrowing accessor: render() re-reads the session after awaits */
  private activeInPlaceSession() {
    return this.inPlaceSession
  }

  /** re-attach a live in-place editing session after a render replaced the DOM */
  private resumeInPlaceSession(liveEdit?: { value: string; caret: number } | null) {
    const session = this.inPlaceSession
    if (!session) return
    if (!this.editor.entityExists(session.entityId)) {
      this.inPlaceSession = null
      return
    }
    const anchor =
      (session.entityId.startsWith('edge:') ? this.correlation?.edgeLabels.get(session.entityId) : null) ??
      this.entityElement(session.entityId)
    if (!anchor) {
      this.inPlaceSession = null
      return
    }
    this.editInPlace(session.entityId, anchor, session.labelSelector, session.lastCommitted, session.commitValue)
    // reinject what the user typed between the live commit and the swap — the
    // freshly rendered label only carries the committed text
    const label = this.inPlaceSession === session ? session.label : null
    if (!label || !liveEdit) return
    if (liveEdit.value && liveEdit.value !== session.lastCommitted && liveEdit.value !== readLabelHtml(label)) {
      label.innerHTML = liveEdit.value
      // run the carried-over delta through the normal live-commit debounce
      label.dispatchEvent(new Event('input'))
    }
    if (liveEdit.caret >= 0) placeCaretAt(label, liveEdit.caret)
  }

  /**
   * Seamless in-place editing for targets that can't be contenteditable
   * themselves (SVG text, slices, bars): a chrome-less editable div is placed
   * exactly over the element with its typography copied, and the original is
   * hidden for the duration — it reads as editing the diagram text directly.
   */
  /** the visual text node inside a target — editing must sit on the glyphs */
  private findTextTarget(anchor: Element, current: string): Element {
    const isLeafText = (el: Element) =>
      (el.tagName === 'text' || el.tagName === 'SPAN' || el.tagName === 'P' || el.tagName === 'DIV' || el.tagName === 'tspan') &&
      (el.children.length === 0 || el.tagName === 'text') &&
      (el.textContent?.trim().length ?? 0) > 0
    if (isLeafText(anchor)) return anchor
    let leaves = [...anchor.querySelectorAll<Element>('text, tspan, span, p, div')].filter(isLeafText)
    if (!leaves.length && anchor.parentElement) {
      // a hit on a bare shape (e.g. a participant box <rect>) has no text
      // descendants — the glyphs are a SIBLING inside the same group. Without
      // this widening the shape itself gets hidden and the editor floats over
      // the still-visible label, double-rendering it.
      leaves = [...anchor.parentElement.querySelectorAll<Element>('text, tspan, span, p, div')].filter(isLeafText)
    }
    return (
      leaves.find((el) => el.textContent?.trim() === current.trim()) ??
      leaves.find((el) => current.trim().startsWith(el.textContent?.trim() ?? ' ')) ??
      leaves[0] ??
      anchor
    )
  }

  private openOverlayEditor(anchor: Element, current: string, commitValue: (value: string) => void) {
    anchor = this.findTextTarget(anchor, current)
    const box = this.hostRect(anchor)
    // SVG glyph paint often lives on an inner <tspan> while the outer <text>
    // carries a background-matching fill (mermaid sequence actor boxes do
    // this) — read typography and color from the innermost carrier so the
    // editor's text doesn't render background-on-background.
    const paintSource = anchor.querySelector('tspan') ?? anchor
    const cs = window.getComputedStyle(paintSource)
    const div = document.createElement('div')
    div.className = 'mw-inplace-editor'
    div.contentEditable = 'true'
    div.spellcheck = false
    div.textContent = current
    // grow from the text's center so it stays visually anchored while typing
    div.style.left = `${box.left + box.width / 2}px`
    div.style.top = `${box.top}px`
    div.style.transform = 'translateX(-50%)'
    div.style.textAlign = 'center'
    div.style.minWidth = `${Math.max(24, box.width)}px`
    div.style.lineHeight = `${Math.max(box.height, 12)}px`
    div.style.fontStyle = cs.fontStyle
    div.style.fontWeight = cs.fontWeight
    // computed font-size ignores the pan/zoom transform; the overlay must
    // match the scaled glyphs it covers
    const zoom = this.panZoomEnabled ? this.zoomScale : 1
    const basePx = Number.parseFloat(cs.fontSize)
    div.style.fontSize = Number.isFinite(basePx) ? `${basePx * zoom}px` : cs.fontSize
    div.style.fontFamily = cs.fontFamily
    // svg text is colored via fill; html labels via color
    const fill = cs.fill && cs.fill !== 'none' && paintSource instanceof SVGElement ? cs.fill : cs.color
    div.style.color = fill || 'inherit'
    this.overlayHost.appendChild(div)
    this.inlineInput = div

    // hide the original so the editor reads as the element itself
    const target = anchor as HTMLElement | SVGElement
    const prevVisibility = target.style?.visibility ?? ''
    if (target.style) target.style.visibility = 'hidden'
    this.inlineHidden = { el: target, prevVisibility }

    div.focus()
    const range = document.createRange()
    range.selectNodeContents(div)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const commit = () => {
      const value = (div.textContent ?? '').trim()
      this.closeInlineEditor(false)
      if (value === current) return
      commitValue(value)
    }
    div.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
      if (e.key === 'Escape') this.closeInlineEditor(false)
    })
    div.addEventListener('blur', commit)
  }

  private closeInlineEditor(refocus: boolean) {
    if (this.inlineHidden) {
      if (this.inlineHidden.el.style) this.inlineHidden.el.style.visibility = this.inlineHidden.prevVisibility
      this.inlineHidden = null
    }
    if (this.inlineInput) {
      const input = this.inlineInput
      this.inlineInput = null
      input.remove()
      if (refocus) this.container.focus({ preventScroll: true })
    }
  }

  // ----- keyboard -----

  private onKeyDown(e: KeyboardEvent) {
    if (this.inlineInput) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.editor.redo()
      else this.editor.undo()
      return
    }
    if (this.readOnly) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.editor.selection.length) {
      e.preventDefault()
      this.editor.deleteEntities(this.editor.selection, 'canvas')
      return
    }
    if (e.key === 'Escape') {
      this.cancelConnect()
      this.editor.clearSelection('canvas')
      return
    }
    if (e.key === 'Enter' && this.editor.selection.length === 1) {
      e.preventDefault()
      this.editEntityLabel(this.editor.selection[0])
    }
  }

  // ----- selection visuals -----

  private applySelectionStyles() {
    if (!this.svg) return
    this.svg.querySelectorAll('.mw-selected').forEach((el) => el.classList.remove('mw-selected'))
    for (const id of this.editor.selection) {
      this.svg.querySelectorAll(`[data-mw-entity="${CSS.escape(id)}"]`).forEach((el) => {
        el.classList.add('mw-selected')
      })
    }
    this.updatePopover()
  }

  // ----- entity popover -----

  private hostRect(el: Element): { left: number; top: number; width: number; height: number } {
    const rect = el.getBoundingClientRect()
    const host = this.container.getBoundingClientRect()
    return {
      left: rect.left - host.left + this.container.scrollLeft,
      top: rect.top - host.top + this.container.scrollTop,
      width: rect.width,
      height: rect.height,
    }
  }

  private updatePopover() {
    this.popover.hide()
    if (this.readOnly || this.inlineInput || this.inPlaceSession) return
    const sel = this.editor.selection
    if (sel.length !== 1 || !this.svg) return
    const id = sel[0]
    // several elements can belong to one entity (e.g. participant top+bottom
    // boxes) — anchor at the element the user actually clicked when we know
    // it, falling back to the topmost twin (code-pane selection sync, resumes
    // after re-renders that changed the element count)
    const els = [...this.svg.querySelectorAll(`[data-mw-entity="${CSS.escape(id)}"]`)]
    let anchor: Element | null = null
    const pick = this.popoverAnchorPick
    if (pick && pick.entityId === id && els[pick.index]) {
      anchor = els[pick.index]
    } else {
      let anchorTop = Infinity
      for (const el of els) {
        const top = el.getBoundingClientRect().top
        if (top < anchorTop) {
          anchorTop = top
          anchor = el
        }
      }
    }
    if (!anchor) return
    const actions = this.actionsFor(id)
    if (!actions.length) return
    this.popover.show(this.hostRect(anchor), actions)
  }

  private colorSection(title: string, onPick: (value: string | null) => void): PopoverPanelSection {
    return {
      title,
      columns: 5,
      items: [
        ...COLOR_PALETTE.map((c) => ({ swatch: c, title: `${title}: ${c}`, onClick: () => onPick(c) })),
        { swatch: 'none', title: `${title}: default`, onClick: () => onPick(null) },
      ],
    }
  }

  private actionsFor(id: string): PopoverAction[] {
    const { flowchart, sequence } = this.editor.result
    const del: PopoverAction = {
      icon: ICONS.trash,
      title: 'Delete',
      danger: true,
      onClick: () => this.editor.deleteEntities([id]),
    }
    const rename: PopoverAction = { icon: ICONS.pencil, title: 'Edit text', onClick: () => this.editEntityLabel(id) }

    if (flowchart && id.startsWith('node:')) {
      const node = flowchart.nodeById.get(id.slice(5))
      if (!node) return []
      const shapes: Array<{ s: ShapeId; g: string; t: string }> = [
        { s: 'rect', g: '▭', t: 'Rectangle' },
        { s: 'round', g: '▢', t: 'Rounded' },
        { s: 'stadium', g: '⬭', t: 'Stadium' },
        { s: 'diamond', g: '◇', t: 'Diamond' },
        { s: 'hexagon', g: '⬡', t: 'Hexagon' },
        { s: 'circle', g: '◯', t: 'Circle' },
        { s: 'cylinder', g: '⛁', t: 'Cylinder' },
        { s: 'subroutine', g: '⧉', t: 'Subroutine' },
      ]
      return [
        {
          icon: ICONS.shapes,
          title: 'Node shape',
          panel: {
            title: 'Node shape',
            items: shapes.map((sh) => ({
              glyph: sh.g,
              title: sh.t,
              selected: node.shape === sh.s,
              onClick: () => this.editor.dispatch({ type: 'setNodeShape', id: node.id, shape: sh.s }),
            })),
          },
        },
        {
          icon: ICONS.palette,
          title: 'Colors',
          panel: {
            title: 'Colors',
            sections: (['fill', 'stroke', 'color'] as const).map((prop) =>
              this.colorSection(prop === 'fill' ? 'Fill' : prop === 'stroke' ? 'Border' : 'Text', (value) =>
                this.editor.dispatch({ type: 'setNodeColor', id: node.id, prop, value }),
              ),
            ),
          },
        },
        {
          icon: ICONS.copy,
          title: 'Duplicate',
          onClick: () => this.editor.dispatch({ type: 'duplicateNode', id: node.id }),
        },
        rename,
        del,
      ]
    }

    if (flowchart && id.startsWith('subgraph:')) {
      return [{ icon: ICONS.pencil, title: 'Rename subgraph', onClick: () => this.editEntityLabel(id) }]
    }

    if (flowchart && id.startsWith('edge:')) {
      const edge = flowchart.edges.find((e) => e.entityId === id)
      if (!edge) return []
      const kinds: Array<{ line: EdgeLine; arrowEnd: EdgeArrow; g: string; t: string }> = [
        { line: 'solid', arrowEnd: 'arrow', g: '—▶', t: 'solid arrow' },
        { line: 'dotted', arrowEnd: 'arrow', g: '⋯▶', t: 'dotted arrow' },
        { line: 'thick', arrowEnd: 'arrow', g: '═▶', t: 'thick arrow' },
        { line: 'solid', arrowEnd: 'open', g: '——', t: 'solid open' },
        { line: 'dotted', arrowEnd: 'open', g: '⋯⋯', t: 'dotted open' },
        { line: 'thick', arrowEnd: 'open', g: '══', t: 'thick open' },
        { line: 'solid', arrowEnd: 'cross', g: '—✕', t: 'solid cross' },
        { line: 'solid', arrowEnd: 'circle', g: '—●', t: 'solid circle' },
      ]
      return [
        {
          icon: ICONS.arrowRight,
          title: 'Edge type',
          panel: {
            title: 'Edge type',
            items: kinds.map((k) => ({
              glyph: k.g,
              title: k.t,
              selected: edge.seg.line === k.line && edge.seg.arrowEnd === k.arrowEnd,
              onClick: () =>
                this.editor.dispatch({ type: 'setEdgeStyle', edgeId: id, line: k.line, arrowEnd: k.arrowEnd }),
            })),
          },
        },
        {
          icon: ICONS.palette,
          title: 'Edge color',
          panel: {
            title: 'Edge color',
            sections: [this.colorSection('Stroke', (value) => this.editor.dispatch({ type: 'setEdgeColor', edgeId: id, value }))],
          },
        },
        {
          icon: ICONS.arrowLeftRight,
          title: 'Reverse direction',
          onClick: () => this.editor.dispatch({ type: 'reverseEdge', edgeId: id }),
        },
        rename,
        del,
      ]
    }

    if (this.editor.result.state && id.startsWith('state:')) {
      const s = this.editor.result.state.stateById.get(id.slice(6))
      if (!s) return []
      if (s.isComposite) return [rename]
      const types = [
        { t: 'state', g: '▢' },
        { t: 'choice', g: '◇' },
        { t: 'fork', g: '⑃' },
        { t: 'join', g: '⑂' },
      ] as const
      return [
        {
          icon: ICONS.square,
          title: 'State type',
          panel: {
            title: 'State type',
            items: types.map((k) => ({
              glyph: k.g,
              title: k.t,
              selected: (s.stereotype ?? 'state') === k.t,
              onClick: () => this.editor.dispatch({ type: 'st.setStateType', id: s.id, stype: k.t }),
            })),
          },
        },
        {
          icon: ICONS.stickyNote,
          title: 'Add note',
          panel: {
            title: 'Note',
            items: (['left', 'right'] as const).map((side) => ({
              glyph: side === 'left' ? '◧' : '◨',
              title: `Note ${side}`,
              onClick: () => this.editor.dispatch({ type: 'st.addStateNote', id: s.id, side }),
            })),
          },
        },
        {
          icon: ICONS.frame,
          title: 'Move to composite',
          onClick: () => this.editor.dispatch({ type: 'st.moveToComposite', id: s.id }),
        },
        rename,
        del,
      ]
    }
    if (this.editor.result.state && id.startsWith('trans:')) {
      return [
        {
          icon: ICONS.arrowLeftRight,
          title: 'Reverse direction',
          onClick: () => this.editor.dispatch({ type: 'st.reverseTransition', transId: id }),
        },
        rename,
        del,
      ]
    }

    if (this.editor.result.classGraph && id.startsWith('class:')) {
      const c = this.editor.result.classGraph.classById.get(id.slice(6))
      if (!c) return []
      const annotations = ['interface', 'abstract', 'service', 'enumeration'] as const
      return [
        {
          icon: ICONS.listPlus,
          title: 'Add member',
          onClick: () => {
            const res = this.editor.dispatch({ type: 'cl.addMember', id: c.id, text: '+attribute' })
            void res
          },
        },
        {
          icon: ICONS.braces,
          title: 'Annotation',
          panel: {
            title: 'Annotation',
            items: [
              ...annotations.map((a) => ({
                glyph: a,
                title: `<<${a}>>`,
                onClick: () => this.editor.dispatch({ type: 'cl.setAnnotation', id: c.id, annotation: a }),
              })),
              {
                glyph: 'none',
                title: 'Remove annotation',
                onClick: () => this.editor.dispatch({ type: 'cl.setAnnotation', id: c.id, annotation: null }),
              },
            ],
          },
        },
        {
          icon: ICONS.stickyNote,
          title: 'Add note',
          onClick: () => this.editor.dispatch({ type: 'cl.addNoteFor', id: c.id }),
        },
        { icon: ICONS.pencil, title: 'Rename class', onClick: () => this.editEntityLabel(id) },
        del,
      ]
    }
    if (this.editor.result.classGraph && id.startsWith('rel:')) {
      const r = this.editor.result.classGraph.relations.find((rr) => rr.entityId === id)
      if (!r) return []
      const kinds: Array<{ op: string; g: string; t: string }> = [
        { op: '<|--', g: '◁—', t: 'inheritance' },
        { op: '*--', g: '◆—', t: 'composition' },
        { op: 'o--', g: '◇—', t: 'aggregation' },
        { op: '-->', g: '—▶', t: 'association' },
        { op: '--', g: '——', t: 'link (solid)' },
        { op: '..>', g: '⋯▶', t: 'dependency' },
        { op: '..|>', g: '⋯▷', t: 'realization' },
        { op: '..', g: '⋯⋯', t: 'link (dashed)' },
      ]
      return [
        {
          icon: ICONS.arrowRight,
          title: 'Relation type',
          panel: {
            title: 'Relation type',
            items: kinds.map((k) => ({
              glyph: k.g,
              title: k.t,
              selected: r.stmt.op === k.op,
              onClick: () =>
                this.editor.dispatch({ type: 'cl.setRelationType', relId: id, op: k.op as never }),
            })),
          },
        },
        {
          icon: ICONS.arrowLeftRight,
          title: 'Reverse direction',
          onClick: () => this.editor.dispatch({ type: 'cl.reverseRelation', relId: id }),
        },
        {
          glyph: '1:1',
          title: 'Cardinality (e.g. 1, 0..1, 1..*, *)',
          onClick: () => {
            const anchor = this.entityElement(id)
            if (!anchor) return
            this.popover.hide()
            const current = `${r.stmt.sourceCard ?? ''}:${r.stmt.targetCard ?? ''}`
            this.openOverlayEditor(anchor, current, (v) => {
              const [src = '', tgt = ''] = v.split(':')
              this.editor.dispatch({ type: 'cl.setCardinality', relId: id, side: 'source', value: src.trim() || null }, 'canvas')
              const again = this.editor.result.classGraph?.relations.find(
                (rr) => rr.lineIndex === r.lineIndex && rr.source === r.source && rr.target === r.target,
              )
              if (again) {
                this.editor.dispatch(
                  { type: 'cl.setCardinality', relId: again.entityId, side: 'target', value: tgt.trim() || null },
                  'canvas',
                )
              }
            })
          },
        },
        rename,
        del,
      ]
    }

    if (this.editor.result.er && id.startsWith('entity:')) {
      const e = this.editor.result.er.entityById.get(id.slice(7))
      if (!e) return []
      return [
        {
          icon: ICONS.listPlus,
          title: 'Add attribute',
          onClick: () => this.editor.dispatch({ type: 'er.addAttribute', id: e.id }),
        },
        { icon: ICONS.pencil, title: 'Rename entity', onClick: () => this.editEntityLabel(id) },
        del,
      ]
    }
    if (this.editor.result.er && id.startsWith('erel:')) {
      const r = this.editor.result.er.relations.find((rr) => rr.entityId === id)
      if (!r) return []
      const cards = [
        { c: 'zero-or-one', g: '0..1' },
        { c: 'exactly-one', g: '1' },
        { c: 'zero-or-more', g: '0..*' },
        { c: 'one-or-more', g: '1..*' },
      ] as const
      const cardPanel = (side: 'left' | 'right'): PopoverAction => ({
        icon: side === 'left' ? ICONS.arrowLeftToLine : ICONS.arrowRightToLine,
        title: `${side === 'left' ? 'Source' : 'Target'} cardinality`,
        panel: {
          title: `${side === 'left' ? r.source : r.target} cardinality`,
          items: cards.map((k) => ({
            glyph: k.g,
            title: k.c,
            onClick: () => this.editor.dispatch({ type: 'er.setCardinality', relId: id, side, card: k.c }),
          })),
        },
      })
      return [
        cardPanel('left'),
        cardPanel('right'),
        {
          icon: r.stmt.line === '--' ? ICONS.minus : ICONS.ellipsis,
          title: r.stmt.line === '--' ? 'Make non-identifying (dashed)' : 'Make identifying (solid)',
          onClick: () => this.editor.dispatch({ type: 'er.setIdentifying', relId: id, identifying: r.stmt.line !== '--' }),
        },
        rename,
        del,
      ]
    }

    if (this.editor.result.pie && id.startsWith('slice:')) {
      const s = this.editor.result.pie.slices.find((sl) => sl.entityId === id)
      if (!s) return []
      return [
        { icon: ICONS.hash, title: 'Edit value', onClick: () => this.editEntityLabel(id) },
        {
          icon: ICONS.pencil,
          title: 'Edit label',
          onClick: () => {
            const anchor = this.entityElement(id)
            if (anchor) {
              this.popover.hide()
              this.openOverlayEditor(anchor, s.label, (v) =>
                this.editor.dispatch({ type: 'pie.setLabel', sliceId: id, label: v }, 'canvas'),
              )
            }
          },
        },
        del,
      ]
    }

    if (this.editor.result.gantt && id.startsWith('task:')) {
      const t = this.editor.result.gantt.tasks.find((tk) => tk.entityId === id)
      if (!t) return []
      return [
        { icon: ICONS.pencil, title: 'Rename task', onClick: () => this.editEntityLabel(id) },
        {
          icon: ICONS.calendar,
          title: 'Edit schedule (id, start, duration)',
          onClick: () => {
            const anchor = this.entityElement(id)
            if (anchor) {
              this.popover.hide()
              this.openOverlayEditor(anchor, t.meta, (v) =>
                this.editor.dispatch({ type: 'gantt.setTaskMeta', taskId: id, meta: v }, 'canvas'),
              )
            }
          },
        },
        del,
      ]
    }

    if (this.editor.result.lineItems && id.startsWith('item:')) {
      return [{ icon: ICONS.pencil, title: 'Edit line', onClick: () => this.editEntityLabel(id) }, del]
    }

    if (sequence && id.startsWith('participant:')) {
      const p = sequence.participantById.get(id.slice(12))
      if (!p) return []
      const glyphs: Record<ParticipantType, string> = {
        participant: '▭',
        actor: '웃',
        boundary: '⊢○',
        control: '◉',
        entity: '◯',
        database: '⛁',
        collections: '⧉',
        queue: '▤',
      }
      return [
        {
          icon: ICONS.user,
          title: 'Participant type',
          panel: {
            title: 'Participant type',
            items: PARTICIPANT_TYPES.map((pt): PopoverPanelItem => ({
              glyph: glyphs[pt],
              title: pt,
              selected: p.ptype === pt,
              onClick: () => this.editor.dispatch({ type: 'seq.setParticipantType', id: p.id, ptype: pt }),
            })),
          },
        },
        { icon: ICONS.pencil, title: 'Rename', onClick: () => this.editEntityLabel(id) },
        del,
      ]
    }

    if (sequence && id.startsWith('event:')) {
      const ev = sequence.events.find((e) => e.entityId === id)
      if (!ev) return []
      if (ev.kind === 'message') {
        const glyphs: Record<MessageOp, string> = {
          '->': '——',
          '->>': '—▶',
          '-->': '⋯⋯',
          '-->>': '⋯▶',
          '-x': '—✕',
          '--x': '⋯✕',
          '-)': '—⟩',
          '--)': '⋯⟩',
        }
        return [
          {
            icon: ICONS.arrowRight,
            title: 'Message type',
            panel: {
              title: 'Message type',
              items: MESSAGE_OPS.map((m): PopoverPanelItem => ({
                glyph: glyphs[m.op],
                title: m.label,
                selected: ev.stmt.op === m.op,
                onClick: () => this.editor.dispatch({ type: 'seq.setMessageOp', eventId: id, op: m.op }),
              })),
            },
          },
          {
            icon: ICONS.arrowLeftRight,
            title: 'Reverse direction',
            onClick: () => this.editor.dispatch({ type: 'seq.reverseMessage', eventId: id }),
          },
          {
            icon: ICONS.group,
            title: 'Wrap in fragment',
            panel: {
              title: 'Fragment',
              items: (['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'] as const).map((kind) => ({
                glyph: kind,
                title: `Wrap in ${kind}`,
                onClick: () => this.editor.dispatch({ type: 'seq.wrapInFragment', eventId: id, kind }),
              })),
            },
          },
          rename,
          del,
        ]
      }
      return [rename, del]
    }

    return []
  }

  // ----- sequence message drag-reorder -----

  private computeDropSlots() {
    const graph = this.editor.result.sequence
    this.dropSlots = []
    if (!graph || !this.seqCorrelation) return
    const boxes = graph.events
      .map((ev) => {
        const el = this.seqCorrelation!.events.get(ev.entityId)
        if (!el) return null
        const b = this.hostRect(el)
        return { ev, y: b.top + b.height / 2 }
      })
      .filter((v): v is { ev: (typeof graph.events)[number]; y: number } => v !== null)
    if (!boxes.length) return
    this.dropSlots.push({ y: boxes[0].y - 24, afterEvent: null })
    for (let i = 1; i < boxes.length; i++) {
      this.dropSlots.push({ y: (boxes[i - 1].y + boxes[i].y) / 2, afterEvent: boxes[i - 1].ev.entityId })
    }
    this.dropSlots.push({ y: boxes[boxes.length - 1].y + 24, afterEvent: boxes[boxes.length - 1].ev.entityId })
  }

  private nearestSlot(y: number): { y: number; afterEvent: string | null } | null {
    let best: { y: number; afterEvent: string | null } | null = null
    let bestDist = Infinity
    for (const slot of this.dropSlots) {
      const d = Math.abs(slot.y - y)
      if (d < bestDist) {
        bestDist = d
        best = slot
      }
    }
    return best
  }

  private showDropIndicator(y: number) {
    if (!this.dropIndicator) {
      this.dropIndicator = document.createElement('div')
      this.dropIndicator.className = 'mw-drop-indicator'
      this.overlayHost.appendChild(this.dropIndicator)
    }
    this.dropIndicator.style.top = `${y}px`
  }

  // ----- sequence lifeline insertion (+ buttons) -----

  private plusHovered = false
  private lifelineClearTimer: ReturnType<typeof setTimeout> | null = null

  private onLifelineHover(e: PointerEvent) {
    if (this.readOnly || !this.seqCorrelation || this.connectSource) return
    const graph = this.editor.result.sequence
    if (!graph) return
    let found: string | null = null
    for (const [entityId, line] of this.seqCorrelation.lifelines) {
      const r = line.getBoundingClientRect()
      const cx = r.left + r.width / 2
      if (Math.abs(e.clientX - cx) <= 16 && e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8) {
        found = entityId
        break
      }
    }
    if (found === this.hoveredLifeline) return
    if (found) this.showLifelinePlus(found)
    else this.scheduleLifelineClear()
  }

  private showLifelinePlus(participantEntity: string) {
    this.clearLifelineUi()
    const graph = this.editor.result.sequence
    const line = this.seqCorrelation?.lifelines.get(participantEntity)
    if (!graph || !line) return
    this.hoveredLifeline = participantEntity
    const participantId = participantEntity.slice(12)
    const lineBox = this.hostRect(line)
    const x = lineBox.left + lineBox.width / 2

    const anchors: Array<{ y: number; afterEvent: string | null }> = []
    const eventBoxes = graph.events
      .map((ev) => {
        const el = this.seqCorrelation?.events.get(ev.entityId)
        if (!el) return null
        const b = this.hostRect(el)
        return { ev, y: b.top + b.height / 2 }
      })
      .filter((v): v is { ev: (typeof graph.events)[number]; y: number } => v !== null)

    if (eventBoxes.length === 0) {
      anchors.push({ y: lineBox.top + lineBox.height / 2, afterEvent: null })
    } else {
      anchors.push({ y: (lineBox.top + eventBoxes[0].y) / 2, afterEvent: null })
      for (let i = 1; i < eventBoxes.length; i++) {
        anchors.push({ y: (eventBoxes[i - 1].y + eventBoxes[i].y) / 2, afterEvent: eventBoxes[i - 1].ev.entityId })
      }
      anchors.push({
        y: (eventBoxes[eventBoxes.length - 1].y + lineBox.top + lineBox.height) / 2,
        afterEvent: eventBoxes[eventBoxes.length - 1].ev.entityId,
      })
    }

    for (const anchor of anchors) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'mw-lifeline-plus'
      btn.textContent = '+'
      btn.title = 'Insert here (self message / note)'
      btn.style.left = `${x}px`
      btn.style.top = `${anchor.y}px`
      btn.addEventListener('pointerenter', () => {
        this.plusHovered = true
      })
      btn.addEventListener('pointerleave', () => {
        this.plusHovered = false
        this.scheduleLifelineClear()
      })
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.openPlusMenu(btn, participantId, anchor.afterEvent)
      })
      this.overlayHost.appendChild(btn)
      this.plusButtons.push(btn)
    }
  }

  private openPlusMenu(button: HTMLElement, participantId: string, afterEvent: string | null) {
    this.plusMenu?.remove()
    const menu = document.createElement('div')
    menu.className = 'mw-plus-menu'
    menu.style.left = button.style.left
    menu.style.top = `${parseFloat(button.style.top) + 12}px`
    menu.addEventListener('pointerdown', (e) => e.stopPropagation())

    const item = (label: string, fn: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.clearLifelineUi()
        fn()
      })
      menu.appendChild(b)
    }
    item('↩ Self message', () => {
      const res = this.editor.dispatch(
        { type: 'seq.addMessage', source: participantId, target: participantId, text: 'message', afterEvent },
        'canvas',
      )
      if (res?.created?.[0]) this.pendingEditEntity = res.created[0]
    })
    const note = (label: string, placement: 'over' | 'left of' | 'right of') =>
      item(label, () => {
        const res = this.editor.dispatch(
          { type: 'seq.addNote', participant: participantId, placement, text: 'note', afterEvent },
          'canvas',
        )
        if (res?.created?.[0]) this.pendingEditEntity = res.created[0]
      })
    note('▭ Note over', 'over')
    note('▭ Note left', 'left of')
    note('▭ Note right', 'right of')

    this.overlayHost.appendChild(menu)
    this.plusMenu = menu
  }

  private scheduleLifelineClear() {
    if (this.lifelineClearTimer) clearTimeout(this.lifelineClearTimer)
    this.lifelineClearTimer = setTimeout(() => {
      if (!this.plusHovered && !this.plusMenu) this.clearLifelineUi()
    }, 400)
  }

  private clearLifelineUi() {
    this.plusButtons.forEach((b) => b.remove())
    this.plusButtons = []
    this.plusMenu?.remove()
    this.plusMenu = null
    this.hoveredLifeline = null
    this.plusHovered = false
  }

  // ----- geometry helpers -----

  private clientToSvg(x: number, y: number): { x: number; y: number } | null {
    if (!this.svg) return null
    const ctm = this.svg.getScreenCTM()
    if (!ctm) return null
    const pt = new DOMPoint(x, y).matrixTransform(ctm.inverse())
    return { x: pt.x, y: pt.y }
  }

  private entityCenter(entityId: string): { x: number; y: number } | null {
    const el = this.entityElement(entityId)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return this.clientToSvg(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  /** Validate code through mermaid.parse and publish diagnostics (does not render). */
  async validate(): Promise<boolean> {
    try {
      await this.mermaid.parse(this.editor.code)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
      this.editor.setDiagnostics([{ message, span: null, severity: 'error', source: 'mermaid' }])
      return false
    }
  }

  destroy() {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    if (this.lifelineClearTimer) clearTimeout(this.lifelineClearTimer)
    if (this.inPlaceSession?.liveTimer) clearTimeout(this.inPlaceSession.liveTimer)
    this.inPlaceSession = null
    this.svgTransformObserver?.disconnect()
    this.svgTransformObserver = null
    this.disposers.forEach((d) => d())
    this.closeInlineEditor(false)
    this.cancelConnect()
    this.clearLifelineUi()
    this.popover.hide()
    this.container.classList.remove('mw-canvas', 'mw-tool-connect', 'mw-readonly', 'mw-panzoom', 'mw-panning')
    this.svgHost.remove()
    this.overlayHost.remove()
    this.errorBadge.remove()
    this.zoomControls?.remove()
  }
}
