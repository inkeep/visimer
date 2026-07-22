import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse } from '../src'

const ST = `stateDiagram-v2
  [*] --> Still
  Still --> [*]
  Still --> Moving
  Moving --> Still
  Moving --> Crash: too fast
  Crash --> [*]
`

describe('state parsing', () => {
  it('parses transitions, [*] pseudo-states, labels', () => {
    const r = parse(ST)
    expect(r.typeInfo?.id).toBe('state')
    const g = r.state!
    expect(g.states.map((s) => s.id).sort()).toEqual(['Crash', 'Moving', 'Still'])
    expect(g.transitions).toHaveLength(6)
    expect(g.transitions[0].source).toBe('[*]')
    expect(g.transitions[4].label).toBe('too fast')
  })

  it('parses declarations, descriptions, composites, notes', () => {
    const code = `stateDiagram-v2
  direction LR
  state "On the move" as Moving
  Idle: Waiting for input
  state Config {
    A --> B
  }
  note right of Idle
    a block note
  end note
  Idle --> Moving
`
    const g = parse(code).state!
    expect(g.direction?.value).toBe('LR')
    expect(g.stateById.get('Moving')!.label).toBe('On the move')
    expect(g.stateById.get('Idle')!.label).toBe('Waiting for input')
    expect(g.stateById.get('Config')!.isComposite).toBe(true)
    expect(g.stateById.get('A')!.parent).toBe('Config')
    // the note block body is preserved, not parsed as statements
    expect(g.transitions.map((t) => `${t.source}->${t.target}`)).toEqual(['A->B', 'Idle->Moving'])
  })
})

describe('state ops', () => {
  it('addState and connect', () => {
    const ed = new MermaidWysiwygEditor({ code: ST })
    const res = ed.dispatch({ type: 'st.addState', label: 'Parked' })
    expect(res?.created).toEqual(['state:s1'])
    expect(ed.code).toContain('  s1: Parked')
    ed.dispatch({ type: 'st.connect', source: 'Still', target: 's1' })
    const lines = ed.code.trim().split('\n')
    expect(lines[lines.length - 1]).toBe('  Still --> s1')
  })

  it('setStateLabel declares or edits a description', () => {
    const ed = new MermaidWysiwygEditor({ code: ST })
    ed.dispatch({ type: 'st.setStateLabel', id: 'Still', label: 'Standing still' })
    expect(ed.code).toContain('  Still: Standing still')
    ed.dispatch({ type: 'st.setStateLabel', id: 'Still', label: 'At rest' })
    expect(ed.code).toContain('  Still: At rest')
    expect(ed.code).not.toContain('Standing still')
  })

  it('setTransitionLabel adds, edits, and removes', () => {
    const ed = new MermaidWysiwygEditor({ code: ST })
    const t = ed.result.state!.transitions[2] // Still --> Moving
    ed.dispatch({ type: 'st.setTransitionLabel', transId: t.entityId, label: 'accelerate' })
    expect(ed.code).toContain('Still --> Moving: accelerate')
    const t2 = ed.result.state!.transitions[2]
    ed.dispatch({ type: 'st.setTransitionLabel', transId: t2.entityId, label: '' })
    expect(ed.code).toContain('Still --> Moving\n')
  })

  it('deleteState removes declarations and touching transitions', () => {
    const ed = new MermaidWysiwygEditor({ code: ST })
    ed.dispatch({ type: 'st.deleteState', id: 'Moving' })
    expect(ed.code).toBe(`stateDiagram-v2
  [*] --> Still
  Still --> [*]
  Crash --> [*]
`)
  })

  it('deleteState refuses composites (brace safety)', () => {
    const code = `stateDiagram-v2
  state Config {
    A --> B
  }
`
    const ed = new MermaidWysiwygEditor({ code })
    const res = ed.dispatch({ type: 'st.deleteState', id: 'Config' })
    expect(res).toBeNull()
    expect(ed.code).toBe(code)
  })

  it('setDirection inserts or rewrites the direction statement', () => {
    const ed = new MermaidWysiwygEditor({ code: ST })
    ed.dispatch({ type: 'st.setDirection', direction: 'LR' })
    expect(ed.code.split('\n')[1]).toBe('  direction LR')
    ed.dispatch({ type: 'st.setDirection', direction: 'BT' })
    expect(ed.code.split('\n')[1]).toBe('  direction BT')
  })
})
