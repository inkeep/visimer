import { describe, expect, it } from 'vitest'
import { MermaidWysiwygEditor, parse } from '../src'

const SEQ = `sequenceDiagram
  participant Alice
  actor Bob
  Alice->>Bob: Hello Bob
  Bob-->>Alice: I am good
  Note over Alice: thinking
  Bob-)Alice: async bye
`

describe('sequence parsing', () => {
  it('parses participants, messages, notes', () => {
    const r = parse(SEQ)
    expect(r.typeInfo?.id).toBe('sequence')
    const g = r.sequence!
    expect(g.participants.map((p) => p.id)).toEqual(['Alice', 'Bob'])
    expect(g.participantById.get('Bob')!.ptype).toBe('actor')
    expect(g.events).toHaveLength(4)
    const [m1, m2, note, m3] = g.events
    expect(m1.kind).toBe('message')
    expect(m1.kind === 'message' && m1.stmt.op).toBe('->>')
    expect(m2.kind === 'message' && m2.stmt.op).toBe('-->>')
    expect(note.kind).toBe('note')
    expect(note.kind === 'note' && note.stmt.placement).toBe('over')
    expect(m3.kind === 'message' && m3.stmt.op).toBe('-)')
  })

  it('parses aliases, extended types, autonumber, implicit participants', () => {
    const code = `sequenceDiagram
  autonumber
  participant A as Alice Smith
  participant DB@{ "type" : "database" }
  A->>DB: query
  DB-->>C: forward
`
    const g = parse(code).sequence!
    expect(g.autonumber.enabled).toBe(true)
    expect(g.participantById.get('A')!.label).toBe('Alice Smith')
    expect(g.participantById.get('DB')!.ptype).toBe('database')
    expect(g.participantById.get('C')).toBeTruthy() // implicit
  })
})

describe('sequence ops', () => {
  it('setParticipantType swaps keyword and attrs', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    ed.dispatch({ type: 'seq.setParticipantType', id: 'Alice', ptype: 'actor' })
    expect(ed.code).toContain('actor Alice')
    ed.dispatch({ type: 'seq.setParticipantType', id: 'Alice', ptype: 'database' })
    expect(ed.code).toContain('participant Alice@{ "type" : "database" }')
    ed.dispatch({ type: 'seq.setParticipantType', id: 'Alice', ptype: 'participant' })
    expect(ed.code).toContain('participant Alice\n')
    expect(ed.code).not.toContain('@{')
  })

  it('addMessage inserts after a given event (lifeline + insertion point)', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    const first = ed.result.sequence!.events[0]
    ed.dispatch({ type: 'seq.addMessage', source: 'Alice', target: 'Alice', afterEvent: first.entityId, text: 'self check' })
    const lines = ed.code.split('\n')
    expect(lines[4]).toBe('  Alice->>Alice: self check')
    expect(lines[5]).toBe('  Bob-->>Alice: I am good')
  })

  it('addNote and toggleAutonumber', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    ed.dispatch({ type: 'seq.addNote', participant: 'Bob', placement: 'right of', text: 'hmm' })
    expect(ed.code).toContain('Note right of Bob: hmm')
    ed.dispatch({ type: 'seq.toggleAutonumber' })
    expect(ed.code.split('\n')[1]).toBe('  autonumber')
    ed.dispatch({ type: 'seq.toggleAutonumber' })
    expect(ed.code).not.toContain('autonumber')
  })

  it('setMessageOp and reverseMessage rewrite in place', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    const first = ed.result.sequence!.events[0]
    ed.dispatch({ type: 'seq.setMessageOp', eventId: first.entityId, op: '--x' })
    expect(ed.code).toContain('Alice--xBob: Hello Bob')
    const again = ed.result.sequence!.events[0]
    ed.dispatch({ type: 'seq.reverseMessage', eventId: again.entityId })
    expect(ed.code).toContain('Bob--xAlice: Hello Bob')
  })

  it('setEventText edits message and note text', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    const note = ed.result.sequence!.events[2]
    ed.dispatch({ type: 'seq.setEventText', eventId: note.entityId, text: 'pondering deeply' })
    expect(ed.code).toContain('Note over Alice: pondering deeply')
  })

  it('deleteParticipant removes decl, messages, notes, and self from shared notes', () => {
    const code = `sequenceDiagram
  participant A
  participant B
  A->>B: one
  B->>A: two
  Note over A,B: both
  activate A
  deactivate A
`
    const ed = new MermaidWysiwygEditor({ code })
    ed.dispatch({ type: 'seq.deleteParticipant', id: 'A' })
    expect(ed.code).toBe(`sequenceDiagram
  participant B
  Note over B: both
`)
  })

  it('renameParticipant rewrites all reference sites', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    ed.dispatch({ type: 'seq.renameParticipant', id: 'Bob', name: 'Robert' })
    expect(ed.code).toContain('actor Robert')
    expect(ed.code).toContain('Alice->>Robert: Hello Bob')
    expect(ed.code).toContain('Robert-)Alice: async bye')
  })

  it('addParticipant declares after the last declaration', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    const res = ed.dispatch({ type: 'seq.addParticipant', ptype: 'queue' })
    expect(res?.created).toEqual(['participant:P1'])
    const lines = ed.code.split('\n')
    expect(lines[3]).toBe('  participant P1@{ "type" : "queue" }')
  })

  it('moveEvent reorders statements in both directions', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    // move the last message before the first event
    const last = ed.result.sequence!.events[3]
    ed.dispatch({ type: 'seq.moveEvent', eventId: last.entityId, afterEvent: null })
    expect(ed.code.split('\n')[3]).toBe('  Bob-)Alice: async bye')
    expect(ed.code.split('\n')[4]).toBe('  Alice->>Bob: Hello Bob')
    // move it back down after the note
    const moved = ed.result.sequence!.events[0]
    const note = ed.result.sequence!.events.find((e) => e.kind === 'note')!
    ed.dispatch({ type: 'seq.moveEvent', eventId: moved.entityId, afterEvent: note.entityId })
    expect(ed.code).toBe(SEQ)
    // dropping in place is a no-op
    const first = ed.result.sequence!.events[0]
    const res = ed.dispatch({ type: 'seq.moveEvent', eventId: first.entityId, afterEvent: null })
    expect(res?.edits).toEqual([])
  })

  it('wrapInFragment wraps the event line in a block', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    const first = ed.result.sequence!.events[0]
    ed.dispatch({ type: 'seq.wrapInFragment', eventId: first.entityId, kind: 'loop' })
    const lines = ed.code.split('\n')
    expect(lines[3]).toBe('  loop Repeat')
    expect(lines[4]).toBe('    Alice->>Bob: Hello Bob')
    expect(lines[5]).toBe('  end')
    // the wrapped message is still an editable event at its new line
    expect(ed.selection).toEqual(['event:4'])
  })

  it('entity selection sync works for sequence', () => {
    const ed = new MermaidWysiwygEditor({ code: SEQ })
    const offset = ed.code.indexOf('Hello Bob')
    expect(ed.entityAt(offset)).toMatch(/^event:/)
    ed.setSelection(['participant:Alice'])
    expect(ed.selectionSpans().length).toBeGreaterThan(1)
  })
})
