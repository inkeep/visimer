import type { GanttGraph } from '@visimer/core'
import type { Correlation } from './correlate'

/**
 * Correlate pele's rendered gantt SVG with the semantic graph.
 * Strategy: count-checked order zip only. pele renders one `g.pele-task` per
 * task in document order (core's tasks array order) — milestones and status
 * variants included. Core has no source ids (entities are `task:<lineIndex>`),
 * and pele's `data-id` holds the task's mermaid source id when given or a
 * generated `taskN` otherwise — so `data-id` is NOT a match key here, unlike
 * the other pele correlators. A count disagreement means the zip could shift
 * pairings — degrade every task rather than risk mis-zipping. Sections (bands
 * and labels) and the grid are scenery core does not model — never tagged,
 * matching mermaid's correlateGantt.
 */
export function correlatePeleGantt(svg: SVGSVGElement, graph: GanttGraph): Correlation {
  const nodes = new Map<string, SVGGElement>()
  const edges = new Map<string, SVGElement>()
  const edgeLabels = new Map<string, SVGGElement>()
  const failed: string[] = []

  // class-filtered sweep: only g.pele-task groups participate (the grid is
  // its own g.pele-grid group and can never be claimed)
  const taskEls = [...svg.querySelectorAll<SVGGElement>('g.pele-task')]
  if (taskEls.length === graph.tasks.length) {
    graph.tasks.forEach((t, i) => {
      nodes.set(t.entityId, taskEls[i])
      taskEls[i].setAttribute('data-mw-entity', t.entityId)
    })
  } else {
    for (const t of graph.tasks) failed.push(t.entityId)
  }
  return { nodes, edges, edgeLabels, failed }
}
