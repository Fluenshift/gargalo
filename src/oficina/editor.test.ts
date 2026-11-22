import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { highlightCode } from '@lezer/highlight'
import { describe, expect, it, vi } from 'vitest'
import { codeExtensions, highlight } from './editor'

describe('Oficina editor setup', () => {
  it('colours TypeScript with the token classes', () => {
    const code = `const n: number = 1 // x`
    const classes = new Set<string>()
    highlightCode(code, javascript({ typescript: true }).language.parser.parse(code), highlight, (_, c) => c && classes.add(c), () => {})
    expect([...classes]).toEqual(expect.arrayContaining(['tok-keyword', 'tok-type', 'tok-number', 'tok-comment']))
  })

  it('builds the setup for TypeScript and for plain text', () => {
    for (const typescript of [true, false]) {
      const onChange = vi.fn()
      const state = EditorState.create({ doc: 'a', extensions: codeExtensions({ label: 'Código', describedBy: 'k', typescript, onChange }) })
      expect(state.doc.toString()).toBe('a')
    }
  })
})
