import { useEffect, useRef, useState } from 'react'

const PANEL_WIDTH_KEY = 'visimer:playground:panelWidth'
const PANEL_MIN_WIDTH = 340
const PANEL_MAX_RATIO = 0.7

function readStoredPanelWidth(): number | null {
  const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(stored) && stored > 0 ? stored : null
}

/** drag-to-resize for the code panel, persisted across reloads */
export function useResizablePanel() {
  const [width, setWidth] = useState(() => readStoredPanelWidth() ?? Math.round(window.innerWidth * 0.42))
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return
      const { startX, startWidth } = dragState.current
      const max = window.innerWidth * PANEL_MAX_RATIO
      const next = Math.min(max, Math.max(PANEL_MIN_WIDTH, startWidth - (e.clientX - startX)))
      setWidth(next)
    }
    const onUp = () => {
      if (!dragState.current) return
      dragState.current = null
      document.body.classList.remove('resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(width))
  }, [width])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: width }
    document.body.classList.add('resizing')
  }

  return { width, startDrag }
}
