import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'
import { MermaidCodeMirror } from '@visimer/codemirror'
import { MermaidWysiwygEditor } from '@visimer/core'
import { MermaidCanvasView } from '@visimer/dom'

// Deterministic RAF-driven demo of visimer's click-to-edit + drag-to-connect
// UX. Rather than driving the real inline-editor and connect gesture through
// synthesized DOM events (which stall mermaid re-renders under wall-clock),
// this fires the same editor ops the playground fires and paints a cursor +
// ghost line on top for the drag visual. The end state (source + diagram)
// is identical to what a real user drives.

const CYCLE_MS = 10500
const INITIAL = `flowchart LR
    A[Idea] --> B[Draft]
    B --> C[Ship it]`
const NEW_LABEL = 'Review'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export default function HeroLoopPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const codePaneRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const canvas = containerRef.current
    const codePane = codePaneRef.current
    const cursor = cursorRef.current
    const ghost = ghostRef.current
    if (!canvas || !codePane || !cursor || !ghost) return

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        fontFamily: '"Inter", sans-serif',
        primaryColor: '#EAF3F0',
        primaryBorderColor: '#0E7C6B',
        primaryTextColor: '#1C1A17',
        lineColor: '#8A9B96',
        secondaryColor: '#F5E9C9',
        secondaryBorderColor: '#C9A227',
      },
    })

    const editor = new MermaidWysiwygEditor({ code: INITIAL })
    const view = new MermaidCanvasView({
      editor,
      container: canvas,
      mermaid,
      panZoom: false,
      accentColor: '#0E7C6B',
      debounceMs: 0,
      mermaidConfig: {
        theme: 'base',
        themeVariables: {
          fontFamily: '"Inter", sans-serif',
          primaryColor: '#EAF3F0',
          primaryBorderColor: '#0E7C6B',
          primaryTextColor: '#1C1A17',
          lineColor: '#8A9B96',
          secondaryColor: '#F5E9C9',
          secondaryBorderColor: '#C9A227',
        },
      },
    })
    const cm = new MermaidCodeMirror(codePane, editor)

    const findNode = (id: 'A' | 'B' | 'C'): SVGGElement | null =>
      canvas.querySelector(`.mw-svg-host svg g.node[id*="-${id}-"]`)

    const nodeCenterInCanvas = (id: 'A' | 'B' | 'C'): { x: number; y: number } | null => {
      const n = findNode(id)
      if (!n) return null
      const r = n.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top }
    }

    // Phase timeline (ms into cycle):
    //   0..400      idle
    //   400..1200   cursor lands on B
    //  1200..2100   settle on B
    //  2100..3300   type "Review" progressively (label swap sequence)
    //  3300..4600   settled Review state
    //  4600..5500   cursor traverses B -> A
    //  5500..6000   sits on A
    //  6000..7200   ghost line drags from A toward C
    //  7200..8900   connect committed, diagram reflows
    //  8900..9500   reset to Draft
    //  9500..10500  idle

    let committedLabel: string | null = null
    let committedConnected = false

    // Any dispatch that would auto-select a new entity (renameNode, connect)
    // triggers visimer's own popover chip. This animation shows the raw editor
    // behavior, not the selection UI, so we clear right after each write.
    const clearSel = () => editor.setSelection([], 'api' as never)

    const commitLabel = (chars: number) => {
      const target = chars === 0 ? '' : NEW_LABEL.slice(0, chars)
      const desired = target || 'Draft'
      if (committedLabel === desired) return
      committedLabel = desired
      editor.dispatch({ type: 'renameNode', id: 'B', label: desired } as never, 'api')
      clearSel()
    }

    const commitConnect = () => {
      if (committedConnected) return
      committedConnected = true
      editor.dispatch({ type: 'connect', source: 'A', target: 'C' } as never, 'api')
      clearSel()
    }

    const reset = () => {
      if (committedLabel === 'Draft' && !committedConnected) return
      committedLabel = 'Draft'
      committedConnected = false
      editor.setCode(INITIAL, 'api')
      clearSel()
    }

    const startPos = { x: 20, y: 20 }

    let raf = 0
    const tick = () => {
      const e = performance.now() % CYCLE_MS

      // Model side: what's committed at this time.
      // Note: commitConnect fires at 7200 — the same instant the ghost line
      // hides — so viewers never see the phantom drag and the real edge on
      // screen at the same time.
      if (e >= 9000) {
        reset()
      } else if (e >= 7200) {
        commitConnect()
      } else if (e >= 3300) {
        commitLabel(NEW_LABEL.length)
      } else if (e >= 2100) {
        const chars = Math.min(NEW_LABEL.length, Math.floor((e - 2100) / (1200 / NEW_LABEL.length)))
        commitLabel(chars)
      } else {
        commitLabel(0)
      }

      // Visual overlays: cursor + ghost line during drag
      const A = nodeCenterInCanvas('A')
      const B = nodeCenterInCanvas('B')
      const C = nodeCenterInCanvas('C')

      let cx = -100
      let cy = -100
      let cOpacity = 0

      if (e < 400) {
        cx = startPos.x
        cy = startPos.y
        cOpacity = 0
      } else if (e < 1200) {
        if (B) {
          const t = Math.min(1, (e - 400) / 700)
          cx = lerp(startPos.x, B.x, easeInOut(t))
          cy = lerp(startPos.y, B.y, easeInOut(t))
          cOpacity = Math.min(1, (e - 300) / 200)
        }
      } else if (e < 4600) {
        if (B) {
          cx = B.x
          cy = B.y
          cOpacity = 1
        }
      } else if (e < 5500) {
        if (B && A) {
          const t = Math.min(1, (e - 4600) / 900)
          cx = lerp(B.x, A.x, easeInOut(t))
          cy = lerp(B.y, A.y, easeInOut(t))
          cOpacity = 1
        }
      } else if (e < 6000) {
        if (A) {
          cx = A.x
          cy = A.y
          cOpacity = 1
        }
      } else if (e < 7200) {
        if (A && C) {
          const t = Math.min(1, (e - 6000) / 1200)
          cx = lerp(A.x, C.x, easeInOut(t))
          cy = lerp(A.y, C.y, easeInOut(t))
          cOpacity = 1
        }
      } else if (e < 8900) {
        if (C) {
          cx = C.x
          cy = C.y
          cOpacity = 1
        }
      } else if (e < 9500) {
        if (C) {
          cx = C.x
          cy = C.y
          cOpacity = Math.max(0, 1 - (e - 8900) / 600)
        }
      }

      cursor.style.transform = `translate(${cx - 4}px, ${cy - 2}px)`
      cursor.style.opacity = String(cOpacity)

      // Ghost line: A -> cursor during drag (e = 6000..7200)
      if (e >= 6000 && e < 7200 && A) {
        ghost.style.display = 'block'
        const t = Math.min(1, (e - 6000) / 1200)
        const gx = lerp(A.x, C?.x ?? A.x + 200, easeInOut(t))
        const gy = lerp(A.y, C?.y ?? A.y, easeInOut(t))
        const line = ghost.querySelector('line')
        if (line) {
          line.setAttribute('x1', String(A.x))
          line.setAttribute('y1', String(A.y))
          line.setAttribute('x2', String(gx))
          line.setAttribute('y2', String(gy))
        }
      } else {
        ghost.style.display = 'none'
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      cm.destroy()
      view.destroy()
    }
  }, [])

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: 'transparent',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}
    >
      <div
        id="hero-loop"
        style={{
          width: 960,
          height: 540,
          background: '#FCFAF5',
          borderRadius: 16,
          border: '1px solid #E6E0D4',
          boxShadow: '0 30px 70px -30px rgba(28,26,23,0.28)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px',
            borderBottom: '1px solid #E6E0D4',
            background: '#FFFFFF',
            flex: 'none',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#F58077' }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#E9C46A' }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, background: '#8BC49A' }} />
          <span
            style={{
              marginLeft: 12,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: '#8A857A',
            }}
          >
            diagram.mmd
          </span>
        </div>
        {/* Vertically center the mermaid SVG (default is flex-start / top) so
             the tiny 3-node flowchart doesn't stick to the top edge. */}
        <style>{`#hero-loop .mw-canvas .mw-svg-host { align-items: center; }`}</style>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            ref={codePaneRef}
            className="demo-cm"
            style={{
              width: 250,
              flex: 'none',
              borderRight: '1px solid #E6E0D4',
              background: '#FCFAF5',
              overflow: 'hidden',
            }}
          />
          <div
            ref={containerRef}
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              background: 'radial-gradient(#efeadf 1px, transparent 1px) 0 0 / 20px 20px',
            }}
          >
            <svg
              ref={ghostRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 8,
                display: 'none',
              }}
            >
              <line stroke="#0E7C6B" strokeWidth="2" strokeDasharray="6 4" />
            </svg>
            <div
              ref={cursorRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 22,
                height: 22,
                pointerEvents: 'none',
                zIndex: 10,
                transition: 'opacity 120ms linear',
                opacity: 0,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path
                  d="M4 3 L18 11 L11.5 12.5 L14 18 L11 19 L8.5 13.5 L4 17 Z"
                  fill="#1C1A17"
                  stroke="#F7F4ED"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
