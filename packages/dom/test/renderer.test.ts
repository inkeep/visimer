// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { mermaidAdapter, peleAdapter, type PeleLike } from '../src/renderer'
import type { MermaidLike } from '../src'

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
