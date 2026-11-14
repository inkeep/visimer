import type { MermaidLike } from './view'

/**
 * A renderer behind a uniform seam, so the canvas can drive Mermaid or Pele
 * without knowing which one is mounted.
 */
export interface RendererAdapter {
  readonly id: 'mermaid' | 'pele'
  render(code: string): Promise<{ svg: string }>
  validate?(code: string): Promise<{ message: string } | null>
}

/**
 * Structural view of Pele's `render`/`parse`. Method syntax keeps parameter
 * checking bivariant, so the real `pele` module — whose `render` accepts a
 * wider source union and its own options type — is assignable without this
 * package importing pele.
 */
export interface PeleLike {
  render(source: string, options?: Record<string, unknown>): { svg: string }
  parse?(text: string): unknown
}

/** global counter so concurrent adapters never collide on mermaid's DOM ids */
let renderIdCounter = 0

function firstLine(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0] : String(err)
}

/**
 * Drive Mermaid through the adapter seam. Mermaid keeps a module-global
 * config, so `initialize` is re-asserted before every render rather than
 * trusted from creation time (a second adapter on the page overwrites it).
 */
export function mermaidAdapter(mermaid: MermaidLike, config?: Record<string, unknown>): RendererAdapter {
  const initConfig = config ?? {}
  mermaid.initialize(initConfig)
  return {
    id: 'mermaid',
    async render(code) {
      const id = `mw-render-${++renderIdCounter}`
      mermaid.initialize(initConfig)
      try {
        const { svg } = await mermaid.render(id, code)
        return { svg }
      } catch (err) {
        // mermaid can leave a temp error element behind
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
        throw err
      }
    },
    async validate(code) {
      try {
        await mermaid.parse(code)
        return null
      } catch (err) {
        return { message: firstLine(err) }
      }
    },
  }
}

/**
 * Drive Pele through the same seam. Pele renders synchronously; the adapter
 * lifts the result into a promise. `validate` is only offered when the
 * underlying module exposes `parse`.
 */
export function peleAdapter(pele: PeleLike, options?: Record<string, unknown>): RendererAdapter {
  const { parse } = pele
  const validate = parse
    ? async (code: string): Promise<{ message: string } | null> => {
        try {
          parse(code)
          return null
        } catch (err) {
          const info = err as { message?: string; type?: string; line?: number; column?: number }
          const location = info.line ? ` (line ${info.line}, column ${info.column})` : ''
          return { message: `${info.type ?? 'pele'} error: ${firstLine(err)}${location}` }
        }
      }
    : undefined
  return {
    id: 'pele',
    async render(code) {
      return { svg: pele.render(code, options).svg }
    },
    ...(validate ? { validate } : {}),
  }
}
