import { syntaxHighlighting } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { indentWithTab } from '@codemirror/commands'
import { tagHighlighter, tags } from '@lezer/highlight'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'

// The Oficina's code editor setup, shared by the exercises and the projects.

/** Token classes for the editor and the reference block alike; colours are the --code-* tokens in App.css (.tok-*). */
export const highlight = tagHighlighter([
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], class: 'tok-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], class: 'tok-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'tok-number' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: 'tok-comment' },
  { tag: [tags.typeName, tags.className], class: 'tok-type' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName))], class: 'tok-function' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], class: 'tok-punctuation' },
])

const editorTheme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--paper)', fontSize: 'var(--text-xs)' },
  '&.cm-focused': { outline: 'var(--focus-width) solid var(--focus)', outlineOffset: '2px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content, .cm-gutter': { minHeight: '240px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--ink-soft)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--sunk)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--line)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--line)', color: 'inherit' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--ink)', color: 'var(--on-ink)' },
})

/** The editor's setup: TypeScript (or plain text in the mono font), the coloured tokens, Tab indenting and `onChange` with the whole text. */
export function codeExtensions({ label, describedBy, typescript = true, onChange }: { label: string; describedBy: string; typescript?: boolean; onChange: (code: string) => void }) {
  return [
    basicSetup,
    // Tab indents; Esc then Tab (CodeMirror's own escape) leaves the editor.
    keymap.of([indentWithTab]),
    typescript ? javascript({ typescript: true }) : [],
    syntaxHighlighting(highlight),
    editorTheme,
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-describedby': describedBy }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange(u.state.doc.toString())
    }),
  ]
}
