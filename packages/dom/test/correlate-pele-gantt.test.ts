// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render as peleRender } from 'pele'
import { MermaidWysiwygEditor, type GanttGraph } from '@visimer/core'
import { correlatePeleGantt } from '../src/correlate.pele.gantt'
import { MermaidCanvasView, peleAdapter } from '../src'

// jsdom has no canvas: pele probes for one to measure text, and jsdom's
// getContext raises a noisy "not implemented" error. Return null so pele falls
// back to its built-in metrics table (the assertions here are structural, not
// pixel-precise).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const hosts: HTMLElement[] = []

const SAMPLE = `gantt
  dateFormat YYYY-MM-DD
  section Design
  Spec: a1, 2026-01-01, 10d
  Review: milestone, 2026-01-15, 0d
  section Build
  Code: 2026-01-16, 20d
`

/** render a code string with real pele, correlate it against core's gantt graph */
function correlate(code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const graph = editor.result.gantt
  if (!graph) throw new Error('code did not parse as a gantt chart')
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = peleRender(code).svg
  const svg = host.querySelector('svg')!
  return { svg, graph, result: correlatePeleGantt(svg, graph) }
}

/** mount code through the full view with a pele adapter */
async function mountWithView(container: HTMLElement, code: string) {
  const editor = new MermaidWysiwygEditor({ code })
  const view = new MermaidCanvasView({
    editor,
    container,
    renderer: peleAdapter({ render: (src, opts) => peleRender(src, opts) }),
    debounceMs: 0,
  })
  // drain microtasks and the macrotask queue so the render lands
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  return { editor, view }
}

/** minimal GanttGraph for synthetic-DOM tests */
function fakeGraph(taskCount: number): GanttGraph {
  return {
    headerLine: 0,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      entityId: `task:${i + 1}`,
      name: `T${i + 1}`,
      meta: '1d',
      lineIndex: i + 1,
      nameSpan: { start: 0, end: 2 },
      metaSpan: { start: 3, end: 5 },
      section: null,
    })),
    sections: [],
    lastContentLine: taskCount,
  } as unknown as GanttGraph
}

function syntheticSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  host.innerHTML = `<svg>${markup}</svg>`
  return host.querySelector('svg')!
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove()
})

describe('correlatePeleGantt', () => {
  it('order-zips core tasks onto g.pele-task groups', () => {
    const { result, svg, graph } = correlate(SAMPLE)

    // core models Spec, Review (milestone) and Code as `task:<lineIndex>`
    // entities in document order; pele renders one g.pele-task per task in
    // the same order (milestones included)
    expect(graph.tasks.map((t) => t.entityId)).toEqual(['task:3', 'task:4', 'task:6'])
    const taskEls = [...svg.querySelectorAll<SVGGElement>('g.pele-task')]
    expect(taskEls).toHaveLength(graph.tasks.length)
    graph.tasks.forEach((task, i) => {
      const el = result.nodes.get(task.entityId)!
      expect(el).toBeTruthy()
      expect(el).toBe(taskEls[i])
      expect(el.classList.contains('pele-task')).toBe(true)
      expect(el.getAttribute('data-mw-entity')).toBe(task.entityId)
    })
    // the milestone task correlates same as any other task
    const milestone = result.nodes.get('task:4')!
    expect(milestone.classList.contains('pele-milestone')).toBe(true)
    expect(result.failed).toEqual([])
    expect(result.edges.size).toBe(0)
    expect(result.edgeLabels.size).toBe(0)
  })

  it('never tags scenery: sections, section labels and gridlines', () => {
    const { result, svg } = correlate(SAMPLE)
    expect(result.nodes.size).toBe(3)
    // pele draws section bands, their labels and the grid as scenery — core
    // does not model sections as entities, so none of it is ever tagged
    for (const el of svg.querySelectorAll(
      'rect.pele-section, text.pele-section-label, g.pele-grid, g.pele-grid *',
    )) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('degrades every task when pele drops one (count mismatch)', () => {
    // core has three tasks, pele rendered two groups (e.g. pele skipped a
    // task) — a zip would shift every later pairing, so ALL tasks degrade to
    // view-only instead of mis-correlating
    const svg = syntheticSvg(
      '<g class="pele-tasks">' +
        '<g class="pele-task" data-id="a1"></g>' +
        '<g class="pele-task" data-id="task1"></g>' +
        '</g>',
    )
    const result = correlatePeleGantt(svg, fakeGraph(3))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['task:1', 'task:2', 'task:3'])
    for (const el of svg.querySelectorAll('g.pele-task')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('degrades every task when pele renders more groups than core tasks', () => {
    const svg = syntheticSvg(
      '<g class="pele-tasks">' +
        '<g class="pele-task" data-id="a1"></g>' +
        '<g class="pele-task" data-id="a2"></g>' +
        '</g>',
    )
    const result = correlatePeleGantt(svg, fakeGraph(1))
    expect(result.nodes.size).toBe(0)
    expect(result.failed).toEqual(['task:1'])
    for (const el of svg.querySelectorAll('g.pele-task')) {
      expect(el.hasAttribute('data-mw-entity')).toBe(false)
    }
  })

  it('class-filters the sweep: non-task lookalikes are never claimed', () => {
    // a milestone variant plus a stray non-task element that carries a
    // pele-task-looking data-id — only g.pele-task groups participate
    const svg = syntheticSvg(
      '<g class="pele-grid"><g data-id="a1"></g></g>' +
        '<g class="pele-tasks"><g class="pele-task pele-milestone" data-id="a1"></g></g>',
    )
    const result = correlatePeleGantt(svg, fakeGraph(1))
    expect(result.nodes.get('task:1')).toBe(svg.querySelector('g.pele-task'))
    expect(result.failed).toEqual([])
  })

  // Step 5 style spot-check: task status flags land as classes on the
  // g.pele-task group itself (verified against pele@1.13.0) — a status edit
  // must round-trip visibly as a class change, and the styled task must still
  // correlate after the re-render.
  it('round-trips a task status op visibly and keeps the task correlated', () => {
    const { result, svg } = correlate(`gantt
  dateFormat YYYY-MM-DD
  section S
  A: done, a1, 2026-01-01, 5d
  B: active, 2026-01-02, 5d
  C: crit, 2026-01-03, 5d
`)
    expect(result.nodes.size).toBe(3)
    expect(result.nodes.get('task:3')!.classList.contains('pele-done')).toBe(true)
    expect(result.nodes.get('task:4')!.classList.contains('pele-active')).toBe(true)
    expect(result.nodes.get('task:5')!.classList.contains('pele-crit')).toBe(true)
    // every styled task group is still tagged with its entity id
    for (const el of svg.querySelectorAll('g.pele-task')) {
      expect(el.getAttribute('data-mw-entity')).toBeTruthy()
    }
  })
})

describe('view dispatch', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('dispatches gantt charts through the pele correlator', async () => {
    const { view } = await mountWithView(container, SAMPLE)
    expect(container.querySelector('svg')).toBeTruthy()
    const taskEls = container.querySelectorAll('g.pele-task[data-mw-entity]')
    expect(taskEls.length).toBeGreaterThan(0)
    expect(container.querySelector('[data-mw-entity="task:3"]')).toBeTruthy()
    expect(container.querySelector('[data-mw-entity="task:6"]')).toBeTruthy()
    // scenery stays untagged through the full view too
    expect(container.querySelector('rect.pele-section[data-mw-entity]')).toBeNull()
    expect(container.querySelector('g.pele-grid[data-mw-entity]')).toBeNull()
    view.destroy()
  })
})
