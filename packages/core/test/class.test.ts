import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse } from '../src'

const CL = `classDiagram
  Animal <|-- Duck
  Animal <|-- Fish
  Animal : +int age
  Animal : +isMammal()
  class Duck{
    +String beakColor
    +swim()
  }
`

describe('class parsing', () => {
  it('parses classes, relations, block and one-liner members', () => {
    const r = parse(CL)
    expect(r.typeInfo?.id).toBe('class')
    const g = r.classGraph!
    expect(g.classes.map((c) => c.id).sort()).toEqual(['Animal', 'Duck', 'Fish'])
    expect(g.relations.map((rel) => `${rel.source}${rel.stmt.op}${rel.target}`)).toEqual([
      'Animal<|--Duck',
      'Animal<|--Fish',
    ])
    expect(g.classById.get('Animal')!.members.map((m) => m.text)).toEqual(['+int age', '+isMammal()'])
    expect(g.classById.get('Duck')!.members.map((m) => m.text)).toEqual(['+String beakColor', '+swim()'])
    expect(g.classById.get('Duck')!.block).toBeTruthy()
  })

  it('parses cardinalities, labels, and class labels', () => {
    const code = `classDiagram
  class Customer["Our customer"]
  Customer "1" --> "*" Ticket : books
`
    const g = parse(code).classGraph!
    expect(g.classById.get('Customer')!.label).toBe('Our customer')
    expect(g.relations[0].label).toBe('books')
    expect(g.relations[0].stmt.op).toBe('-->')
  })
})

describe('class ops', () => {
  it('addClass creates a block, connect adds a relation', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    const res = ed.dispatch({ type: 'cl.addClass' })
    expect(res?.created).toEqual(['class:Class1'])
    expect(ed.code).toContain('  class Class1 {\n  }')
    ed.dispatch({ type: 'cl.connect', source: 'Duck', target: 'Class1', op: '*--' })
    expect(ed.code).toContain('Duck *-- Class1')
  })

  it('setRelationType and reverseRelation rewrite in place', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    const rel = ed.result.classGraph!.relations[0]
    ed.dispatch({ type: 'cl.setRelationType', relId: rel.entityId, op: '..|>' })
    expect(ed.code).toContain('Animal ..|> Duck')
    const rel2 = ed.result.classGraph!.relations[0]
    ed.dispatch({ type: 'cl.reverseRelation', relId: rel2.entityId })
    expect(ed.code).toContain('Duck ..|> Animal')
  })

  it('addMember appends into the block or as a one-liner', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    ed.dispatch({ type: 'cl.addMember', id: 'Duck', text: '+quack()' })
    expect(ed.code).toContain('    +swim()\n    +quack()\n  }')
    ed.dispatch({ type: 'cl.addMember', id: 'Fish', text: '-int sizeInFeet' })
    expect(ed.code).toContain('Animal <|-- Fish\n  Fish : -int sizeInFeet')
  })

  it('renameClass rewrites decl, relations, one-liners', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    ed.dispatch({ type: 'cl.renameClass', id: 'Animal', name: 'Creature' })
    expect(ed.code).toContain('Creature <|-- Duck')
    expect(ed.code).toContain('Creature : +int age')
    expect(ed.code).not.toContain('Animal')
  })

  it('deleteClass removes block, members, and touching relations', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    ed.dispatch({ type: 'cl.deleteClass', id: 'Duck' })
    expect(ed.code).toBe(`classDiagram
  Animal <|-- Fish
  Animal : +int age
  Animal : +isMammal()
`)
  })

  it('setAnnotation adds, rewrites, and removes <<...>> lines', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    ed.dispatch({ type: 'cl.setAnnotation', id: 'Animal', annotation: 'interface' })
    expect(ed.code).toContain('Animal <|-- Duck\n  <<interface>> Animal')
    ed.dispatch({ type: 'cl.setAnnotation', id: 'Animal', annotation: 'abstract' })
    expect(ed.code).toContain('<<abstract>> Animal')
    expect(ed.code).not.toContain('interface')
    ed.dispatch({ type: 'cl.setAnnotation', id: 'Animal', annotation: null })
    expect(ed.code).not.toContain('<<')
  })

  it('addNoteFor appends a class note', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    ed.dispatch({ type: 'cl.addNoteFor', id: 'Duck', text: 'quacks loudly' })
    expect(ed.code).toContain('note for Duck "quacks loudly"')
  })

  it('setCardinality inserts, edits, and removes quoted cardinalities', () => {
    const ed = new MermaidWysiwygEditor({ code: 'classDiagram\n  Customer --> Ticket : books\n' })
    const rel = ed.result.classGraph!.relations[0]
    ed.dispatch({ type: 'cl.setCardinality', relId: rel.entityId, side: 'source', value: '1' })
    expect(ed.code).toContain('Customer "1" --> Ticket : books')
    const rel2 = ed.result.classGraph!.relations[0]
    ed.dispatch({ type: 'cl.setCardinality', relId: rel2.entityId, side: 'target', value: '0..*' })
    expect(ed.code).toContain('Customer "1" --> "0..*" Ticket : books')
    const rel3 = ed.result.classGraph!.relations[0]
    ed.dispatch({ type: 'cl.setCardinality', relId: rel3.entityId, side: 'source', value: null })
    expect(ed.code).toContain('Customer --> "0..*" Ticket : books')
  })

  it('setRelationLabel adds and removes', () => {
    const ed = new MermaidWysiwygEditor({ code: CL })
    const rel = ed.result.classGraph!.relations[1]
    ed.dispatch({ type: 'cl.setRelationLabel', relId: rel.entityId, label: 'is a' })
    expect(ed.code).toContain('Animal <|-- Fish : is a')
  })
})

describe('state stereotype ops', () => {
  it('setStateType declares and rewrites stereotypes', () => {
    const ed = new MermaidWysiwygEditor({ code: 'stateDiagram-v2\n  A --> B\n' })
    ed.dispatch({ type: 'st.setStateType', id: 'B', stype: 'choice' })
    expect(ed.code.split('\n')[1]).toBe('  state B <<choice>>')
    ed.dispatch({ type: 'st.setStateType', id: 'B', stype: 'fork' })
    expect(ed.code.split('\n')[1]).toBe('  state B <<fork>>')
    ed.dispatch({ type: 'st.setStateType', id: 'B', stype: 'state' })
    expect(ed.code.split('\n')[1]).toBe('  state B')
  })

  it('addStateNote and reverseTransition', () => {
    const ed = new MermaidWysiwygEditor({ code: 'stateDiagram-v2\n  A --> B: go\n' })
    ed.dispatch({ type: 'st.addStateNote', id: 'A', side: 'right', text: 'hi' })
    expect(ed.code).toContain('note right of A: hi')
    const t = ed.result.state!.transitions[0]
    ed.dispatch({ type: 'st.reverseTransition', transId: t.entityId })
    expect(ed.code).toContain('B --> A: go')
  })
})
