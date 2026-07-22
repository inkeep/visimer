import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, LINE_ITEM_CONFIGS, DIAGRAM_TYPES } from '../src'

describe('line-item types', () => {
  it('covers every registered type that lacks a dedicated graph', () => {
    const dedicated = new Set(['flowchart', 'sequence', 'state', 'class', 'er', 'pie', 'gantt', 'zenuml'])
    for (const t of DIAGRAM_TYPES) {
      if (dedicated.has(t.id)) continue
      expect(LINE_ITEM_CONFIGS[t.id], t.id).toBeTruthy()
      expect(t.capability, t.id).toBe('edit')
    }
  })

  it('journey: items with match text, edit/add/delete ops', () => {
    const code = `journey
  title My day
  section Work
    Make tea: 5: Me
    Do work: 1: Me, Cat
`
    const ed = new MermaidWysiwygEditor({ code })
    const g = ed.result.lineItems!
    expect(g.typeId).toBe('journey')
    expect(g.items.map((i) => i.matchText)).toEqual(['My day', 'Work', 'Make tea', 'Do work'])
    ed.dispatch({ type: 'li.setLine', itemId: g.items[2].entityId, text: 'Brew coffee: 4: Me' })
    expect(ed.code).toContain('    Brew coffee: 4: Me')
    ed.dispatch({ type: 'li.addItem' })
    expect(ed.code).toContain('    New task: 3: Me')
    const g2 = ed.result.lineItems!
    ed.dispatch({ type: 'li.deleteItem', itemId: g2.items[g2.items.length - 1].entityId })
    expect(ed.code).not.toContain('New task')
  })

  it('timeline and mindmap extract sensible labels', () => {
    const tl = new MermaidWysiwygEditor({ code: 'timeline\n  title History\n  2002 : LinkedIn\n       : Google\n' })
    expect(tl.result.lineItems!.items.map((i) => i.matchText)).toEqual(['History', 'LinkedIn', 'Google'])
    const mm = new MermaidWysiwygEditor({ code: 'mindmap\n  root((Center))\n    Ideas\n      [Boxed]\n' })
    expect(mm.result.lineItems!.items.map((i) => i.matchText)).toEqual(['Center', 'Ideas', 'Boxed'])
  })

  it('kanban, packet, c4, gitgraph extraction', () => {
    const kb = new MermaidWysiwygEditor({ code: 'kanban\n  Todo\n    [Write docs]\n    id2[Ship it]\n' })
    expect(kb.result.lineItems!.items.map((i) => i.matchText)).toEqual(['Todo', 'Write docs', 'Ship it'])
    const pk = new MermaidWysiwygEditor({ code: 'packet-beta\n0-15: "Source Port"\n' })
    expect(pk.result.lineItems!.items[0].matchText).toBe('Source Port')
    const c4 = new MermaidWysiwygEditor({ code: 'C4Context\n  Person(a, "Customer", "desc")\n' })
    expect(c4.result.lineItems!.items[0].matchText).toBe('Customer')
    const gg = new MermaidWysiwygEditor({ code: 'gitGraph\n  commit\n  branch develop\n' })
    expect(gg.result.lineItems!.items.map((i) => i.matchText)).toEqual([null, 'develop'])
  })

  it('selection sync and empty-edit deletion', () => {
    const ed = new MermaidWysiwygEditor({ code: 'timeline\n  2002 : LinkedIn\n  2004 : Facebook\n' })
    const g = ed.result.lineItems!
    expect(ed.entityAt(ed.code.indexOf('Facebook'))).toBe(g.items[1].entityId)
    ed.setSelection([g.items[0].entityId])
    expect(ed.selectionSpans()).toHaveLength(1)
    ed.dispatch({ type: 'li.setLine', itemId: g.items[0].entityId, text: '' })
    expect(ed.code).toBe('timeline\n  2004 : Facebook\n')
  })
})
