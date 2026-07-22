import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse } from '../src'

const ER = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER {
    string name
    string custNumber PK
  }
`

describe('er parsing', () => {
  it('parses relations with cardinalities and attribute blocks', () => {
    const r = parse(ER)
    expect(r.typeInfo?.id).toBe('er')
    const g = r.er!
    expect(g.entities.map((e) => e.id).sort()).toEqual(['CUSTOMER', 'LINE-ITEM', 'ORDER'])
    expect(g.relations).toHaveLength(2)
    expect(g.relations[0].stmt.leftCard).toBe('||')
    expect(g.relations[0].stmt.rightCard).toBe('o{')
    expect(g.relations[0].label).toBe('places')
    expect(g.entityById.get('CUSTOMER')!.attributes.map((a) => a.text)).toEqual(['string name', 'string custNumber PK'])
  })
})

describe('pie', () => {
  it('parses slices and compiles value/label/add/delete ops', () => {
    const code = `pie showData
  title Pets
  "Dogs" : 42
  "Cats" : 15
`
    const ed = new MermaidWysiwygEditor({ code })
    expect(ed.result.typeInfo?.id).toBe('pie')
    const g = ed.result.pie!
    expect(g.showData).toBe(true)
    expect(g.slices.map((s) => `${s.label}=${s.value}`)).toEqual(['Dogs=42', 'Cats=15'])
    ed.dispatch({ type: 'pie.setValue', sliceId: g.slices[0].entityId, value: 50 })
    expect(ed.code).toContain('"Dogs" : 50')
    const g2 = ed.result.pie!
    ed.dispatch({ type: 'pie.setLabel', sliceId: g2.slices[1].entityId, label: 'Felines' })
    expect(ed.code).toContain('"Felines" : 15')
    ed.dispatch({ type: 'pie.addSlice', label: 'Birds', value: 7 })
    expect(ed.code).toContain('"Birds" : 7')
    const g3 = ed.result.pie!
    ed.dispatch({ type: 'pie.deleteSlice', sliceId: g3.slices[2].entityId })
    expect(ed.code).not.toContain('Birds')
  })
})

describe('gantt', () => {
  it('parses tasks/sections and compiles rename/meta/add/delete ops', () => {
    const code = `gantt
  title Plan
  dateFormat YYYY-MM-DD
  section Build
    Design :d1, 2026-01-01, 5d
    Implement :after d1, 10d
  section Ship
    Release :2026-01-20, 2d
`
    const ed = new MermaidWysiwygEditor({ code })
    expect(ed.result.typeInfo?.id).toBe('gantt')
    const g = ed.result.gantt!
    expect(g.tasks.map((t) => `${t.section}/${t.name}`)).toEqual(['Build/Design', 'Build/Implement', 'Ship/Release'])
    expect(g.tasks[0].meta).toBe('d1, 2026-01-01, 5d')
    ed.dispatch({ type: 'gantt.setTaskName', taskId: g.tasks[0].entityId, name: 'Design spec' })
    expect(ed.code).toContain('Design spec :d1, 2026-01-01, 5d')
    const g2 = ed.result.gantt!
    ed.dispatch({ type: 'gantt.setTaskMeta', taskId: g2.tasks[2].entityId, meta: '2026-01-22, 3d' })
    expect(ed.code).toContain('Release : 2026-01-22, 3d')
    ed.dispatch({ type: 'gantt.addTask', section: 'Build', name: 'Review', meta: '2d' })
    expect(ed.code).toContain('Implement :after d1, 10d\n    Review :2d')
    const g3 = ed.result.gantt!
    ed.dispatch({ type: 'gantt.deleteTask', taskId: g3.tasks[0].entityId })
    expect(ed.code).not.toContain('Design spec')
  })
})

describe('er ops', () => {
  it('addEntity, connect, addAttribute', () => {
    const ed = new MermaidWysiwygEditor({ code: ER })
    const res = ed.dispatch({ type: 'er.addEntity' })
    expect(res?.created).toEqual(['entity:ENTITY1'])
    expect(ed.code).toContain('  ENTITY1 {\n    string id\n  }')
    ed.dispatch({ type: 'er.connect', source: 'ORDER', target: 'ENTITY1' })
    expect(ed.code).toContain('ORDER ||--o{ ENTITY1 : relates')
    ed.dispatch({ type: 'er.addAttribute', id: 'ORDER', text: 'int orderNumber' })
    expect(ed.code).toContain('ORDER {\n    int orderNumber\n  }')
  })

  it('setCardinality and setIdentifying rewrite glyphs in place', () => {
    const ed = new MermaidWysiwygEditor({ code: ER })
    const rel = ed.result.er!.relations[0]
    ed.dispatch({ type: 'er.setCardinality', relId: rel.entityId, side: 'left', card: 'zero-or-more' })
    expect(ed.code).toContain('CUSTOMER }o--o{ ORDER : places')
    const rel2 = ed.result.er!.relations[0]
    ed.dispatch({ type: 'er.setIdentifying', relId: rel2.entityId, identifying: false })
    expect(ed.code).toContain('CUSTOMER }o..o{ ORDER : places')
  })

  it('setAttributeText rewrites or deletes an attribute row', () => {
    const ed = new MermaidWysiwygEditor({ code: ER })
    const cust = ed.result.er!.entityById.get('CUSTOMER')!
    ed.dispatch({ type: 'er.setAttributeText', id: 'CUSTOMER', attrLine: cust.attributes[1].lineIndex, text: 'int custNumber PK "unique"' })
    expect(ed.code).toContain('    int custNumber PK "unique"')
    const cust2 = ed.result.er!.entityById.get('CUSTOMER')!
    ed.dispatch({ type: 'er.setAttributeText', id: 'CUSTOMER', attrLine: cust2.attributes[0].lineIndex, text: '' })
    expect(ed.code).not.toContain('string name')
  })

  it('renameEntity rewrites decl and relations', () => {
    const ed = new MermaidWysiwygEditor({ code: ER })
    ed.dispatch({ type: 'er.renameEntity', id: 'CUSTOMER', name: 'CLIENT' })
    expect(ed.code).toContain('CLIENT ||--o{ ORDER : places')
    expect(ed.code).toContain('CLIENT {')
  })

  it('deleteEntity removes block and touching relations', () => {
    const ed = new MermaidWysiwygEditor({ code: ER })
    ed.dispatch({ type: 'er.deleteEntity', id: 'CUSTOMER' })
    expect(ed.code).toBe(`erDiagram
  ORDER ||--|{ LINE-ITEM : contains
`)
  })
})
