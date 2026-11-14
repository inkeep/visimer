// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor } from '@visimer/core'
import { mermaidAdapter, peleAdapter, type PeleLike } from '../src/renderer'
import { MermaidCanvasView, type MermaidLike, type RendererAdapter } from '../src'

// jsdom has no CSS.escape (browsers do)
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  ;(globalThis as { CSS?: { escape(s: string): string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  }
}

// jsdom has no canvas: pele probes for one to measure text, and jsdom's
// getContext raises a noisy "not implemented" error. Return null so pele falls
// back to its built-in metrics table (the assertions here are structural, not
// pixel-precise).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

describe('mermaidAdapter', () => {
  it('initializes at creation and before every render', async () => {
    const calls: string[] = []
    const mermaid: MermaidLike = {
      initialize() {
        calls.push('initialize')
      },
      async render(id) {
        calls.push(`render:${id}`)
        return { svg: '<svg></svg>' }
      },
      async parse() {
        return null
      },
    }

    const adapter = mermaidAdapter(mermaid, { theme: 'dark' })
    expect(calls).toEqual(['initialize'])

    await adapter.render('flowchart TD\n  A --> B')
    await adapter.render('flowchart TD\n  A --> B')

    expect(calls.filter((c) => c.startsWith('render'))).toHaveLength(2)
    calls.forEach((call, i) => {
      if (call.startsWith('render')) expect(calls[i - 1]).toBe('initialize')
    })
  })

  it('removes the temp error elements mermaid leaves behind when render throws', async () => {
    const mermaid: MermaidLike = {
      initialize() {},
      async render(id) {
        const doomed = document.createElement('div')
        doomed.id = `d${id}`
        document.body.appendChild(doomed)
        const named = document.createElement('div')
        named.id = id
        document.body.appendChild(named)
        throw new Error('boom')
      },
      async parse() {
        return null
      },
    }

    const adapter = mermaidAdapter(mermaid)
    await expect(adapter.render('bad')).rejects.toThrow('boom')
    expect(document.querySelectorAll('[id^="mw-render"], [id^="dmw-render"]')).toHaveLength(0)
  })

  it('validate resolves null on parse success and the first error line on throw', async () => {
    const ok: MermaidLike = {
      initialize() {},
      async render() {
        return { svg: '' }
      },
      async parse() {
        return true
      },
    }
    expect(await mermaidAdapter(ok).validate?.('flowchart TD')).toBeNull()

    const bad: MermaidLike = {
      initialize() {},
      async render() {
        return { svg: '' }
      },
      async parse() {
        throw new Error('Parse error on line 3:\nexpecting FOO')
      },
    }
    expect(await mermaidAdapter(bad).validate?.('nope')).toEqual({ message: 'Parse error on line 3:' })
  })
})

describe('peleAdapter', () => {
  it('wraps pele synchronous render in a promise', async () => {
    const pele: PeleLike = { render: (src) => ({ svg: `<svg class="pele">${src}</svg>` }) }
    const { svg } = await peleAdapter(pele).render('x')
    expect(svg).toContain('pele')
    expect(svg).toContain('x')
  })

  it('validate maps a pele error and is absent without parse', async () => {
    const error = Object.assign(new Error('Parse error on line 2:\nunexpected token'), {
      type: 'flowchart',
      line: 2,
      column: 13,
    })
    const pele: PeleLike = {
      render: () => ({ svg: '' }),
      parse: () => {
        throw error
      },
    }
    const { message } = (await peleAdapter(pele).validate?.('flowchart LR\n  A --')) ?? {}
    expect(message).toEqual(expect.stringContaining('flowchart error: Parse error on line 2:'))
    expect(message).toEqual(expect.stringContaining('(line 2, column 13)'))

    const noParse: PeleLike = { render: () => ({ svg: '' }) }
    expect(peleAdapter(noParse).validate).toBeUndefined()
  })

  it('renders a real flowchart through pele', async () => {
    const peleLike: PeleLike = { render: (src, options) => peleRender(src, options) }
    const { svg } = await peleAdapter(peleLike).render('flowchart LR\n  A --> B')
    expect(svg).toContain('class="pele-node')
    expect(svg).toContain('data-id="A"')
  })
})

/** drain microtasks and the macrotask queue so renders in flight land */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('MermaidCanvasView renderer seam', () => {
  const CODE = 'flowchart LR\n  A --> B\n'

  let container: HTMLElement
  let views: MermaidCanvasView[]
  let warnSpy: MockInstance

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    views = []
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const view of views) view.destroy()
    container.remove()
    warnSpy.mockRestore()
  })

  it('renders through a custom renderer adapter', async () => {
    const renderer: RendererAdapter = {
      id: 'pele',
      async render(code) {
        return { svg: `<svg class="pele">${code}</svg>` }
      },
    }
    const editor = new MermaidWysiwygEditor({ code: CODE })
    let resolveRender!: () => void
    const rendered = new Promise<void>((r) => (resolveRender = r))
    const view = new MermaidCanvasView({ editor, container, renderer, debounceMs: 0 })
    views.push(view)
    view.on('render', () => resolveRender())
    await rendered

    const host = container.querySelector('.mw-svg-host')!
    const svg = host.querySelector('svg.pele')
    expect(svg).toBeTruthy()
    expect(svg?.textContent).toContain('flowchart LR')
  })

  it('requires exactly one of mermaid or renderer', () => {
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const mermaid: MermaidLike = {
      initialize() {},
      async render() {
        return { svg: '<svg></svg>' }
      },
      async parse() {
        return true
      },
    }
    const renderer: RendererAdapter = {
      id: 'pele',
      async render() {
        return { svg: '<svg></svg>' }
      },
    }
    expect(() => new MermaidCanvasView({ editor, container })).toThrow(
      'MermaidCanvasView: pass exactly one of `mermaid` or `renderer`',
    )
    expect(() => new MermaidCanvasView({ editor, container, mermaid, renderer })).toThrow(
      'MermaidCanvasView: pass exactly one of `mermaid` or `renderer`',
    )
  })

  it('keeps the mermaid initialize-then-render call order', async () => {
    const calls: string[] = []
    const mermaid: MermaidLike = {
      initialize() {
        calls.push('initialize')
      },
      async render(id) {
        calls.push(`render:${id}`)
        return { svg: '<svg></svg>' }
      },
      async parse() {
        return true
      },
    }
    const editor = new MermaidWysiwygEditor({ code: '' })
    const view = new MermaidCanvasView({ editor, container, mermaid, debounceMs: 0 })
    views.push(view)
    await flush()
    // the adapter initializes once at creation; the empty document renders nothing
    expect(calls).toEqual(['initialize'])

    editor.setCode('flowchart LR\n  A --> B\n  A --> C\n', 'external')
    await flush()

    const renderIdx = calls.findIndex((c) => c.startsWith('render:'))
    expect(renderIdx).toBeGreaterThan(-1)
    expect(calls[renderIdx - 1]).toBe('initialize')
    expect(calls.filter((c) => c === 'initialize')).toHaveLength(2)
  })

  it('labels render-error diagnostics with the adapter id', async () => {
    const renderer: RendererAdapter = {
      id: 'pele',
      async render() {
        throw new Error('pele exploded')
      },
    }
    const editor = new MermaidWysiwygEditor({ code: CODE })
    let settle!: (p: { ok: boolean; error?: string }) => void
    const outcome = new Promise<{ ok: boolean; error?: string }>((r) => (settle = r))
    const view = new MermaidCanvasView({ editor, container, renderer, debounceMs: 0 })
    views.push(view)
    view.on('render', (p) => settle(p))
    const payload = await outcome

    expect(payload.ok).toBe(false)
    expect(view.renderError).toBe('pele exploded')
    const diag = editor.diagnostics.find((d) => d.source === 'pele')
    expect(diag?.message).toBe('pele exploded')
  })

  it('setMermaidConfig warns once and does not re-render under a custom renderer', async () => {
    let renders = 0
    const renderer: RendererAdapter = {
      id: 'pele',
      async render() {
        renders++
        return { svg: '<svg></svg>' }
      },
    }
    const editor = new MermaidWysiwygEditor({ code: CODE })
    const view = new MermaidCanvasView({ editor, container, renderer, debounceMs: 0 })
    views.push(view)
    await flush()
    const rendersBefore = renders
    const errorBefore = view.renderError

    view.setMermaidConfig({ theme: 'dark' })
    await flush()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(renders).toBe(rendersBefore)
    expect(view.renderError).toBe(errorBefore)

    view.setMermaidConfig({ theme: 'forest' })
    await flush()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('setMermaidConfig warns instead of crashing when the mermaid adapter was built by the caller', async () => {
    let renders = 0
    const mermaid: MermaidLike = {
      initialize() {},
      async render() {
        renders++
        return { svg: '<svg></svg>' }
      },
      async parse() {
        return true
      },
    }
    const editor = new MermaidWysiwygEditor({ code: CODE })
    // the JSDoc's own first example: caller-built mermaidAdapter, no `mermaid`
    const view = new MermaidCanvasView({
      editor,
      container,
      renderer: mermaidAdapter(mermaid),
      debounceMs: 0,
    })
    views.push(view)
    await flush()
    const rendersBefore = renders

    expect(() => view.setMermaidConfig({ theme: 'dark' })).not.toThrow()
    await flush()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(renders).toBe(rendersBefore)
  })
})
